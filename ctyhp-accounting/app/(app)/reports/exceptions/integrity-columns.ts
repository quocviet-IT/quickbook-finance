import { COLUMN } from "@/lib/design/table-metrics";

/**
 * The two reconciliation-integrity tables' rows, measured for the 984px box
 * (see `fitsBox`): what is fixed is listed, and what is elastic keeps a floor.
 */

/* ---- Reconciliations that no longer agree ---- */

// "Sep 30, 2026" on one line, with room for the header.
export const CHANGED_STATEMENT_WIDTH = 130;
export const CHANGED_FIXED_WIDTHS: readonly number[] = [CHANGED_STATEMENT_WIDTH];
export const CHANGED_ACCOUNT_FLOOR = 160;
/** The sentences: several lines of words, so the widest floor. */
export const CHANGED_SENTENCES_FLOOR = 320;
export const CHANGED_ELASTIC_FLOOR = CHANGED_ACCOUNT_FLOOR + CHANGED_SENTENCES_FLOOR;
/** The narrowest the table is drawn on a phone (integrity-tables.module.css). */
export const CHANGED_MIN_WIDTH = CHANGED_FIXED_WIDTHS.reduce((sum, w) => sum + w, 0) + CHANGED_ELASTIC_FLOOR;

/* ---- Transfers cleared on one side only ---- */

// "JE-000123" over "Sep 28, 2026".
export const TRANSFER_ENTRY_WIDTH = COLUMN.CODE + 30;
export const TRANSFER_FIXED_WIDTHS: readonly number[] = [TRANSFER_ENTRY_WIDTH, COLUMN.MONEY_WIDE];
export const TRANSFER_CLEARED_FLOOR = 180;
export const TRANSFER_OPEN_FLOOR = 150;
export const TRANSFER_DESTINATION_FLOOR = 200;
export const TRANSFER_ELASTIC_FLOOR = TRANSFER_CLEARED_FLOOR + TRANSFER_OPEN_FLOOR + TRANSFER_DESTINATION_FLOOR;
/** The narrowest the table is drawn on a phone (integrity-tables.module.css). */
export const TRANSFER_MIN_WIDTH = TRANSFER_FIXED_WIDTHS.reduce((sum, w) => sum + w, 0) + TRANSFER_ELASTIC_FLOOR;
