import { COLUMN } from "@/lib/design/table-metrics";

/**
 * Which columns this table has, how wide the measured ones are, and what it
 * spends on room a drag cannot reclaim.
 *
 * Feedback a9c5b84b (2026-08-22) arrived with a 1470x801 screenshot of this
 * screen. Eight data columns declared 1530px, the box was 1174px, and the two
 * widest of them held the same value on every row: "Bank Of America - 121" in
 * Account source — already the account chosen in the filter bar above — and an
 * em dash in Reference. Both are gone from the row and read on the second line
 * of the description instead. Status went into the first line of Match, which
 * already says whether a line is matched and which the filter bar also narrows
 * by; that is what buys Match the room its buttons need.
 *
 * A `.ts` module rather than numbers inside the component, so the arithmetic
 * can be asserted without rendering Ant Design — the same reason
 * `reports/general-ledger/general-ledger-columns.ts` exists.
 */
export const BANK_COLUMN_KEYS = ["date", "description", "amount", "category", "match"] as const;

export type BankColumnKey = (typeof BANK_COLUMN_KEYS)[number];

/**
 * The columns whose content has a known length. Anything not named here is
 * elastic: it carries no width and absorbs what these leave.
 *
 * `description` is absent on purpose even though it is resizable — it starts
 * elastic, and dragging it is what gives it a width for the first time.
 */
export const BANK_MEASURED_WIDTHS: Partial<Record<BankColumnKey, number>> = {
  date: COLUMN.DATE,
  amount: COLUMN.MONEY,
  category: COLUMN.PICKER,
};

/**
 * The column that never takes a width, whatever the reader drags.
 *
 * One per table, and it is what makes the row total the box rather than a
 * number that happens to be close to it: there is always exactly one column
 * absorbing the remainder.
 */
export const BANK_LAST_ELASTIC_KEY: BankColumnKey = "match";

/**
 * Floors. Description may be dragged and so needs one; Category holds a select
 * that cannot shrink past its own arrow.
 */
export const BANK_MIN_WIDTHS: Partial<Record<BankColumnKey, number>> = {
  description: COLUMN.TEXT_MIN,
  category: COLUMN.PICKER,
};

/**
 * The delete button, the attachments button and the selection checkbox — plus
 * what Match needs at its narrowest, which is the floor a drag stops at.
 */
export const BANK_BUDGET = {
  chrome: COLUMN.ACTION * 2 + COLUMN.SELECTION,
  elasticFloor: COLUMN.RICH_MIN,
};

/** Where this reader's own widths are kept. */
export const BANK_WIDTH_STORAGE_KEY = "onebook.bank-transactions.column-widths.v2";

/**
 * The key this replaces, removed on first read. It holds widths totalling
 * 1530px — the layout the complaint is about — and merging those over the new
 * defaults would hand the reader back the screen they reported.
 */
export const BANK_WIDTH_STORAGE_KEY_V1 = "onebook.bank-transactions.column-widths";
