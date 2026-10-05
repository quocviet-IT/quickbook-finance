import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatementReconciliationRow } from "@/lib/db/types";
import { readAllPages } from "@/lib/services/paging";
import type { ReconciliationCreateInput, ReconciliationAdjustmentInput, ReconciliationReopenInput } from "@/lib/domain/schemas";
import type { StatementLine } from "@/lib/domain/statement-import";
import { reconciliationStandings, type BroughtForwardPreview, type PairingOutcome } from "@/lib/domain/reconcile-statement";

export class BankRecError extends Error {}

export interface ReconLineView {
  journalLineId: string; entryId: string; entryNumber: string | null; entryDate: string;
  sourceType: string; memo: string | null; signedMinor: number; cleared: boolean;
  /** The cheque number a statement pairs on: the entry's reference, else its payment's. */
  reference: string | null;
}

/** A statement line as a reconciliation keeps it. */
export interface ReconStatementLine {
  lineNo: number; txnDate: string; description: string; reference: string | null;
  amountMinor: number; balanceMinor: number | null;
}

/** A reconciliation's account and date, and the statement it is reconciled against. */
export interface ReconStatementHeader {
  bankAccountId: string; endingDate: string; status: string;
  fileName: string | null; openingMinor: number | null; closingMinor: number | null;
  note: string | null; broughtForward: boolean;
}

/** The statement a reconciliation is reconciled against, with its lines. */
export interface ReconStatement extends ReconStatementHeader {
  lines: ReconStatementLine[];
}

/** A statement file's figures and lines, as a reconciliation takes them. */
export interface StatementFileInput {
  fileName: string;
  openingMinor: number | null;
  closingMinor: number | null;
  lines: StatementLine[];
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
    .select("id,bank_account_id,statement_ending_date,beginning_balance_minor,statement_ending_balance_minor,status,adjustment_entry_id,adjustment_reason,statement_ref,statement_opening_minor,statement_closing_minor,note,brought_forward,completed_at,created_at")
    .eq("bank_account_id", bankAccountId)
    .order("statement_ending_date", { ascending: false });
  if (error) throw new BankRecError(error.message);
  return (data ?? []) as unknown as StatementReconciliationRow[];
}

export async function getReconciliationLines(sb: SupabaseClient, id: string): Promise<ReconLineView[]> {
  // Paged past PostgREST's cap: an account with a thousand lines to the
  // statement date would otherwise show the first thousand and let the session
  // be ticked against a list that is not all there. The line id settles two
  // lines of one entry on the same account.
  const data = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .rpc("acc_reconciliation_lines", { p_reconciliation_id: id })
        .order("entry_date")
        .order("entry_number")
        .order("journal_line_id")
        .range(from, to),
    (message) => new BankRecError(message),
  );
  return data.map((r: Record<string, unknown>) => ({
    journalLineId: r.journal_line_id as string, entryId: r.entry_id as string,
    entryNumber: (r.entry_number as string) ?? null, entryDate: r.entry_date as string,
    sourceType: r.source_type as string, memo: (r.memo as string) ?? null,
    signedMinor: Number(r.signed_minor), cleared: Boolean(r.cleared),
    reference: (r.reference as string) ?? null,
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

// --- A reconciliation reconciled against its statement file -----------------

/** The lines as a reconciliation keeps them. A line of no amount moves no money and is not kept. */
function statementPayload(lines: readonly StatementLine[]) {
  return lines
    .filter((l) => l.amount_minor !== 0)
    .map((l) => ({
      txn_date: l.txn_date, description: l.description, reference: l.reference,
      amount_minor: l.amount_minor, balance_minor: l.running_balance_minor,
    }));
}

/** A reconciliation started from a statement: its date and ending balance are the statement's. */
export async function createReconciliationFromStatement(
  sb: SupabaseClient, bankAccountId: string, endingDate: string, endingMinor: number, file: StatementFileInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_create_reconciliation_from_statement", {
    p_bank_account_id: bankAccountId, p_ending_date: endingDate, p_ending_minor: endingMinor,
    p_file_name: file.fileName, p_opening_minor: file.openingMinor, p_lines: statementPayload(file.lines),
  });
  if (error) throw new BankRecError(error.message);
  return data as string;
}

/** Replaces the statement a reconciliation in progress is reconciled against. */
export async function setReconciliationStatement(sb: SupabaseClient, id: string, file: StatementFileInput): Promise<number> {
  const { data, error } = await sb.rpc("acc_set_reconciliation_statement", {
    p_reconciliation_id: id, p_file_name: file.fileName, p_opening_minor: file.openingMinor,
    p_closing_minor: file.closingMinor, p_lines: statementPayload(file.lines),
  });
  if (error) throw new BankRecError(error.message);
  return Number(data);
}

export async function setStatementEnding(sb: SupabaseClient, id: string, endingMinor: number): Promise<void> {
  const { error } = await sb.rpc("acc_set_statement_ending", { p_reconciliation_id: id, p_ending_minor: endingMinor });
  if (error) throw new BankRecError(error.message);
}

/** Ticks or unticks many lines at once: every line passes acc_set_cleared's checks, or none changes. */
export async function setClearedMany(sb: SupabaseClient, id: string, journalLineIds: string[], cleared: boolean): Promise<number> {
  if (!journalLineIds.length) return 0;
  const { data, error } = await sb.rpc("acc_set_cleared_many", {
    p_reconciliation_id: id, p_journal_line_ids: journalLineIds, p_cleared: cleared,
  });
  if (error) throw new BankRecError(error.message);
  return Number(data);
}

export async function getBroughtForwardPreview(sb: SupabaseClient, bankAccountId: string, through: string): Promise<BroughtForwardPreview> {
  const { data, error } = await sb.rpc("acc_brought_forward_preview", { p_bank_account_id: bankAccountId, p_through: through });
  if (error) throw new BankRecError(error.message);
  const r = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!r) throw new BankRecError("Bank account not found");
  return {
    hasReconciliations: Boolean(r.has_reconciliations),
    bookBalanceMinor: Number(r.book_balance_minor),
    openLines: Number(r.open_lines),
  };
}

