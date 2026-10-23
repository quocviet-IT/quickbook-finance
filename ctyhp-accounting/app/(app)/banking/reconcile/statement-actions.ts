"use server";
/**
 * Reconciling against statement files: a run of statements previewed and
 * signed one month at a time, an account's first reconciliation brought
 * forward, and the statement a reconciliation keeps, paired with the books.
 * The session itself — ticking, completing, reopening — is in actions.ts.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import {
  reconciliationStatementSchema, runMonthSchema, runPreviewSchema, type ReconciliationStatementInput, type RunMonthInput,
} from "@/lib/domain/schemas";
import { RUN_MESSAGES, monthRefusal, simulateRun, type RunPreview, type RunStatement } from "@/lib/domain/statement-run";
import {
  createReconciliationFromStatement, setReconciliationStatement, setStatementEnding, getBroughtForwardPreview,
  bringForward, getReconciliationHeader, getReconciliationStatement, pairAndTick, getBankOpenLines,
  listReconciliations, getReconciliationDetail, completeReconciliation, getReconciliationLines, setClearedMany,
  BankRecError, type ReconStatement, type StatementFileInput,
} from "@/lib/services/bankrec";
import { generateSuggestions, importStatement, isCardBankAccount, markLinesAlreadyHere } from "@/lib/services/banking";
import { shown, stored } from "@/lib/domain/card-account";
import { AddMissingError, addMissingLines, getAddMissingPlan, type AddedLines } from "@/lib/services/add-missing";
import { ADD_MISSING_LIMIT, type AddMissingPlan } from "@/lib/domain/add-missing";
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import { broughtForwardNote, dayBefore, type PairingOutcome } from "@/lib/domain/reconcile-statement";
import { formatMoney, formatDate } from "@/lib/format";
import {
  PROOF_REFUSAL, needsAdministrator, proofRefusal, proveStatementPayload, sentWithoutProof,
} from "@/lib/domain/statement-proof";
import { tieKeptStatementFile } from "@/lib/services/statement-files";
import { matchAfterCompletion } from "@/lib/services/statement-bank-lines";
import type { BankLineMatchCounts, RunLineCounts } from "@/lib/domain/statement-bank-lines";
import type { ActionResult } from "./actions";

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string {
  return e instanceof BankRecError || e instanceof AddMissingError || e instanceof Error ? e.message : "An unexpected error occurred";
}

export interface StatementImportSummary {
  /** New lines in Bank Transactions; a line already there is a duplicate. */
  inserted: number;
  duplicates: number;
  /** Lines skipped as already in Bank Transactions from another source (2.04). */
  otherSource: number;
  outcome: PairingOutcome;
  /** Said when the kept file could not be tied to the import; null when it was, or none was kept. */
  fileWarning: string | null;
}

const usd = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);

/**
 * The statement as the reconciliation keeps it: its lines — every one but
 * those marked Not a transaction, those skipped as already here included, for
 * they are on the statement — and the opening and closing it was proved
 * between (2.04), which the reconciliation's opening and closing advice uses.
 */
function statementFile(input: ReconciliationStatementInput): StatementFileInput {
  return {
    fileName: input.file_name,
    openingMinor: input.proof.opening_minor,
    closingMinor: input.proof.closing_minor,
    lines: input.lines,
    statementFileId: input.statement_file_id,
  };
}

/**
 * Why the statement is refused before anything is written (2.04), or null: the
 * dialog's rule, run again on what was sent, and an override taken only from
 * an administrator. The database refuses anyone else's too, but only at the
 * import — after the statement is kept or the reconciliation started.
 */
async function statementRefusal(input: ReconciliationStatementInput): Promise<string | null> {
  const proof = proveStatementPayload(input.lines, input.proof, usd);
  const refusal = proofRefusal(proof, input.proof.override);
  if (refusal) return refusal;
  if (needsAdministrator(proof, input.proof.override) && !isAdmin(await getUserRole())) return PROOF_REFUSAL.notAdmin;
  return null;
}

