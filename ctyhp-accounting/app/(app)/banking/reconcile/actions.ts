"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import { reconciliationCreateSchema, reconciliationAdjustmentSchema, reconciliationReopenSchema } from "@/lib/domain/schemas";
import {
  createReconciliation, setCleared, recordAdjustment, completeReconciliation, reopenReconciliation,
  listReconciliations, getReconciliationLines, getReconciliationDetail, getDiscrepancies,
  BankRecError, type ReconLineView, type ReconDetail, type DiscrepancyRow,
} from "@/lib/services/bankrec";
import type { StatementReconciliationRow } from "@/lib/db/types";
import {
  generateSuggestions,
  importStatement,
  listBankTransactions,
  listSuggestions,
  type ImportRow,
} from "@/lib/services/banking";
import {
  executeOrSubmitForApproval,
  toControlledActionResponse,
  type ControlledActionResponse,
} from "@/lib/services/approval-flow";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof BankRecError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function createReconciliationAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = reconciliationCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const id = await createReconciliation(sb, parsed.data); revalidatePath("/banking/reconcile"); return { ok: true, data: { id } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function setClearedAction(reconciliationId: string, journalLineId: string, cleared: boolean): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await setCleared(sb, reconciliationId, journalLineId, cleared); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function recordAdjustmentAction(reconciliationId: string, raw: unknown): Promise<ActionResult<{ entryId: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = reconciliationAdjustmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const entryId = await recordAdjustment(sb, reconciliationId, parsed.data); return { ok: true, data: { entryId } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function completeReconciliationAction(id: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await completeReconciliation(sb, id); revalidatePath("/banking/reconcile"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function reopenReconciliationAction(
  id: string,
  raw: unknown,
): Promise<ActionResult<ControlledActionResponse>> {
  const role = await getUserRole();
  if (!isAdmin(role)) return { ok: false, error: "Only an admin can reopen a reconciliation" };
  const parsed = reconciliationReopenSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const outcome = await executeOrSubmitForApproval({
      sb,
      actionKey: "reconciliation_reopen",
      title: "Bank reconciliation reopen",
      amountMinor: 0,
      reason: parsed.data.reason,
      payload: { reconciliation_id: id },
      execute: async () => {
        await reopenReconciliation(sb, id, parsed.data);
        return id;
      },
    });
    revalidatePath("/banking/reconcile");
    revalidatePath(`/banking/reconcile/${id}`);
    revalidatePath("/approvals");
    revalidatePath("/dashboard");
    return { ok: true, data: toControlledActionResponse(outcome, String) };
  }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function listReconciliationsAction(bankAccountId: string): Promise<ActionResult<StatementReconciliationRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listReconciliations(sb, bankAccountId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function reconciliationLinesAction(id: string): Promise<ActionResult<ReconLineView[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getReconciliationLines(sb, id) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function reconciliationDetailAction(id: string): Promise<ActionResult<ReconDetail>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getReconciliationDetail(sb, id) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function discrepanciesAction(bankAccountId: string): Promise<ActionResult<DiscrepancyRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getDiscrepancies(sb, bankAccountId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

// --- Importing a statement from inside the reconciliation -------------------

export interface StatementImportSummary {
  inserted: number;
  duplicates: number;
  matched: number;
  unmatched: number;
}

/**
 * Import a statement into the account this reconciliation belongs to, then run
 * the matcher over it.
 *
 * The reconciliation is where someone is already standing with the statement in
 * hand; making them go to another screen to load it is the gap the reviewer
 * pointed at. The import itself is the same path the Banking screen uses — the
 * same RPC, the same duplicate rule — so a statement loaded here and one loaded
 * there produce identical rows.
 */
export async function importStatementIntoReconciliationAction(
  reconciliationId: string,
  fileName: string,
  rows: ImportRow[],
): Promise<ActionResult<StatementImportSummary>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const { data: session, error } = await sb
      .from("acc_statement_reconciliation")
      .select("bank_account_id, status")
      .eq("id", reconciliationId)
      .single();
    if (error) return { ok: false, error: error.message };
    const row = session as { bank_account_id: string; status: string };
    if (row.status !== "in_progress") {
      return { ok: false, error: "This reconciliation is completed; reopen it before importing." };
    }

    const imported = await importStatement(sb, row.bank_account_id, fileName, rows);
    // Matching runs over the whole account, which is what the Banking screen
    // does too: a statement line can match an entry from any period.
    await generateSuggestions(sb, row.bank_account_id);
    const suggestions = await listSuggestions(sb, row.bank_account_id);

    revalidatePath(`/banking/reconcile/${reconciliationId}`);
    return {
      ok: true,
      data: {
        inserted: imported.inserted,
        duplicates: imported.skipped,
        matched: suggestions.length,
        unmatched: Math.max(0, imported.inserted - suggestions.length),
      },
    };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export interface StatementLineView {
  id: string;
  txnDate: string;
  description: string;
  reference: string | null;
  amountMinor: number;
  status: string;
  /** The ledger entry the matcher paired it with, when it found one. */
  matchedEntry: string | null;
  matchedJournalLineId: string | null;
}

/** The statement lines behind this reconciliation, newest first. */
export async function reconciliationStatementLinesAction(
  reconciliationId: string,
): Promise<ActionResult<StatementLineView[]>> {
  try {
    const sb = await createSupabaseServerClient();
    const { data: session, error } = await sb
      .from("acc_statement_reconciliation")
      .select("bank_account_id, statement_ending_date")
      .eq("id", reconciliationId)
      .single();
    if (error) return { ok: false, error: error.message };
    const row = session as { bank_account_id: string; statement_ending_date: string };

    const [transactions, suggestions] = await Promise.all([
      listBankTransactions(sb, row.bank_account_id),
      listSuggestions(sb, row.bank_account_id),
    ]);
    const byTransaction = new Map(suggestions.map((s) => [s.bank_transaction_id, s]));

    // Everything up to the statement date: a line dated after the period
    // belongs to the next reconciliation, not this one.
    const inPeriod = transactions.filter((txn) => txn.txn_date <= row.statement_ending_date);

    return {
      ok: true,
      data: inPeriod.map((txn) => {
        const match = byTransaction.get(txn.id);
        return {
          id: txn.id,
          txnDate: txn.txn_date,
          description: txn.description,
          reference: txn.reference,
          amountMinor: txn.amount_minor,
          status: txn.status,
          matchedEntry: match?.target_number ?? null,
          matchedJournalLineId: match?.journal_line_id ?? null,
        };
      }),
    };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
