/**
 * The bank line a statement line was imported as, and what matching a
 * completed reconciliation's bank lines says (1.85).
 *
 * A statement line and a bank line of the same account are the same line when
 * their date, amount, description and reference agree. When a reconciliation is
 * completed, every statement line paired with a ticked book line gives one
 * pair — that bank line and that book line — for acc_match_reconciled_bank_lines
 * to match in Bank Transactions. Pure: the service reads, this decides.
 *
 * 2.44: a reconciliation no longer imports a line Bank Transactions already
 * holds from another source — a CSV export, a bank feed, the books — so the
 * line a statement line is in Bank Transactions as can be that other line, on
 * the same day for the same amount (statementBankLines).
 */
import type { Standing } from "./reconcile-statement";
import { plural, pluralWord } from "@/lib/format";

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

const dayAndAmount = (line: Pick<StatementLineFields, "txnDate" | "amountMinor">) => `${line.txnDate}|${line.amountMinor}`;

/** The bank lines one set of identical statement lines can be in Bank Transactions as. */
export interface StatementBankLineGroup<T> {
  /** With the statement line's own key: the line as a statement import put it there. */
  own: T[];
  /** On the same day for the same amount, from another source (2.44); shared by every set of that day and amount. */
  other: T[];
}

/**
 * The bank lines each set of a statement's identical lines (statementLineKey)
 * can be in Bank Transactions as: its own lines first, then the account's lines
 * of another source on the same day for the same amount — the import's rule
 * for a line already there (otherSourceLines, statement-repeats.ts), with
 * descriptions not compared, since a CSV export, a feed or the books word a
 * line their own way. A bank line whose own key is any line's of this
 * statement stands for that line alone, never for another. A line of another
 * source can stand for any set of its day and amount, so the caller takes each
 * bank line once. Bank lines keep the order they are given in.
 */
export function statementBankLines<T extends StatementLineFields>(
  lines: readonly StatementLineFields[],
  transactions: readonly T[],
): Map<string, StatementBankLineGroup<T>> {
  const keys = new Map<string, StatementLineFields>();
  for (const line of lines) {
    const key = statementLineKey(line);
    if (!keys.has(key)) keys.set(key, line);
  }
  const own = new Map<string, T[]>();
  const other = new Map<string, T[]>();
  for (const txn of transactions) {
    const key = statementLineKey(txn);
    if (keys.has(key)) own.set(key, [...(own.get(key) ?? []), txn]);
    else other.set(dayAndAmount(txn), [...(other.get(dayAndAmount(txn)) ?? []), txn]);
  }
  return new Map(
    [...keys].map(([key, line]) => [key, { own: own.get(key) ?? [], other: other.get(dayAndAmount(line)) ?? [] }]),
  );
}

/**
 * The pairs a completed reconciliation matches: each statement line paired
 * with a ticked book line, and the bank line it is in Bank Transactions as.
 * Identical lines are one group: a bank line already matched to one of the
 * group's book lines keeps it, and the rest pair in order — the group's own
 * bank lines, unmatched first, then (2.44) unmatched lines of another source
 * on its day and amount. A line of another source matched elsewhere or ignored
 * is not handed over: it may be another payment of that amount. A statement
 * line with no bank line left gives no pair, and no bank line pairs twice.
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
  const groups = statementBankLines(lines, transactions);

  const used = new Set<string>();
  const pairs: BankLinePair[] = [];
  const pair = (txn: StatementBankLine, journalLineId: string) => {
    used.add(txn.id);
    pairs.push({ bankTransactionId: txn.id, journalLineId });
  };
  // Every bank line already matched to its book line keeps it first, so no
  // other set of the day and amount can take it as free.
  const open = new Map<string, string[]>();
  for (const [key, books] of bookLines) {
    const { own, other } = groups.get(key) ?? { own: [], other: [] };
    for (const journalLineId of books) {
      const kept = [...own, ...other].find((txn) => !used.has(txn.id) && txn.approvedLineId === journalLineId);
      if (kept) pair(kept, journalLineId);
      else open.set(key, [...(open.get(key) ?? []), journalLineId]);
    }
  }
  for (const [key, books] of open) {
    const { own, other } = groups.get(key) ?? { own: [], other: [] };
    const free = own.filter((txn) => !used.has(txn.id));
    const sortedFree = [
      ...free.filter((txn) => txn.status === "unmatched"),
      ...free.filter((txn) => txn.status !== "unmatched"),
      ...other.filter((txn) => !used.has(txn.id) && txn.status === "unmatched"),
    ];
    books.forEach((journalLineId, i) => {
      if (sortedFree[i]) pair(sortedFree[i], journalLineId);
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

/** Bank lines matching left as they were, for the person to check: matched elsewhere, ignored, or of the opposite sign. */
export function bankLinesToCheck(counts: BankLineMatchCounts): number {
  return counts.elsewhere + counts.ignored + counts.differs;
}