/**
 * The statement's lines go into Bank Transactions as Import statement puts
 * them there — the same path, the same duplicate rule and the same proof — and
 * its matches are looked for, so Review import can code what the books do not
 * have. A failure finding matches costs the proposals, not the import.
 */
async function importIntoBankTransactions(
  sb: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  bankAccountId: string,
  input: ReconciliationStatementInput,
) {
  const imported = await importStatement(sb, bankAccountId, input.file_name, input.lines, input.proof);
  const fileWarning =
    imported.batchId && input.statement_file_id
      ? await tieKeptStatementFile(sb, "import", imported.batchId, input.statement_file_id)
      : null;
  if (imported.inserted > 0) {
    await generateSuggestions(sb, bankAccountId).catch((err) =>
      console.warn("finding ledger matches after import failed:", err instanceof Error ? err.message : err),
    );
  }
  return { ...imported, fileWarning };
}

/**
 * The statement a reconciliation in progress is reconciled against: kept with
 * it (replacing any kept before, its file with it), imported into Bank
 * Transactions, and paired with the books — every pair is ticked. Nothing is
 * posted. The payload is a ReconciliationStatementInput: the lines (those
 * marked Not a transaction left out, those already here from another source
 * marked `skip`) and the proof; a statement that does not add up, with no
 * override or with one from anyone but an administrator, is refused before
 * anything is kept.
 */
