/**
 * Reconciliation history and the flow around it (2.03, migration 0142):
 * bringing an account's history forward — from the history page, or from
 * inside the reconciliation whose statement proves it — discarding a
 * reconciliation in progress, setting a misread statement line aside, and
 * asking which statement lines the books may already hold.
 *
 * The rules are the database's; this reads, works out what the database cannot
 * (whether a line pairs with the books), and derives on the server every figure
 * a write depends on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DuplicateMatch } from "@/lib/domain/add-missing";
import {
  historyAccounts,
  type HistoryAccount,
  type HistoryPreview,
  type ReconciliationHistoryRow,
} from "@/lib/domain/reconcile-history";
import {
  broughtForwardNote,
  reconciliationStandings,
  sessionHistoryRefusal,
  sessionHistoryStart,
  setAsideRefusal,
  type HistorySession,
  type SessionHistoryFacts,
} from "@/lib/domain/reconcile-statement";
import { listBankAccounts } from "./banking";
import {
  BankRecError,
  getBroughtForwardPreview,
  getReconciliationDetail,
  getReconciliationHeader,
  getReconciliationLines,
  getReconciliationStatement,
  type ReconStatementHeader,
} from "./bankrec";
import { readAllPages } from "./paging";
import { tieKeptStatementFile } from "./statement-files";

/** What acc_bring_history_forward made. */
export interface BroughtForwardHistory {
  /** The new completed, brought-forward reconciliation. */
  reconciliationId: string;
  /** The lines it holds: moved from the session in progress, and newly ticked. */
  lines: number;
  /** Of those, the ticks taken from the session in progress. */
  moved: number;
  /** The session in progress that now begins at the statement balance, when there is one. */
  rebasedReconciliationId: string | null;
}

/** Discards a reconciliation in progress, with its ticks and statement lines. Returns the ticks removed. */
export async function discardReconciliation(sb: SupabaseClient, reconciliationId: string, reason: string): Promise<number> {
  const { data, error } = await sb.rpc("acc_discard_reconciliation", { p_reconciliation_id: reconciliationId, p_reason: reason });
  if (error) throw new BankRecError(error.message);
  return Number(data ?? 0);
}

/**
 * Brings an account's history forward through `through`, proved by the
 * statement's balance on that day. The database refuses unless the books hold
 * exactly that balance, the account was never reconciled, and any session in
 * progress ends after the day.
 */
export async function bringHistoryForward(
  sb: SupabaseClient,
  bankAccountId: string,
  through: string,
  balanceMinor: number,
  note: string,
): Promise<BroughtForwardHistory> {
  const { data, error } = await sb.rpc("acc_bring_history_forward", {
    p_bank_account_id: bankAccountId,
    p_through: through,
    p_balance_minor: balanceMinor,
    p_note: note,
  });
  if (error) throw new BankRecError(error.message);
  const r = (data ?? {}) as Record<string, unknown>;
  if (!r.reconciliation_id) throw new BankRecError("Bringing the history forward returned no reconciliation");
  return {
    reconciliationId: r.reconciliation_id as string,
    lines: Number(r.lines ?? 0),
    moved: Number(r.moved ?? 0),
    rebasedReconciliationId: (r.rebased_reconciliation_id as string) ?? null,
  };
}

/**
 * acc_reconciliation_history, one row per bank account. Paged all the same: an
 * account is one row, but nothing else keeps a list from PostgREST's cap, and
 * the bank account id orders it totally.
 */
export async function readReconciliationHistory(sb: SupabaseClient): Promise<ReconciliationHistoryRow[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.rpc("acc_reconciliation_history").order("bank_account_id").range(from, to),
    (message) => new BankRecError(message),
  );
  return rows.map((r) => ({
    bankAccountId: r.bank_account_id as string,
    openLines: Number(r.open_lines ?? 0),
    firstOpenDate: (r.first_open_date as string) ?? null,
    lastOpenDate: (r.last_open_date as string) ?? null,
    lastReconciledDate: (r.last_reconciled_date as string) ?? null,
    inProgress: r.in_progress_id
      ? { id: r.in_progress_id as string, endingDate: r.in_progress_ending_date as string }
      : null,
  }));
}

/** Every bank account's history, named and ordered as Banking lists the accounts. */
export async function getReconciliationHistory(sb: SupabaseClient): Promise<HistoryAccount[]> {
  const [rows, banks] = await Promise.all([readReconciliationHistory(sb), listBankAccounts(sb)]);
  return historyAccounts(rows, banks);
}

/** What the books hold on an account through a day, and how many lines bringing it forward would mark. */
export async function getHistoryPreview(sb: SupabaseClient, bankAccountId: string, through: string): Promise<HistoryPreview> {
  const preview = await getBroughtForwardPreview(sb, bankAccountId, through);
  return { bookBalanceMinor: preview.bookBalanceMinor, entries: preview.openLines };
}

