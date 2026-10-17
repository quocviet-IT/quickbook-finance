import { COLUMN } from "@/lib/design/table-metrics";

/**
 * The statements-imported-out-of-balance table's row, measured for the 984px box
 * (see `fitsBox`): the date and time, the amount and the open-since date are
 * fixed, and four text columns share what is left, each with its own floor.
 */
// "10/14/2026 11:47 AM" on one line.
export const OVERRIDE_IMPORTED_WIDTH = 170;
export const OVERRIDE_SINCE_WIDTH = 120;
export const OVERRIDE_FIXED_WIDTHS: readonly number[] = [
  OVERRIDE_IMPORTED_WIDTH,
  COLUMN.MONEY_WIDE,
  OVERRIDE_SINCE_WIDTH,
];

export const OVERRIDE_ACCOUNT_FLOOR = 140;
export const OVERRIDE_FILE_FLOOR = 140;
export const OVERRIDE_BY_FLOOR = 120;
export const OVERRIDE_REASON_FLOOR = 160;
export const OVERRIDE_ELASTIC_FLOOR =
  OVERRIDE_ACCOUNT_FLOOR + OVERRIDE_FILE_FLOOR + OVERRIDE_BY_FLOOR + OVERRIDE_REASON_FLOOR;

/**
 * The narrowest the table is drawn on a phone (overrides-table.module.css): it
 * scrolls inside its own box there, and each sentence keeps its floor.
 */
export const OVERRIDE_MIN_WIDTH = OVERRIDE_FIXED_WIDTHS.reduce((sum, w) => sum + w, 0) + OVERRIDE_ELASTIC_FLOOR;