export async function importStatementIntoReconciliationAction(
  reconciliationId: string,
  raw: unknown,
): Promise<ActionResult<StatementImportSummary>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (sentWithoutProof(raw)) return { ok: false, error: PROOF_REFUSAL.noProof };
  const parsed = reconciliationStatementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const refusal = await statementRefusal(parsed.data);
  if (refusal) return { ok: false, error: refusal };
  let kept = false;
  try {
    const sb = await createSupabaseServerClient();
    const file = statementFile(parsed.data);
    // Kept first: a completed reconciliation refuses it before anything is imported.
    await setReconciliationStatement(sb, reconciliationId, file);
    kept = true;
    const { bankAccountId } = await getReconciliationHeader(sb, reconciliationId);
    const imported = await importIntoBankTransactions(sb, bankAccountId, parsed.data);
    const outcome = await pairAndTick(sb, reconciliationId);
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
    revalidatePath("/banking");
    return {
      ok: true,
      data: {
        inserted: imported.inserted,
        duplicates: imported.skipped,
        otherSource: imported.otherSource,
        outcome,
        fileWarning: imported.fileWarning,
      },
    };
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
      balancesOnly: s.balances_only,
    }))
    .sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  try {
    const sb = await createSupabaseServerClient();
    // A credit card's run (2.46) is its statements' balances, walked as the
    // statements print them: the books' figures are turned round to meet them.
    const side = (await isCardBankAccount(sb, bankAccountId)) ? "card" : "bank";
    if (statements.some((s) => Boolean(s.balancesOnly) !== (side === "card"))) {
      return { ok: false, error: side === "card" ? RUN_MESSAGES.cardNeedsPdf : "A bank account's statements are reconciled line by line." };
    }
    const first = statements[0];
    const through = statements[statements.length - 1].to as string;
    const [openLines, reconciliations] = await Promise.all([
      getBankOpenLines(sb, bankAccountId, through),
      listReconciliations(sb, bankAccountId),
    ]);
    const last = reconciliations.find((r) => r.status === "completed") ?? null;
    const preview =
      reconciliations.length === 0 && first.from && first.openingMinor !== null
        ? await getBroughtForwardPreview(sb, bankAccountId, dayBefore(first.from))
        : null;
    const broughtForward = preview ? { ...preview, bookBalanceMinor: shown(preview.bookBalanceMinor, side) } : null;
    const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);
    return {
      ok: true,
      data: simulateRun(
        statements,
        openLines.map((line) => ({ ...line, amountMinor: shown(line.amountMinor, side) })),
        { beginningMinor: last ? shown(Number(last.statement_ending_balance_minor), side) : null, broughtForward },
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
  /** What became of the month's statement lines in Bank Transactions (2.44); null when brought forward. */
  lines: RunLineCounts | null;
  /** What matching the month's bank lines did once it was signed; null when it was not signed, or brought forward. */
  matched: BankLineMatchCounts | null;
  /** Why the signed month's bank lines could not be matched; the month stays signed. */
  matchError: string | null;
  /** Said when the kept file could not be tied to the import or reconciliation; null otherwise. */
  fileWarning: string | null;
}

/**
 * One step of a run, on the server: bringing the account's earlier lines
 * forward (refused by the database unless the books still agree), or one month
 * started from its statement — paired and ticked, then completed when `sign` is
 * set and it reaches zero. A month that no longer reaches zero (the books
 * changed since the preview) is left in progress and says by how much. The
 * server refuses a month at or before the last completed reconciliation, or
 * not over yet.
 *
 * Reconciling checks the statement against the books; it does not code a line
 * or import one twice (2.44). Only the month's lines Bank Transactions does not
 * hold yet go in: a line already there — from this statement, or from another
 * source such as a CSV export — is left exactly as it is, and once the month is
 * signed it is matched to the book line it was ticked with, when it waits for
 * one. Nothing is posted.
 */
export async function reconcileRunMonthAction(raw: unknown): Promise<ActionResult<RunMonthResult>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if ((raw as { kind?: unknown } | null)?.kind === "month" && sentWithoutProof(raw)) return { ok: false, error: PROOF_REFUSAL.noProof };
  const parsed = runMonthSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const input = parsed.data;
  // A month whose statement does not add up is refused before anything is
  // written — an override with it, from anyone but an administrator, too; the
  // run stops there, and the statement is imported on its own.
  if (input.kind === "month") {
    const refusal = await statementRefusal(input);
    if (refusal) return { ok: false, error: refusal };
  }
  let startedId: string | null = null;
  try {
    const sb = await createSupabaseServerClient();
    // A credit card's run (2.46) sends its balances as the statement prints them,
    // and proves its months on them alone; a bank account's, line by line.
    const side = (await isCardBankAccount(sb, input.bank_account_id)) ? "card" : "bank";
    if ((input.kind === "card_month") !== (side === "card") && input.kind !== "bring_forward") {
      return { ok: false, error: side === "card" ? RUN_MESSAGES.cardNeedsPdf : "A bank account's statements are reconciled line by line." };
    }
    if (input.kind === "bring_forward") {
      const id = await bringForward(
        sb,
        input.bank_account_id,
        dayBefore(input.period_from),
        stored(input.opening_minor, side),
        broughtForwardNote(input.period_from, input.statement_date),
      );
      // Brought forward on the opening balance its statement prints: that file is its evidence too.
      const fileWarning = input.statement_file_id
        ? await tieKeptStatementFile(sb, "reconciliation", id, input.statement_file_id)
        : null;
      revalidatePath("/banking/reconcile");
      return { ok: true, data: { id, signed: true, differenceMinor: 0, lines: null, matched: null, matchError: null, fileWarning } };
    }
    const [{ asOf }, reconciliations] = await Promise.all([getBankingContext(sb), listReconciliations(sb, input.bank_account_id)]);
    // Newest first, as listReconciliations orders them.
    const refusal = monthRefusal(
      input.statement_date,
      asOf,
      reconciliations.find((r) => r.status === "completed")?.statement_ending_date ?? null,
    );
    if (refusal) return { ok: false, error: refusal };
    if (input.kind === "card_month") {
      startedId = "card";
      return { ok: true, data: await reconcileCardMonth(sb, input) };
    }
    // Read before anything is written: a run has no dialog to show the lines
    // already in Bank Transactions from another source, so they are marked here.
    const lines = await markLinesAlreadyHere(sb, input.bank_account_id, input.lines);
    // The reconciliation keeps the statement whole, the lines already there included.
    const file = statementFile(input);
    // The proof has a closing: a statement without one was refused above.
    const id = await createReconciliationFromStatement(sb, input.bank_account_id, input.statement_date, input.proof.closing_minor as number, file);
    startedId = id;
    const imported = await importIntoBankTransactions(sb, input.bank_account_id, { ...input, lines });
    await pairAndTick(sb, id);
    const { differenceMinor } = await getReconciliationDetail(sb, id);
    const signed = input.sign && differenceMinor === 0;
    if (signed) await completeReconciliation(sb, id);
    const { matched, matchError } = signed ? await matchAfterCompletion(sb, id) : { matched: null, matchError: null };
    revalidatePath("/banking/reconcile");
    revalidatePath("/banking");
    return {
      ok: true,
      data: {
        id,
        signed,
        differenceMinor,
        lines: { added: imported.inserted, alreadyHere: imported.skipped + imported.otherSource },
        matched,
        matchError,
        fileWarning: imported.fileWarning,
      },
    };
  } catch (e) {
    revalidatePath("/banking/reconcile");
    revalidatePath("/banking");
    if (startedId && (input.kind === "month" || input.kind === "card_month")) {
      return {
        ok: false,
        error: `The reconciliation to ${formatDate(input.statement_date)} may have been started but was not signed off: ${msg(e)}. Open Bank Reconciliation to finish it.`,
      };
    }
    return { ok: false, error: msg(e) };
  }
}

