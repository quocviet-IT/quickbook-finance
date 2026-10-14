/**
 * The texts a statement line's duplicate key is a hash of. Free of every other
 * module, so banking-import.ts, which the verification scripts load straight
 * into Node, keeps no import chain into the screens' modules; statement-repeats
 * and statement-line-keys re-export these for the dialog.
 */
import type { RepeatLine } from "./statement-repeats.ts";

/**
 * What makes two lines of one file the same line twice, as statementLineHashes
 * counts them: the bank's own id when the line has one, else its date, amount,
 * description and reference.
 */
export function repeatKey(line: RepeatLine): string {
  return line.external_id
    ? JSON.stringify(["fitid", line.external_id])
    : JSON.stringify([line.txn_date, line.amount_minor, line.description, line.reference]);
}

/** The text a row's key is a hash of: its parts, a missing one as empty, joined by "|". */
export function rowKeyText(parts: readonly (string | number | null | undefined)[]): string {
  return parts.map((part) => String(part ?? "")).join("|");
}

/**
 * The text a statement line's duplicate key is a hash of: the account and the
 * bank's own id (OFX FITID) when the line has one, else the account, date,
 * amount, description and reference; the n-th identical line (n ≥ 2) adds "#n".
 */
export function statementLineKeyText(bankAccountId: string, line: RepeatLine, occurrence = 1): string {
  const parts: (string | number | null)[] = line.external_id
    ? [bankAccountId, "fitid", line.external_id]
    : [bankAccountId, line.txn_date, line.amount_minor, line.description, line.reference];
  return rowKeyText(occurrence > 1 ? [...parts, `#${occurrence}`] : parts);
}
