"use server";
/**
 * Reconciling against statement files: a run of statements previewed and
 * signed one month at a time, an account's first reconciliation brought
 * forward, and the statement a reconciliation keeps, paired with the books.
 * The session itself — ticking, completing, reopening — is in actions.ts.
 */
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { shortDate } from "@/lib/domain/pdf-statement-view";
import {
  reconciliationStatementSchema, runMonthSchema, runPreviewSchema, type ReconciliationStatementInput,
} from "@/lib/domain/schemas";
import { simulateRun, type RunPreview, type RunStatement } from "@/lib/domain/statement-run";
import {
  createReconciliationFromStatement, setReconciliationStatement, setStatementEnding, getBroughtForwardPreview,
  bringForward, getReconciliationHeader, getReconciliationStatement, pairAndTick, getBankOpenLines,
  listReconciliations, getReconciliationDetail, completeReconciliation,
  BankRecError, type ReconStatement, type StatementFileInput,
} from "@/lib/services/bankrec";
import { generateSuggestions, importStatement } from "@/lib/services/banking";
import { broughtForwardNote, dayBefore, type PairingOutcome } from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
import type { ActionResult } from "./actions";

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof BankRecError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export interface StatementImportSummary {
  /** New lines in Bank Transactions; a line already there is a duplicate. */
  inserted: number;
  duplicates: number;
  outcome: PairingOutcome;
}

function statementFile(input: ReconciliationStatementInput): StatementFileInput {
  return {
    fileName: input.file_name,
    openingMinor: input.opening_minor,
    closingMinor: input.closing_minor,
    lines: input.lines,
  };
}

/**
 * The statement's lines go into Bank Transactions as Import statement puts
 * them there — the same path and the same duplicate rule — and its matches are
 * looked for, so Review import can code what the books do not have. A failure
 * finding matches costs the proposals, not the import.
 */
async function importIntoBankTransactions(
  sb: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  bankAccountId: string,
  file: StatementFileInput,
) {
  const imported = await importStatement(sb, bankAccountId, file.fileName, file.lines);
  if (imported.inserted > 0) {
    await generateSuggestions(sb, bankAccountId).catch((err) =>
      console.warn("finding ledger matches after import failed:", err instanceof Error ? err.message : err),
    );
  }
  return imported;
}

/**
 * The statement a reconciliation in progress is reconciled against: kept with
 * it (replacing any kept before), imported into Bank Transactions, and paired
 * with the books — every pair is ticked. Nothing is posted.
 */
export async function importStatementIntoReconciliationAction(
  reconciliationId: string,
  raw: unknown,
): Promise<ActionResult<StatementImportSummary>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = reconciliationStatementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  let kept = false;
  try {
    const sb = await createSupabaseServerClient();
    const file = statementFile(parsed.data);
    // Kept first: a completed reconciliation refuses it before anything is imported.
    await setReconciliationStatement(sb, reconciliationId, file);
    kept = true;
    const { bankAccountId } = await getReconciliationHeader(sb, reconciliationId);
    const imported = await importIntoBankTransactions(sb, bankAccountId, file);
    const outcome = await pairAndTick(sb, reconciliationId);
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
    revalidatePath("/banking");
    return { ok: true, data: { inserted: imported.inserted, duplicates: imported.skipped, outcome } };
  } catch (e) {
    if (!kept) return { ok: false, error: msg(e) };
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
    return {
      ok: false,
      error: `The statement was kept with this reconciliation, but importing or pairing its lines failed: ${msg(e)}. Import the statement again.`,
    };
  }
}

/**
 * A run of statements walked against the books, writing nothing: each month
 * begins where the one before it closed, its lines pair with the book lines
 * still open, and the first month that does not agree line for line stops the
 * walk. On an account never reconciled, the first statement's opening balance
 * is set beside the books, as 1.79 brings an account forward.
 */
