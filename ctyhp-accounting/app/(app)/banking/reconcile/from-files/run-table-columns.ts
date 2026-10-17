import { COLUMN } from "@/lib/design/table-metrics";

/**
 * The statements table of Reconcile > From statement files, and how wide each
 * column is drawn on a phone.
 *
 * At 1280 the table declares no widths and lays itself out, and that is left
 * as it is. In a phone's box five columns shared 375px: File, Period and
 * Opening drew their text over each other, and the Read column's proof tags
 * wrapped one word to a line. Under 640px (run-table.module.css) the table is
 * held to these widths plus Read's floor, and scrolls inside its own box, so
 * the page never scrolls sideways. The figures here are the ones the
 * stylesheet draws with; change one and change the other, and
 * `tests/unit/run-table-columns.test.ts` adds them up.
 */
export const RUN_TABLE_WIDTH = {
  /** A file name, kept to a couple of lines. */
  file: 200,
  /** "09/01/2026 – 09/30/2026". */
  period: 190,
  /** An amount with its currency symbol: wider than the bare figure COLUMN.MONEY_WIDE measures. */
  opening: COLUMN.MONEY_WIDE + 16,
  closing: COLUMN.MONEY_WIDE + 16,
} as const;

/** Read takes what the measured columns leave, down to this: room for a tag and a proof sentence on a few lines. */
export const RUN_TABLE_READ_FLOOR = 360;

/** The narrowest the table is drawn on a phone. */
export const RUN_TABLE_MIN_WIDTH =
  RUN_TABLE_WIDTH.file + RUN_TABLE_WIDTH.period + RUN_TABLE_WIDTH.opening + RUN_TABLE_WIDTH.closing + RUN_TABLE_READ_FLOOR;
