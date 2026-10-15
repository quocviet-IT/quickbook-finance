/**
 * Which lines of a statement are already in Bank Transactions, worked out in
 * the browser (2.04).
 *
 * A line's duplicate key is a SHA-256 of the text `statementLineKeyText` gives,
 * and the n-th identical line of a file adds its occurrence, counted over the
 * lines sent: ticking a line Not a transaction moves the occurrence of every
 * identical line after it. So the import dialog asks the server once per
 * statement read — the account's bank lines over the file's days, with their
 * keys (`acc_bank_lines_on`) — works out once, in the browser, the key each set
 * of identical lines would have as its 1st, 2nd, … line sent, and then answers
 * every tick here, with no round trip: the keys as sent (`keysAsSentFrom`, the
 * import's own count, statementKeysAsSent), then the server's own rules
 * (`presentLines`, `otherSourceLines`).
 *
 * Pure, and free of node:crypto: the hashing itself is the caller's —
 * node:crypto on the server (banking-import.ts), Web Crypto in the browser
 * (lib/client/statement-line-keys.ts) — and both hash these texts.
 */
import {
  otherSourceLines,
  presentLines,
  repeatKey,
  type BankLineOn,
  type RepeatLine,
  type StatementLinesCheck,
} from "./statement-repeats";
import { rowKeyText, statementLineKeyText } from "./statement-key-text";

export { rowKeyText, statementLineKeyText };

/** The first and last day a file's lines fall on; null for a file with none. */
export function statementDays(lines: readonly Pick<RepeatLine, "txn_date">[]): { from: string; to: string } | null {
  if (!lines.length) return null;
  let from = lines[0].txn_date;
  let to = from;
  for (const line of lines) {
    if (line.txn_date < from) from = line.txn_date;
    if (line.txn_date > to) to = line.txn_date;
  }
  return { from, to };
}

/** One set of identical lines of a file (repeatKey), and the text of its key as its 1st, 2nd, … line sent. */
export interface LineKeyTexts {
  key: string;
  texts: string[];
}

/**
 * The key texts a file can need, whatever is ticked Not a transaction: a set of
 * n identical lines is sent as anything from none to n of them, so its k-th
 * line sent has occurrence k, for k from 1 to n. One text per line of the file.
 */
export function lineKeyTexts(bankAccountId: string, lines: readonly RepeatLine[]): LineKeyTexts[] {
  const sets = new Map<string, { line: RepeatLine; count: number }>();
  for (const line of lines) {
    const key = repeatKey(line);
    const set = sets.get(key);
    if (set) set.count += 1;
    else sets.set(key, { line, count: 1 });
  }
  return [...sets].map(([key, { line, count }]) => ({
    key,
    texts: Array.from({ length: count }, (_, i) => statementLineKeyText(bankAccountId, line, i + 1)),
  }));
}

/** Each set of identical lines' keys (by repeatKey): the k-th is the key of the k-th such line sent. */
export type LineKeyTable = ReadonlyMap<string, readonly string[]>;

/** What the import dialog has for one statement read, fetched and worked out once. */
export interface StatementLineFacts {
  /** The keys of the file's lines, for every occurrence they can be sent as. */
  keys: LineKeyTable;
  /** The account's bank lines over the file's days (`acc_bank_lines_on`), with their keys. */
  bankLines: readonly BankLineOn[];
}

/**
 * One key per line read, as the import will send them — statementKeysAsSent,
 * with the keys looked up rather than hashed: counted over every line but those
 * marked Not a transaction, null for those. `keys` must have been worked out
 * for these lines (lineKeyTexts); a line it does not cover is a mistake, and
 * throws.
 */
export function keysAsSentFrom(
  lines: readonly RepeatLine[],
  aside: Iterable<number>,
  keys: LineKeyTable,
): (string | null)[] {
  const setAside = new Set(aside);
  const seen = new Map<string, number>();
  return lines.map((line, index) => {
    if (setAside.has(index)) return null;
    const key = repeatKey(line);
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const hash = keys.get(key)?.[occurrence - 1];
    if (hash === undefined) throw new Error(`No key was worked out for line ${index + 1} of this statement`);
    return hash;
  });
}

/**
 * What the import dialog says about a statement's lines for the ticks as they
 * are: which are already here from this statement, and which are already in
 * Bank Transactions from another source — the server's rules over what the
 * server sent once, so a tick costs no round trip.
 */
export function checkStatementLinesFrom(
  lines: readonly RepeatLine[],
  aside: Iterable<number>,
  facts: StatementLineFacts,
): StatementLinesCheck {
  const hashes = keysAsSentFrom(lines, aside, facts.keys);
  return { present: presentLines(hashes, facts.bankLines), otherSource: otherSourceLines(lines, hashes, facts.bankLines) };
}
