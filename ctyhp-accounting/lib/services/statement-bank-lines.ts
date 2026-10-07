/**
 * A bank account's lines as a statement reconciliation reads them, and the
 * matching of a completed reconciliation's bank lines in Bank Transactions
 * (1.85): the pairs are worked out here from the kept statement and the books,
 * and acc_match_reconciled_bank_lines matches them in one transaction.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconciliationStandings } from "@/lib/domain/reconcile-statement";
import {
  NO_BANK_LINE_MATCHES,
  reconciledBankPairs,
  type BankLineMatchCounts,
  type BankLinePair,
  type StatementBankLine,
} from "@/lib/domain/statement-bank-lines";
import { getReconciliationLines, getReconciliationStatement } from "./bankrec";
import { readAllPages } from "./paging";

export class StatementBankLinesError extends Error {}

/**
 * A bank account's lines from one day to another, with the book line each is
 * matched to. Paged, oldest first; the id settles lines of one day, so
 * identical lines keep one order however many pages the read takes.
 */
export async function bankLinesBetween(sb: SupabaseClient, bankAccountId: string, from: string, to: string): Promise<StatementBankLine[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (start, end) =>
      sb
        .from("acc_bank_transaction")
        .select("id,txn_date,description,reference,amount_minor,status,matches:acc_reconciliation(journal_line_id,status)")
        .eq("bank_account_id", bankAccountId)
        .is("provider_removed_at", null)
        .gte("txn_date", from)
        .lte("txn_date", to)
        .order("txn_date")
        .order("id")
        .range(start, end),
    (message) => new StatementBankLinesError(message),
  );
  return rows.map((row) => {
    const matches = (row.matches as { journal_line_id: string | null; status: string }[] | null) ?? [];
    return {
      id: row.id as string,
      txnDate: row.txn_date as string,
      description: (row.description as string | null) ?? null,
      reference: (row.reference as string | null) ?? null,
      amountMinor: Number(row.amount_minor),
      status: row.status as string,
      approvedLineId: matches.find((m) => m.status === "approved" && m.journal_line_id)?.journal_line_id ?? null,
    };
  });
}

/** The pairs a completed reconciliation matches: each ticked statement pair and the bank line it was imported as. */
export async function reconciledPairsOf(sb: SupabaseClient, reconciliationId: string): Promise<BankLinePair[]> {
  const [statement, book] = await Promise.all([
    getReconciliationStatement(sb, reconciliationId),
    getReconciliationLines(sb, reconciliationId),
  ]);
  const { standings } = reconciliationStandings(statement, book);
  const dates = statement.lines
    .filter((_, i) => {
      const standing = standings[i];
      return standing?.kind === "paired" && standing.ticked;
    })
    .map((line) => line.txnDate)
    .sort();
  if (!dates.length) return [];
  const transactions = await bankLinesBetween(sb, statement.bankAccountId, dates[0], dates[dates.length - 1]);
  return reconciledBankPairs(statement.lines, standings, transactions);
}

/** acc_match_reconciled_bank_lines's answer, read as counts. */
export function matchCountsOf(data: unknown): BankLineMatchCounts {
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    matched: Number(r.matched ?? 0),
    already: Number(r.already ?? 0),
    elsewhere: Number(r.elsewhere ?? 0),
    ignored: Number(r.ignored ?? 0),
    differs: Number(r.differs ?? 0),
  };
}

/**
 * Matches a completed reconciliation's bank lines in Bank Transactions. A bank
 * line matched before, ignored, or matched to another entry is left as it is
 * and counted; running it again matches only what is still unmatched.
 */
export async function matchReconciledBankLines(sb: SupabaseClient, reconciliationId: string): Promise<BankLineMatchCounts> {
  const pairs = await reconciledPairsOf(sb, reconciliationId);
  if (!pairs.length) return NO_BANK_LINE_MATCHES;
  const { data, error } = await sb.rpc("acc_match_reconciled_bank_lines", {
    p_reconciliation_id: reconciliationId,
    // One lock order: the database locks bank lines row by row in this order, so overlapping completions cannot deadlock.
    p_pairs: [...pairs]
      .sort((a, b) => (a.bankTransactionId < b.bankTransactionId ? -1 : a.bankTransactionId > b.bankTransactionId ? 1 : 0))
      .map((p) => ({ bank_transaction_id: p.bankTransactionId, journal_line_id: p.journalLineId })),
  });
  if (error) throw new StatementBankLinesError(error.message);
  return matchCountsOf(data);
}

/** What matching did once a reconciliation was completed: the counts, or why it failed. */
export interface CompletionMatching {
  matched: BankLineMatchCounts | null;
  /** Why the bank lines could not be matched; the reconciliation stays completed. */
  matchError: string | null;
}

/**
 * Matches a reconciliation's bank lines right after it was completed. A
 * failure does not undo the completion: it is returned, to be said beside it.
 */
export async function matchAfterCompletion(sb: SupabaseClient, reconciliationId: string): Promise<CompletionMatching> {
  try {
    return { matched: await matchReconciledBankLines(sb, reconciliationId), matchError: null };
  } catch (e) {
    return { matched: null, matchError: e instanceof Error ? e.message : "an unexpected error" };
  }
}
