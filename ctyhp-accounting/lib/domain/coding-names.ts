/**
 * The names a bank line or a ledger entry is known by, read the way the
 * client's prototype reads them (`cleanPayee` and `histKeys` in its
 * "coding that learns").
 *
 * Imported by scripts/*.mjs: relative imports only, types only across modules.
 */

export type CodingDirection = "in" | "out";

/** Money in, and a zero, is `in`; money out is `out` — the prototype's `amount >= 0`. */
export function directionOf(amountMinor: number): CodingDirection {
  return amountMinor >= 0 ? "in" : "out";
}

/**
 * Words every bank line carries. A key made of these says nothing about who
 * was paid — "Deposit" and "WIRE TYPE IN" go everywhere — so they are dropped
 * before a name is formed. The prototype's list, unchanged: with a
 * three-in-four majority it took wrong guesses from 9 to 2 across 470 entries.
 */
export const GENERIC_WORDS: ReadonlySet<string> = new Set(
  (
    "deposit deposits wire type in out date time trn et ref transfer online mobile withdrawal " +
    "debit credit pos ach return item chargeback payment check cheque from to the id no number " +
    "bank branch atm card purchase recurring web ppd ccd des indn co entry descr orig memo"
  ).split(" "),
);

/** The prototype's `cleanPayee`: one space, no leading card word, no long digit runs, 48 characters. */
export function cleanPayee(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/^(ach|pos|debit|credit|card|purchase|payment|dep|withdrawal)\s+/i, "")
    .replace(/\b\d{6,}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 48);
}

/** The words of a cleaned name that could say who was paid. */
export function nameWords(text: string | null | undefined): string[] {
  return cleanPayee(text)
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !GENERIC_WORDS.has(word));
}

/** The prototype's `histKeys`: the first three words, and the first two when there are more. */
export function historyKeys(text: string | null | undefined): string[] {
  const words = nameWords(text);
  if (words.length === 0) return [];
  const keys = [words.slice(0, 3).join(" ")];
  if (words.length > 2) keys.push(words.slice(0, 2).join(" "));
  return keys;
}
