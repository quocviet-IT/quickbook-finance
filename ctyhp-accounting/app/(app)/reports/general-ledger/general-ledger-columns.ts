/**
 * The General Ledger report's columns, and the width each one starts at.
 *
 * REQ-01, from the second reference video (2026-08-18). The reviewer opened
 * this report in Excel, pointed at DATE, DESCRIPTION, DEBIT and CREDIT, and
 * dragged the right edge of DESCRIPTION:
 *
 *   "But I just want to have a feature where you can just drag the end of this
 *    column just like that."
 *   "Where we can able to read the amount, the date, then yeah, that's all."
 *
 * Those are this report's columns. Bank Transactions — where the same
 * interaction shipped first — has no debit, credit or balance column at all,
 * so this screen is the one the video is actually about. `memo` is this
 * report's DESCRIPTION and is the column they were dragging.
 *
 * A `.ts` module rather than numbers inside the screen so a test can hold the
 * set of keys without importing a component that pulls in Ant Design.
 */
export const GENERAL_LEDGER_COLUMN_KEYS = [
  "date",
  "entry",
  "source",
  "memo",
  "debit",
  "credit",
  "running",
] as const;

export type GeneralLedgerColumnKey = (typeof GENERAL_LEDGER_COLUMN_KEYS)[number];

/**
 * Six of these are the literals this report has always used. `memo` is the
 * new one: it never had a width, and under the layout this screen used to run
 * it took whatever room was left over — about 180px on a laptop, which is why
 * a wire description was unreadable and why the reviewer wanted to widen it.
 *
 * The total is 1,010px. That fits without a scrollbar on the screens this is
 * read on, and the reader can drag it either way from there.
 */
export const GENERAL_LEDGER_DEFAULT_WIDTHS: Record<GeneralLedgerColumnKey, number> = {
  date: 110,
  entry: 130,
  source: 120,
  memo: 220,
  debit: 140,
  credit: 140,
  running: 150,
};

/** Where this reader's own widths are kept, namespaced by screen. */
export const GENERAL_LEDGER_WIDTH_STORAGE_KEY = "onebook.general-ledger.column-widths";