export async function previewRunAction(raw: unknown): Promise<ActionResult<RunPreview>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = runPreviewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const bankAccountId = parsed.data.bank_account_id;
  const statements: RunStatement[] = parsed.data.statements
    .map((s) => ({
      key: s.key,
      fileName: s.key,
      source: "PDF" as const,
      from: s.from,
      to: s.to,
      openingMinor: s.opening_minor,
      closingMinor: s.closing_minor,
      lines: s.lines.map((l) => ({
        txn_date: l.txn_date, description: "", reference: l.reference, amount_minor: l.amount_minor,
        running_balance_minor: null, raw_line: "",
      })),
      problem: null,
      outByMinor: null,
    }))
    .sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  try {
    const sb = await createSupabaseServerClient();
    const first = statements[0];
    const through = statements[statements.length - 1].to as string;
    const [openLines, reconciliations] = await Promise.all([
      getBankOpenLines(sb, bankAccountId, through),
      listReconciliations(sb, bankAccountId),
    ]);
    const last = reconciliations.find((r) => r.status === "completed") ?? null;
    const broughtForward =
      reconciliations.length === 0 && first.from && first.openingMinor !== null
        ? await getBroughtForwardPreview(sb, bankAccountId, dayBefore(first.from))
        : null;
    const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);
    return {
      ok: true,
      data: simulateRun(
        statements,
        openLines,
        { beginningMinor: last ? Number(last.statement_ending_balance_minor) : null, broughtForward },
        money,
      ),
    };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export interface RunMonthResult {
  /** The reconciliation this step made. */
  id: string;
  /** Completed by this step. */
  signed: boolean;
  /** What is left between the statement and the books; zero when signed. */
  differenceMinor: number;
}

/**
 * One step of a run, on the server: bringing the account's earlier lines
 * forward (refused by the database unless the books still agree), or one month
 * started from its statement — imported into Bank Transactions, paired and
 * ticked, then completed when `sign` is set and it reaches zero. A month that
 * no longer reaches zero (the books changed since the preview) is left in
 * progress and says by how much.
 */
export async function reconcileRunMonthAction(raw: unknown): Promise<ActionResult<RunMonthResult>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = runMonthSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const input = parsed.data;
  let startedId: string | null = null;
  try {
    const sb = await createSupabaseServerClient();
    if (input.kind === "bring_forward") {
      const id = await bringForward(
        sb,
        input.bank_account_id,
        dayBefore(input.period_from),
        input.opening_minor,
        broughtForwardNote(input.period_from, input.statement_date),
      );
      revalidatePath("/banking/reconcile");
      return { ok: true, data: { id, signed: true, differenceMinor: 0 } };
    }
    const file = statementFile(input);
    const id = await createReconciliationFromStatement(sb, input.bank_account_id, input.statement_date, input.closing_minor, file);
    startedId = id;
    await importIntoBankTransactions(sb, input.bank_account_id, file);
    await pairAndTick(sb, id);
    const { differenceMinor } = await getReconciliationDetail(sb, id);
    const signed = input.sign && differenceMinor === 0;
    if (signed) await completeReconciliation(sb, id);
    revalidatePath("/banking/reconcile");
    revalidatePath("/banking");
    return { ok: true, data: { id, signed, differenceMinor } };
  } catch (e) {
    revalidatePath("/banking/reconcile");
    revalidatePath("/banking");
    if (startedId && input.kind === "month") {
      return {
        ok: false,
        error: `The reconciliation to ${shortDate(input.statement_date, true)} was started with its statement but not signed off: ${msg(e)}. Open it to finish it.`,
      };
    }
    return { ok: false, error: msg(e) };
  }
}

/** Takes the statement's closing balance as the reconciliation's ending balance. */
export async function setStatementEndingAction(reconciliationId: string, endingMinor: number): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  if (!Number.isSafeInteger(endingMinor)) return { ok: false, error: "Ending balance must be a whole minor-unit amount" };
  try { const sb = await createSupabaseServerClient(); await setStatementEnding(sb, reconciliationId, endingMinor); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

/** Pairs the kept statement with the books as they are now and ticks any new pairs. */
export async function matchAgainAction(reconciliationId: string): Promise<ActionResult<PairingOutcome>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await pairAndTick(sb, reconciliationId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function reconciliationStatementAction(reconciliationId: string): Promise<ActionResult<ReconStatement>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getReconciliationStatement(sb, reconciliationId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
