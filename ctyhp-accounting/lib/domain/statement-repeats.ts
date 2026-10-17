/**
 * Repeated lines, and lines already in Bank Transactions from another source
 * (2.04, OB-1).
 *
 * Two identical lines on one statement are two payments, and OneBook keeps
 * both: the n-th identical line of a file carries its own key
 * (statementLineHashes). What was missing was saying so, and noticing a line
 * that is already in Bank Transactions because it came in another way — made
 * from the books, from a bank feed, or from another file — whose key a
 * statement line can never meet.
 *
 * Pure, and free of node:crypto, so the import dialog uses it in the browser.
 * The dialog works out the lines' keys in the browser and reads the account's
 * bank lines once per statement read (statement-line-keys.ts), then applies the
 * rules here on every tick; everything said about them is said here.
 */
import { formatDate, plural, pluralWord } from "@/lib/format";
import { plainAmount } from "./statement-proof";
import { repeatKey } from "./statement-key-text";

export { repeatKey };

/** The parts of a statement line that make two lines of one file identical. */
export interface RepeatLine {
  txn_date: string;
  amount_minor: number;
  description: string;
  reference: string | null;
  /** The bank's own id (OFX FITID). */
  external_id?: string | null;
}

// --- What Bank Transactions already holds -------------------------------------

/** Where a bank line came from (`acc_bank_lines_on`, 0143). */
export type BankLineSource = "books" | "feed" | "import" | "other";
export const BANK_LINE_SOURCES: readonly BankLineSource[] = ["books", "feed", "import", "other"];

/** One of the account's bank lines, as `acc_bank_lines_on` reads it. */
export interface BankLineOn {
  id: string;
  txnDate: string;
  amountMinor: number;
  /** The line's duplicate key: a statement line's, `ledger:` and an id for a line made from the books, or a feed's. */
  rawHash: string;
  sourceKind: BankLineSource;
  /** The statement import it came in with; null for any other line, a transactions file's included. */
  importBatchId: string | null;
}

/** A line of the file already in Bank Transactions from another source: skipped unless ticked back. */
export interface OtherSourceLine {
  /** Its index in the lines read. */
  index: number;
  /** Where the bank line it stands for came from. */
  source: BankLineSource;
  /** The bank line it stands for. */
  bankLineId: string;
}

/** Which of one file's lines are already in Bank Transactions (checkStatementLinesFrom). */
export interface StatementLinesCheck {
  /** Indexes of the lines whose own key is already in this account's Bank Transactions: "already here from this statement". */
  present: number[];
  /** Lines already in Bank Transactions from another source, skipped by default. */
  otherSource: OtherSourceLine[];
}

/** Said beside a line already in Bank Transactions from another source. */
export const OTHER_SOURCE_WARNING =
  "Already in Bank Transactions from another source (the books, a bank feed or another file)";

const dayAndAmount = (date: string, amountMinor: number) => `${date}|${amountMinor}`;

/**
 * The lines whose own key is already in Bank Transactions. `hashes` is one per
 * line read, null for a line marked Not a transaction (it is not sent);
 * `existing` is the account's bank lines over the file's days.
 */
export function presentLines(hashes: readonly (string | null)[], existing: readonly BankLineOn[]): number[] {
  const held = new Set(existing.map((line) => line.rawHash));
  return hashes.flatMap((hash, index) => (hash !== null && held.has(hash) ? [index] : []));
}

/**
 * The lines already in Bank Transactions from another source. A line is one
 * when its own key is not there, and the account holds a bank line on the same
 * day for the same amount that no line of this file accounts for. Descriptions
 * are not compared: a line made from the books carries the entry's words, not
 * the bank's. Counted one for one — two identical lines in the file and one
 * such bank line mark one, the first in file order.
 *
 * `hashes` is one per line read, null for a line marked Not a transaction;
 * `existing` is the account's bank lines over the file's days.
 */
export function otherSourceLines(
  lines: readonly Pick<RepeatLine, "txn_date" | "amount_minor">[],
  hashes: readonly (string | null)[],
  existing: readonly BankLineOn[],
): OtherSourceLine[] {
  const held = new Set(existing.map((line) => line.rawHash));
  const ours = new Set(hashes.filter((hash): hash is string => hash !== null));
  // A bank line whose key is one of this file's is that line, already here:
  // it accounts for no other.
  const free = new Map<string, BankLineOn[]>();
  for (const line of existing) {
    if (ours.has(line.rawHash)) continue;
    const key = dayAndAmount(line.txnDate, line.amountMinor);
    const list = free.get(key);
    if (list) list.push(line);
    else free.set(key, [line]);
  }
  const found: OtherSourceLine[] = [];
  lines.forEach((line, index) => {
    const hash = hashes[index];
    if (hash === null || hash === undefined || held.has(hash)) return;
    const twin = free.get(dayAndAmount(line.txn_date, line.amount_minor))?.shift();
    if (twin) found.push({ index, source: twin.sourceKind, bankLineId: twin.id });
  });
  return found;
}

