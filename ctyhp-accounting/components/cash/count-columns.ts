import { COLUMN } from "@/lib/design/table-metrics";

/**
 * The counts table's row, measured for the drawer's body: the date, three
 * amounts, the status and the entry number are fixed, and the name of whoever
 * counted takes what is left, never less than its floor (see `fitsBox`).
 */
export const COUNT_DATE_WIDTH = 100;
export const COUNT_ENTRY_WIDTH = COLUMN.CODE;
export const COUNT_FIXED_WIDTHS: readonly number[] = [
  COUNT_DATE_WIDTH,
  COLUMN.MONEY_WIDE,
  COLUMN.MONEY_WIDE,
  COLUMN.MONEY_WIDE,
  COLUMN.STATUS,
  COUNT_ENTRY_WIDTH,
];
export const COUNT_BY_FLOOR = 120;

/** The drawer's width and the room its body leaves the table (24px padding a side). */
export const COUNTS_DRAWER_WIDTH = 900;
export const COUNTS_DRAWER_BODY = COUNTS_DRAWER_WIDTH - 48;

/** The narrowest the table is drawn on a phone (count-cash.module.css): it scrolls inside its own box there. */
export const COUNTS_MIN_WIDTH = COUNT_FIXED_WIDTHS.reduce((sum, w) => sum + w, 0) + COUNT_BY_FLOOR;