/**
 * A credit card's month (2.46), proved on its statement's balances: the
 * reconciliation is started at its new balance with its previous balance kept,
 * every open book line on the card to the statement date is ticked — the books'
 * own lines, from the card's CSV, are what the statement covers — and it is
 * completed when `sign` is set and they come to the new balance. Nothing is
 * imported, coded or posted. The balances arrive as the statement prints them
 * (owed positive) and are kept the books' way round.
 */
async function reconcileCardMonth(
  sb: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: Extract<RunMonthInput, { kind: "card_month" }>,
): Promise<RunMonthResult> {
  const id = await createReconciliationFromStatement(sb, input.bank_account_id, input.statement_date, stored(input.new_minor, "card"), {
    fileName: input.file_name,
    openingMinor: stored(input.previous_minor, "card"),
    closingMinor: stored(input.new_minor, "card"),
    lines: [],
    statementFileId: input.statement_file_id,
  });
  const book = await getReconciliationLines(sb, id);
  await setClearedMany(
    sb,
    id,
    book.filter((line) => !line.cleared && line.entryDate <= input.statement_date).map((line) => line.journalLineId),
    true,
  );
  const { differenceMinor } = await getReconciliationDetail(sb, id);
  const signed = input.sign && differenceMinor === 0;
  if (signed) await completeReconciliation(sb, id);
  revalidatePath("/banking/reconcile");
  revalidatePath("/banking");
  return { id, signed, differenceMinor, lines: null, matched: null, matchError: null, fileWarning: null };
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

/** What "Add all N to the books" would add to this reconciliation, and what it cannot. Reads only. */
export async function addMissingPlanAction(reconciliationId: string): Promise<ActionResult<AddMissingPlan>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getAddMissingPlan(sb, reconciliationId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

const shownSchema = z
  .array(z.object({ lineNo: z.number().int().nonnegative(), accountId: z.uuid() }))
  .min(1, "There is nothing to add")
  .max(ADD_MISSING_LIMIT, `At most ${ADD_MISSING_LIMIT} lines can be added at a time`);
const anywaySchema = z
  .array(z.number().int().nonnegative())
  .max(ADD_MISSING_LIMIT, `At most ${ADD_MISSING_LIMIT} lines can be added at a time`);

/**
 * Adds the statement lines the books do not have — every one asked for, or
 * none — as the person was shown them, then pairs and ticks. "Add all N" sends
 * the plan's items; "Add anyway" sends one held-back line, with its line
 * number in `anyway`. The reconciliation is not completed: Complete stays the
 * person's click.
 */
export async function addMissingLinesAction(
  reconciliationId: string,
  shown: unknown,
  anyway: unknown = [],
): Promise<ActionResult<AddedLines>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = shownSchema.safeParse(shown);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const held = anywaySchema.safeParse(anyway);
  if (!held.success) return { ok: false, error: held.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const added = await addMissingLines(sb, reconciliationId, parsed.data, held.data);
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
    revalidatePath("/banking");
    revalidatePath("/reports");
    return { ok: true, data: added };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
