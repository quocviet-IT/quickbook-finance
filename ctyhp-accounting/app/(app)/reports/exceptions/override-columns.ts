import { COLUMN } from "@/lib/design/table-metrics";

/**
 * The statements-imported-out-of-balance table's row, measured for the 984px box
 * (see `fitsBox`): the date and time, the amount and the open-since date are
 * fixed, and four text columns share what is left, each with its own floor.
 */
export const OVERRIDE_IMPORTED_WIDTH = 150;
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