/** The first reconciliation of an account, brought forward through `through` and signed by whoever asks. */
export async function bringForward(
  sb: SupabaseClient, bankAccountId: string, through: string, openingMinor: number, note: string,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_bring_forward_reconciliation", {
    p_bank_account_id: bankAccountId, p_through: through, p_opening_minor: openingMinor, p_note: note,
  });
  if (error) throw new BankRecError(error.message);
  return data as string;
}

const optionalMinor = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function getReconciliationHeader(sb: SupabaseClient, id: string): Promise<ReconStatementHeader> {
  const { data, error } = await sb.from("acc_statement_reconciliation")
    .select("bank_account_id,statement_ending_date,status,statement_ref,statement_opening_minor,statement_closing_minor,note,brought_forward")
    .eq("id", id)
    .single();
  if (error) throw new BankRecError(error.message);
  const r = data as Record<string, unknown>;
  return {
    bankAccountId: r.bank_account_id as string,
    endingDate: r.statement_ending_date as string,
    status: r.status as string,
    fileName: (r.statement_ref as string) ?? null,
    openingMinor: optionalMinor(r.statement_opening_minor),
    closingMinor: optionalMinor(r.statement_closing_minor),
    note: (r.note as string) ?? null,
    broughtForward: Boolean(r.brought_forward),
  };
}

export async function getReconciliationStatement(sb: SupabaseClient, id: string): Promise<ReconStatement> {
  const [header, lines] = await Promise.all([
    getReconciliationHeader(sb, id),
    // Paged: a statement holds up to 5,000 lines, and line_no is unique within
    // a reconciliation, so the order is total.
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb.from("acc_reconciliation_statement_line")
          .select("line_no,txn_date,description,reference,amount_minor,balance_minor")
          .eq("reconciliation_id", id)
          .order("line_no")
          .range(from, to),
      (message) => new BankRecError(message),
    ),
  ]);
  return {
    ...header,
    lines: lines.map((l) => ({
      lineNo: Number(l.line_no), txnDate: l.txn_date as string, description: (l.description as string) ?? "",
      reference: (l.reference as string) ?? null, amountMinor: Number(l.amount_minor), balanceMinor: optionalMinor(l.balance_minor),
    })),
  };
}

/**
 * Pairs the statement a reconciliation holds with the books as they are now,
 * and ticks every pair not ticked yet. No tick is removed, as in the prototype.
 */
export async function pairAndTick(sb: SupabaseClient, id: string): Promise<PairingOutcome> {
  const [statement, book] = await Promise.all([getReconciliationStatement(sb, id), getReconciliationLines(sb, id)]);
  const result = reconciliationStandings(statement, book);
  const toTick = result.standings.flatMap((s) => (s.kind === "paired" && !s.ticked ? [s.bookId] : []));
  const ticked = await setClearedMany(sb, id, toTick, true);
  return {
    lines: statement.lines.length, paired: result.paired, ticked,
    missing: result.missing, after: result.after, flipped: result.flipped,
  };
}
