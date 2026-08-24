import { COLUMN } from "@/lib/design/table-metrics";

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
export const GENERAL_LEDGER_COLUMN_KEYS = ["date", "entry", "memo", "debit", "credit", "running"] as const;

export type GeneralLedgerColumnKey = (typeof GENERAL_LEDGER_COLUMN_KEYS)[number];

/**
 * The measured columns, from the shared tokens. `memo` is absent on purpose:
 * it is the elastic column and takes whatever these leave, which is what makes
 * the row total the width of the box.
 *
 * Source was a column of its own — 120px printing "Invoice" or "Payment" — and
 * now reads under the memo, where it qualifies the line rather than competing
 * with it for the screen.
 */
export const GENERAL_LEDGER_DEFAULT_WIDTHS: Partial<Record<GeneralLedgerColumnKey, number>> = {
  date: COLUMN.DATE,
  entry: COLUMN.CODE,
  debit: COLUMN.MONEY,
  credit: COLUMN.MONEY,
  running: COLUMN.MONEY_WIDE,
};

/** The elastic column: it never takes a width. */
export const GENERAL_LEDGER_ELASTIC_KEY: GeneralLedgerColumnKey = "memo";

/** What a drag cannot reclaim here, and what the memo needs at its narrowest. */
export const GENERAL_LEDGER_BUDGET = { chrome: 0, elasticFloor: COLUMN.TEXT_MIN };

/**
 * Where this reader's own widths are kept, namespaced by screen.
 *
 * v2: the widths saved under the old key total 1,010px against a 984px box at
 * the narrowest viewport supported, so a reader who dragged these columns in
 * August would otherwise get the sideways scrolling back.
 */
export const GENERAL_LEDGER_WIDTH_STORAGE_KEY = "onebook.general-ledger.column-widths.v2";

/** The key it replaces, removed on first read. */
export const GENERAL_LEDGER_WIDTH_STORAGE_KEY_V1 = "onebook.general-ledger.column-widths";
