import { COLUMN } from "@/lib/design/table-metrics";

/**
 * The comparison table's row, measured for the 984px box (see `fitsBox`): the
 * code, OneBook's balance, the box for the other system's figure and the
 * difference are fixed; the account name takes what is left.
 */
export const COMPARISON_CODE_WIDTH = 100;
export const COMPARISON_ONEBOOK_WIDTH = COLUMN.MONEY_WIDE;
/** A figure box with room for "(1,234,567.89)" and a short error under it. */
export const COMPARISON_OTHER_WIDTH = 170;
export const COMPARISON_DIFFERENCE_WIDTH = COLUMN.MONEY_WIDE;

export const COMPARISON_FIXED_WIDTHS: readonly number[] = [
  COMPARISON_CODE_WIDTH,
  COMPARISON_ONEBOOK_WIDTH,
  COMPARISON_OTHER_WIDTH,
  COMPARISON_DIFFERENCE_WIDTH,
];

/** Enough for a name and the sentence under an inactive account's row. */
export const COMPARISON_ACCOUNT_FLOOR = 220;

/**
 * The narrowest the table is drawn on a phone (balance-comparison.module.css):
 * it scrolls inside its own box there. Change one and change the other.
 */
export const COMPARISON_MIN_WIDTH =
  COMPARISON_FIXED_WIDTHS.reduce((sum, w) => sum + w, 0) + COMPARISON_ACCOUNT_FLOOR;
