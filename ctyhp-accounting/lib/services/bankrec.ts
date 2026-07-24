import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatementReconciliationRow } from "@/lib/db/types";
import type { ReconciliationCreateInput, ReconciliationAdjustmentInput, ReconciliationReopenInput } from "@/lib/domain/schemas";

export class BankRecError extends Error {}

export interface ReconLineView {
  journalLineId: string; entryId: string; entryNumber: string | null; entryDate: string;
  sourceType: string; memo: string | null; signedMinor: number; cleared: boolean;
}
export interface ReconDetail {
  beginningMinor: number; statementEndingMinor: number; clearedTotalMinor: number;
  reconciledBalanceMinor: number; differenceMinor: number; status: string;
}
export interface DiscrepancyRow {
  reconciliationId: string; journalLineId: string; entryNumber: string | null; entryDate: string; signedMinor: number;
}

export async function createReconciliation(sb: SupabaseClient, input: ReconciliationCreateInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_create_reconciliation", {
    p_bank_account_id: input.bank_account_id,
    p_ending_date: input.statement_ending_date,
    p_ending_balance_minor: input.statement_ending_balance_minor,
  });
  if (error) throw new BankRecError(error.message);
  return data as string;
}

export async function setCleared(sb: SupabaseClient, reconciliationId: string, journalLineId: string, cleared: boolean): Promise<void> {
  const { error } = await sb.rpc("acc_set_cleared", {
    p_reconciliation_id: reconciliationId, p_journal_line_id: journalLineId, p_cleared: cleared,
  });
  if (error) throw new BankRecError(error.message);
}

export async function recordAdjustment(sb: SupabaseClient, reconciliationId: string, input: ReconciliationAdjustmentInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_record_reconciliation_adjustment", {
    p_reconciliation_id: reconciliationId, p_offset_account_id: input.offset_account_id, p_reason: input.reason,
  });
  if (error) throw new BankRecError(error.message);
  return data as string;
}

export async function completeReconciliation(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_complete_reconciliation", { p_reconciliation_id: id });
  if (error) throw new BankRecError(error.message);
}

export async function reopenReconciliation(sb: SupabaseClient, id: string, input: ReconciliationReopenInput): Promise<void> {
  const { error } = await sb.rpc("acc_reopen_reconciliation", { p_reconciliation_id: id, p_reason: input.reason });
  if (error) throw new BankRecError(error.message);
}

export async function listReconciliations(sb: SupabaseClient, bankAccountId: string): Promise<StatementReconciliationRow[]> {
  const { data, error } = await sb.from("acc_statement_reconciliation")
    .select("id,bank_account_id,statement_ending_date,beginning_balance_minor,statement_ending_balance_minor,status,adjustment_entry_id,adjustment_reason,statement_ref,completed_at,created_at")
    .eq("bank_account_id", bankAccountId)
    .order("statement_ending_date", { ascending: false });
  if (error) throw new BankRecError(error.message);
  return (data ?? []) as unknown as StatementReconciliationRow[];
}

export async function getReconciliationLines(sb: SupabaseClient, id: string): Promise<ReconLineView[]> {
  const { data, error } = await sb.rpc("acc_reconciliation_lines", { p_reconciliation_id: id });
  if (error) throw new BankRecError(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    journalLineId: r.journal_line_id as string, entryId: r.entry_id as string,
    entryNumber: (r.entry_number as string) ?? null, entryDate: r.entry_date as string,
    sourceType: r.source_type as string, memo: (r.memo as string) ?? null,
    signedMinor: Number(r.signed_minor), cleared: Boolean(r.cleared),
  }));
}

export async function getReconciliationDetail(sb: SupabaseClient, id: string): Promise<ReconDetail> {
  const { data, error } = await sb.rpc("acc_reconciliation_detail", { p_reconciliation_id: id });
  if (error) throw new BankRecError(error.message);
  const r = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!r) throw new BankRecError("Reconciliation not found");
  return {
    beginningMinor: Number(r.beginning_minor), statementEndingMinor: Number(r.statement_ending_minor),
    clearedTotalMinor: Number(r.cleared_total_minor), reconciledBalanceMinor: Number(r.reconciled_balance_minor),
    differenceMinor: Number(r.difference_minor), status: r.status as string,
  };
}

export async function getDiscrepancies(sb: SupabaseClient, bankAccountId: string): Promise<DiscrepancyRow[]> {
  const { data, error } = await sb.rpc("acc_reconciliation_discrepancies", { p_bank_account_id: bankAccountId });
  if (error) throw new BankRecError(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    reconciliationId: r.reconciliation_id as string, journalLineId: r.journal_line_id as string,
    entryNumber: (r.entry_number as string) ?? null, entryDate: r.entry_date as string, signedMinor: Number(r.signed_minor),
  }));
}
