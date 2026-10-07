/**
 * The bank line a statement line was imported as, and what matching a
 * completed reconciliation's bank lines says (1.85).
 *
 * A statement line and a bank line of the same account are the same line when
 * their date, amount, description and reference agree. When a reconciliation is
 * completed, every statement line paired with a ticked book line gives one
 * pair — that bank line and that book line — for acc_match_reconciled_bank_lines
 * to match in Bank Transactions. Pure: the service reads, this decides.
 */
import type { Standing } from "./reconcile-statement";

export interface StatementLineFields {
  txnDate: string;
  amountMinor: number;
  description: string | null;
  reference: string | null;
}

/**
 * The key a statement line and its bank line share. The statement keeps a
 * description cut to 500 characters and a reference trimmed to 80, where the
 * bank line keeps them as the file gave them — so both are read the same way.
 */
export function statementLineKey(line: StatementLineFields): string {
  const ref = (line.reference ?? "").trim().slice(0, 80);
  return JSON.stringify([line.txnDate, line.amountMinor, (line.description ?? "").slice(0, 500), ref]);
}

/** A bank line of the reconciliation's account, as the matching reads it. */
export interface StatementBankLine extends StatementLineFields {
  id: string;
  status: string;
  /** The book line its approved match is to, when it has one. */
  approvedLineId: string | null;
}

export interface BankLinePair {
  bankTransactionId: string;
  journalLineId: string;
}

/**
 * The pairs a completed reconciliation matches: each statement line paired
 * with a ticked book line, and the bank line it was imported as. Identical
 * lines are one group: a bank line already matched to one of the group's book
 * lines keeps it, and the rest pair in order, unmatched bank lines first. A
 * statement line with no bank line left gives no pair.
 */
export function reconciledBankPairs(
  lines: readonly StatementLineFields[],
  /** One per line, in the same order (reconciliationStandings). */
  standings: readonly Standing[],
  /** The account's bank lines; identical lines in the order they were imported. */
  transactions: readonly StatementBankLine[],
): BankLinePair[] {
  const bookLines = new Map<string, string[]>();
  lines.forEach((line, i) => {
    const standing = standings[i];
    if (standing?.kind !== "paired" || !standing.ticked) return;
    const key = statementLineKey(line);
    bookLines.set(key, [...(bookLines.get(key) ?? []), standing.bookId]);
  });
  const bankLines = new Map<string, StatementBankLine[]>();
  for (const txn of transactions) {
    const key = statementLineKey(txn);
    if (bookLines.has(key)) bankLines.set(key, [...(bankLines.get(key) ?? []), txn]);
  }

  const pairs: BankLinePair[] = [];
  for (const [key, books] of bookLines) {
    const free = [...(bankLines.get(key) ?? [])];
    const open: string[] = [];
    for (const journalLineId of books) {
      const kept = free.findIndex((txn) => txn.approvedLineId === journalLineId);
      if (kept < 0) {
        open.push(journalLineId);
        continue;
      }
      pairs.push({ bankTransactionId: free[kept].id, journalLineId });
      free.splice(kept, 1);
    }
    const unmatched = free.filter((txn) => txn.status === "unmatched");
    const others = free.filter((txn) => txn.status !== "unmatched");
    const sortedFree = [...unmatched, ...others];
    open.forEach((journalLineId, i) => {
      if (sortedFree[i]) pairs.push({ bankTransactionId: sortedFree[i].id, journalLineId });
    });
  }
  return pairs;
}

/** What acc_match_reconciled_bank_lines did with the pairs it was given. */
export interface BankLineMatchCounts {
  /** Matched now. */
  matched: number;
  /** Matched to that book line before (by Add all, Categorize, or an earlier run). */
  already: number;
  /** The bank line is matched to another entry, or the book line to another bank line. */
  elsewhere: number;
  ignored: number;
  /** The bank line's amount has the opposite sign to the book line's. */
  differs: number;
}

export const NO_BANK_LINE_MATCHES: BankLineMatchCounts = { matched: 0, already: 0, elsewhere: 0, ignored: 0, differs: 0 };

export function addMatchCounts(a: BankLineMatchCounts, b: BankLineMatchCounts): BankLineMatchCounts {
  return {
    matched: a.matched + b.matched,
    already: a.already + b.already,
    elsewhere: a.elsewhere + b.elsewhere,
    ignored: a.ignored + b.ignored,
    differs: a.differs + b.differs,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isAre = (n: number) => (n === 1 ? "is" : "are");

/**
 * What matching said, in sentences after "Reconciliation completed." or a
 * run's summary: how many bank lines are matched now, and the ones left as
 * they were and why. Empty when there is nothing to say.
 */
export function bankLinesMatchedSentence(counts: BankLineMatchCounts): string {
  const said: string[] = [];
  if (counts.matched > 0) said.push(`${plural(counts.matched, "bank line")} matched in Bank Transactions.`);
  const left = [
    counts.elsewhere > 0 ? `${counts.elsewhere} ${isAre(counts.elsewhere)} matched to another entry` : null,
    counts.ignored > 0 ? `${counts.ignored} ${isAre(counts.ignored)} ignored` : null,
    counts.differs > 0 ? `${counts.differs} ${counts.differs === 1 ? "has" : "have"} the opposite sign to the books` : null,
  ].filter((part): part is string => part !== null);
  if (left.length) {
    const total = counts.elsewhere + counts.ignored + counts.differs;
    const list = left.length === 1 ? left[0] : `${left.slice(0, -1).join(", ")} and ${left[left.length - 1]}`;
    const lead = counts.matched > 0 ? list : `Of the bank lines, ${list}`;
    said.push(`${lead} — check ${total === 1 ? "it" : "them"} in Bank Transactions.`);
  }
  return said.join(" ");
}

/**
 * Said when a reconciliation was completed but its bank lines could not be
 * matched; `to` names the month when a run signed several.
 */
export function bankLinesNotMatchedSentence(problem: string, to?: string): string {
  const which = to ? `The bank lines to ${to}` : "Its bank lines";
  return `${which} could not be matched in Bank Transactions (${problem}); approve them there.`;
}

/** What Complete says when it is done. */
export function completedMessage(counts: BankLineMatchCounts | null, matchError: string | null): string {
  const after = matchError ? bankLinesNotMatchedSentence(matchError) : counts ? bankLinesMatchedSentence(counts) : "";
  return after ? `Reconciliation completed. ${after}` : "Reconciliation completed.";
}
