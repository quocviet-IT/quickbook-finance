"use server";
/**
 * A reconciliation reconciled against its statement file: starting one from a
 * PDF statement, bringing an account's first reconciliation forward, keeping
 * the statement with the reconciliation and pairing its lines with the books.
 * The session itself — ticking, completing, reopening — is in actions.ts.
 */
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import {
  reconciliationFromStatementSchema, type ReconciliationStatementInput,
} from "@/lib/domain/schemas";
import {
  createReconciliationFromStatement, getBroughtForwardPreview, bringForward, pairAndTick,
  BankRecError, type StatementFileInput,
} from "@/lib/services/bankrec";
import { generateSuggestions, importStatement } from "@/lib/services/banking";
import {
  broughtForwardNote, dayBefore, type BroughtForwardPreview, type PairingOutcome,
} from "@/lib/domain/reconcile-statement";
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

export interface StartFromStatementSummary extends StatementImportSummary {
  id: string;
  broughtForward: boolean;
}

/**
 * A reconciliation started from a PDF statement: the statement's last day is
 * its date and its closing balance the ending balance. On the account's first
 * reconciliation, when the person asks, the earlier lines are brought forward
 * first — refused by the database unless the books agree with the statement's
 * opening balance.
 */
export async function startReconciliationFromStatementAction(
  raw: unknown,
): Promise<ActionResult<StartFromStatementSummary>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = reconciliationFromStatementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const input = parsed.data;
  const file = statementFile(input);
  let broughtForward = false;
  try {
    const sb = await createSupabaseServerClient();
    if (input.bring_forward && input.period_from && input.opening_minor !== null) {
      await bringForward(
        sb,
        input.bank_account_id,
        dayBefore(input.period_from),
        input.opening_minor,
        broughtForwardNote(input.period_from, input.statement_date),
      );
      broughtForward = true;
    }
    const id = await createReconciliationFromStatement(
      sb, input.bank_account_id, input.statement_date, input.closing_minor, file,
    );
    const imported = await importIntoBankTransactions(sb, input.bank_account_id, file);
    const outcome = await pairAndTick(sb, id);
    revalidatePath("/banking/reconcile");
    revalidatePath("/banking");
    return { ok: true, data: { id, broughtForward, inserted: imported.inserted, duplicates: imported.skipped, outcome } };
  } catch (e) {
    revalidatePath("/banking/reconcile");
    // Bringing forward is its own step: when what follows fails, the account
    // stays brought forward and the dialog offers Start.
    return {
      ok: false,
      error: broughtForward ? `The earlier lines were brought forward, but the reconciliation was not started: ${msg(e)}` : msg(e),
    };
  }
}

/** What bringing an account forward through a day would sign off. Read only. */
export async function broughtForwardPreviewAction(
  bankAccountId: string,
  through: string,
): Promise<ActionResult<BroughtForwardPreview>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getBroughtForwardPreview(sb, bankAccountId, through) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