// --- Saying it -----------------------------------------------------------------

/** One set of identical lines in a file. */
export interface RepeatGroup {
  /** The indexes of the identical lines, in file order. */
  indexes: number[];
  date: string;
  amountMinor: number;
  /** n: how many identical lines the file holds. */
  identical: number;
  /** m: how many are already here from this statement (their key is already in Bank Transactions). */
  alreadyPresent: number;
  /** How many are skipped as already in Bank Transactions from another source. */
  otherSource: number;
  /** k: how many will be imported. */
  toImport: number;
  /** "3 identical lines on 03/31/2026 (−412.30): 1 already in Bank Transactions, 2 will be imported." */
  text: string;
}

/**
 * The sets of identical lines in a file (two or more), and what becomes of
 * each: how many are already in Bank Transactions and how many will be
 * imported. A line marked Not a transaction is not one of them. `present` and
 * `skip` are indexes into `lines`: the lines already here from this statement,
 * and the lines skipped as already here from another source.
 */
export function describeRepeats(
  lines: readonly RepeatLine[],
  aside: Iterable<number>,
  present: Iterable<number>,
  skip: Iterable<number>,
  money: (minor: number) => string,
): RepeatGroup[] {
  const setAside = new Set(aside);
  const here = new Set(present);
  const skipped = new Set(skip);
  const groups = new Map<string, number[]>();
  lines.forEach((line, index) => {
    if (setAside.has(index)) return;
    const key = repeatKey(line);
    const list = groups.get(key);
    if (list) list.push(index);
    else groups.set(key, [index]);
  });
  return [...groups.values()]
    .filter((indexes) => indexes.length > 1)
    .map((indexes) => {
      const first = lines[indexes[0]];
      const alreadyPresent = indexes.filter((i) => here.has(i)).length;
      const otherSource = indexes.filter((i) => !here.has(i) && skipped.has(i)).length;
      const toImport = indexes.length - alreadyPresent - otherSource;
      const already = alreadyPresent + otherSource;
      const parts = [
        already > 0 ? `${already} already in Bank Transactions` : null,
        toImport > 0 ? `${toImport} will be imported` : "none will be imported",
      ].filter((part): part is string => part !== null);
      return {
        indexes,
        date: first.txn_date,
        amountMinor: first.amount_minor,
        identical: indexes.length,
        alreadyPresent,
        otherSource,
        toImport,
        text:
          `${indexes.length} identical lines on ${formatDate(first.txn_date)} ` +
          `(${plainAmount(first.amount_minor, money)}): ${parts.join(", ")}.`,
      };
    });
}

/** "03/31/2026", "03/31/2026 and 04/30/2026", "03/31/2026, 04/30/2026 and 05/31/2026", or "12 days". */
function daysSaid(dates: readonly string[]): string {
  const days = [...new Set(dates)].sort().map((date) => formatDate(date));
  if (days.length > 3) return `${days.length} days`;
  if (days.length === 1) return days[0];
  return `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
}

/** What one import did, in the counts the database and the dialog give. */
export interface ImportedCounts {
  /** Lines inserted (the database's `inserted`). */
  inserted: number;
  /** Lines whose key was already here (the database's `skipped`). */
  alreadyHere: number;
  /** Lines sent marked skip, as already in Bank Transactions from another source. */
  otherSource: number;
  /** The file's sets of identical lines, as the dialog showed them before the import. */
  repeats: readonly RepeatGroup[];
}

/**
 * Said after the import: "Imported 40 lines. 2 were already here from this
 * statement; 3 skipped as already in Bank Transactions from another source;
 * 3 repeated lines on 03/31/2026 kept." Each part after the first appears only
 * when it is not zero.
 */
export function importedSummary(counts: ImportedCounts): string {
  const n = counts.inserted;
  const headline = `Imported ${plural(n, "line")}.`;
  const kept = counts.repeats.filter((group) => group.toImport > 0);
  // Never more repeats kept than lines imported: a line someone else imported
  // in the meantime was not imported here.
  const keptLines = Math.min(
    kept.reduce((sum, group) => sum + group.toImport, 0),
    n,
  );
  const parts = [
    counts.alreadyHere > 0
      ? `${counts.alreadyHere.toLocaleString("en-US")} ${pluralWord(counts.alreadyHere, "was", "were")} already here from this statement`
      : null,
    counts.otherSource > 0
      ? `${counts.otherSource.toLocaleString("en-US")} skipped as already in Bank Transactions from another source`
      : null,
    keptLines > 0
      ? `${plural(keptLines, "repeated line")} on ${daysSaid(kept.map((group) => group.date))} kept`
      : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? `${headline} ${parts.join("; ")}.` : headline;
}
