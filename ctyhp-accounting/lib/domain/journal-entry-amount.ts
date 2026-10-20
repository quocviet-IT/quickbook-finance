/**
 * How much a journal entry moves: the sum of its debits.
 *
 * The UI review of 2026-10-20 found Journal Entries and the Journal Report
 * listing entries with no amount at all — a number, a date, a description, and
 * nothing to say whether an entry moved $12 or $12,000 without opening each one.
 *
 * A posted entry balances, so its debits and its credits are the same figure;
 * the debits are taken because that is the side an accountant reads an entry's
 * size from. Should a line ever disagree (an entry still being built), the larger
 * side is shown rather than a figure that hides the difference.
 *
 * Pure: lines in, minor units out.
 */
export function journalEntryAmountMinor(lines: readonly { debitMinor: number; creditMinor: number }[]): number {
  const debits = lines.reduce((sum, line) => sum + line.debitMinor, 0);
  const credits = lines.reduce((sum, line) => sum + line.creditMinor, 0);
  return Math.max(debits, credits);
}