export function addMatchCounts(a: BankLineMatchCounts, b: BankLineMatchCounts): BankLineMatchCounts {
  return {
    matched: a.matched + b.matched,
    already: a.already + b.already,
    elsewhere: a.elsewhere + b.elsewhere,
    ignored: a.ignored + b.ignored,
    differs: a.differs + b.differs,
  };
}

/**
 * What matching said, in sentences after "Reconciliation completed." or a
 * run's summary: how many bank lines are matched now, and the ones left as
 * they were and why. Empty when there is nothing to say.
 */
export function bankLinesMatchedSentence(counts: BankLineMatchCounts): string {
  const said: string[] = [];
  if (counts.matched > 0) said.push(`${plural(counts.matched, "bank line")} matched in Bank Transactions.`);
  const left = [
    counts.elsewhere > 0 ? `${counts.elsewhere} ${pluralWord(counts.elsewhere, "is", "are")} matched to another entry` : null,
    counts.ignored > 0 ? `${counts.ignored} ${pluralWord(counts.ignored, "is", "are")} ignored` : null,
    counts.differs > 0 ? `${counts.differs} ${pluralWord(counts.differs, "has", "have")} the opposite sign to the books` : null,
  ].filter((part): part is string => part !== null);
  if (left.length) {
    const total = counts.elsewhere + counts.ignored + counts.differs;
    const list = left.length === 1 ? left[0] : `${left.slice(0, -1).join(", ")} and ${left[left.length - 1]}`;
    const lead = counts.matched > 0 ? list : `Of the bank lines, ${list}`;
    said.push(`${lead} — check ${pluralWord(total, "it", "them")} in Bank Transactions.`);
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

/** What a reconciliation from statement files did with a month's lines in Bank Transactions (2.44). */
export interface RunLineCounts {
  /** Lines Bank Transactions did not hold, put there. */
  added: number;
  /** Lines it already held — from this statement or another source — left exactly as they were. */
  alreadyHere: number;
}

export const NO_RUN_LINES: RunLineCounts = { added: 0, alreadyHere: 0 };

export function addRunLines(a: RunLineCounts, b: RunLineCounts): RunLineCounts {
  return { added: a.added + b.added, alreadyHere: a.alreadyHere + b.alreadyHere };
}

/**
 * What a run says about the statement lines, after its summary: that the lines
 * Bank Transactions already held were left as they were — none imported again,
 * none coded again — and how many new ones went there. Empty when there were none.
 */
export function runLinesSentence(counts: RunLineCounts): string {
  const said: string[] = [];
  if (counts.alreadyHere > 0) {
    said.push(
      `${plural(counts.alreadyHere, "statement line")} ${pluralWord(counts.alreadyHere, "was", "were")} already in Bank Transactions and ${pluralWord(counts.alreadyHere, "was", "were")} left as ${pluralWord(counts.alreadyHere, "it was", "they were")} — not imported or categorized again.`,
    );
  }
  if (counts.added > 0) {
    said.push(
      `${plural(counts.added, "statement line")} Bank Transactions did not have ${pluralWord(counts.added, "was", "were")} added there.`,
    );
  }
  return said.join(" ");
}

/** What Complete says when it is done. */
export function completedMessage(counts: BankLineMatchCounts | null, matchError: string | null): string {
  const after = matchError ? bankLinesNotMatchedSentence(matchError) : counts ? bankLinesMatchedSentence(counts) : "";
  return after ? `Reconciliation completed. ${after}` : "Reconciliation completed.";
}