/** A reconciliation as bringing its history forward reads it: its header and where it begins. */
async function readHistorySession(
  sb: SupabaseClient,
  reconciliationId: string,
): Promise<{ header: ReconStatementHeader; session: HistorySession }> {
  const [header, detail] = await Promise.all([
    getReconciliationHeader(sb, reconciliationId),
    getReconciliationDetail(sb, reconciliationId),
  ]);
  return {
    header,
    session: {
      status: header.status,
      periodStart: header.statementFile?.periodStart ?? null,
      // The file is read through acc_saved_report, which only someone who may read saved files sees.
      fileUnreadable: header.statementFileId !== null && header.statementFile === null,
      openingMinor: header.openingMinor,
      beginningMinor: detail.beginningMinor,
    },
  };
}

/**
 * What a reconciliation's offer to bring the history forward rests on, read on
 * the server: the day before its kept statement's period, the balance the
 * statement opens with, the books through that day and how many lines they
 * hold, and whether the account was ever reconciled. Null when the
 * reconciliation has nothing to offer (sessionHistoryStart). The screen turns
 * it into words with sessionHistoryAdvice.
 */
export async function getSessionHistoryAdvice(sb: SupabaseClient, reconciliationId: string): Promise<SessionHistoryFacts | null> {
  const { header, session } = await readHistorySession(sb, reconciliationId);
  const start = sessionHistoryStart(session);
  if (!start) return null;
  const [history, preview] = await Promise.all([
    readReconciliationHistory(sb),
    getBroughtForwardPreview(sb, header.bankAccountId, start.through),
  ]);
  const account = history.find((row) => row.bankAccountId === header.bankAccountId);
  return {
    ...start,
    bookBalanceMinor: preview.bookBalanceMinor,
    entries: preview.openLines,
    reconciled: Boolean(account?.lastReconciledDate),
  };
}

/**
 * Brings the history forward from inside a reconciliation in progress. The day
 * and the balance are the stored statement's — the day before its kept file's
 * period, and the balance it opens with — never figures sent by the screen.
 * The new reconciliation keeps the statement's file as its evidence too, as one
 * brought forward from statement files does; a file that cannot be tied is
 * said, not undone.
 */
export async function bringHistoryForwardFromSession(
  sb: SupabaseClient,
  reconciliationId: string,
): Promise<BroughtForwardHistory & { fileWarning: string | null }> {
  const { header, session } = await readHistorySession(sb, reconciliationId);
  const refusal = sessionHistoryRefusal(session);
  const start = sessionHistoryStart(session);
  if (refusal || !start) throw new BankRecError(refusal ?? "The history cannot be brought forward from this reconciliation.");
  const note = broughtForwardNote(session.periodStart, header.statementFile?.periodEnd ?? header.endingDate);
  const result = await bringHistoryForward(sb, header.bankAccountId, start.through, start.openingMinor, note);
  const fileWarning = header.statementFileId
    ? await tieKeptStatementFile(sb, "reconciliation", result.reconciliationId, header.statementFileId)
    : null;
  return { ...result, fileWarning };
}

/**
 * Sets a statement line aside as not a transaction, or brings it back. A line
 * the books pair with is a transaction and is refused: whether it pairs is
 * worked out here, from the books as they are now, because the database does
 * not store it. Bringing a line back is always allowed.
 */
export async function setStatementLineAside(
  sb: SupabaseClient,
  reconciliationId: string,
  lineNo: number,
  aside: boolean,
): Promise<void> {
  if (aside) {
    const [statement, book] = await Promise.all([
      getReconciliationStatement(sb, reconciliationId),
      getReconciliationLines(sb, reconciliationId),
    ]);
    const { standings } = reconciliationStandings(statement, book);
    const at = statement.lines.findIndex((line) => line.lineNo === lineNo);
    const refusal = setAsideRefusal(at >= 0 ? standings[at] : undefined, aside);
    if (refusal) throw new BankRecError(refusal);
  }
  const { error } = await sb.rpc("acc_set_statement_line_aside", {
    p_reconciliation_id: reconciliationId,
    p_line_no: lineNo,
    p_aside: aside,
  });
  if (error) throw new BankRecError(error.message);
}

/**
 * The posted lines the books already hold that each statement line may be, by
 * line number: the same amount, and the same cheque number or a date within 5
 * days. Asks nothing when no line is given. Paged: each line can find several,
 * and the journal line id settles the order within a line.
 */
export async function statementLineDuplicates(
  sb: SupabaseClient,
  reconciliationId: string,
  lineNos: readonly number[],
): Promise<Map<number, DuplicateMatch[]>> {
  const asked = [...new Set(lineNos)];
  const found = new Map<number, DuplicateMatch[]>();
  if (!asked.length) return found;
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .rpc("acc_statement_line_duplicates", { p_reconciliation_id: reconciliationId, p_line_nos: asked })
        .order("line_no")
        .order("entry_date")
        .order("entry_number")
        .order("journal_line_id")
        .range(from, to),
    (message) => new BankRecError(message),
  );
  for (const r of rows) {
    const lineNo = Number(r.line_no);
    const match: DuplicateMatch = {
      journalLineId: r.journal_line_id as string,
      entryId: r.entry_id as string,
      entryNumber: (r.entry_number as string) ?? null,
      entryDate: r.entry_date as string,
    };
    found.set(lineNo, [...(found.get(lineNo) ?? []), match]);
  }
  return found;
}
