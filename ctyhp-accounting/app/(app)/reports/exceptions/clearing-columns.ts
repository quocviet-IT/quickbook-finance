import { COLUMN } from "@/lib/design/table-metrics";

/**
 * The clearing table's row, measured for the 984px box (see `fitsBox`): the
 * balance and the tag are fixed, and the account, what it still holds and its
 * last movement share what is left.
 */
export const CLEARING_TAG_WIDTH = 132;
export const CLEARING_FIXED_WIDTHS: readonly number[] = [COLUMN.MONEY_WIDE, CLEARING_TAG_WIDTH];
/** Three elastic columns, each at its text floor. */
export const CLEARING_ELASTIC_FLOOR = COLUMN.TEXT_MIN * 3;
