import { COLUMN } from "@/lib/design/table-metrics";

/**
 * The statement import dialog's lines preview (2.04): its measured columns, the
 * floor of its one elastic column (Description), and how narrow it is drawn on
 * a phone.
 *
 * The figures here are the ones `import-statement.module.css` draws with;
 * change one and change the other, and
 * `tests/unit/statement-proof-screens.test.ts` adds them up. The table sits in
 * the dialog, so it fits the dialog's box rather than the page's.
 */
export const IMPORT_PREVIEW_WIDTH = {
  /** The "Not a transaction" tick, under its heading. */
  aside: 140,
  /** The date as the file has it, 2026-03-31: the date token measures exactly that. */
  date: COLUMN.DATE,
  amount: COLUMN.MONEY,
} as const;

/** Description takes what the measured columns leave, down to this. */
export const IMPORT_PREVIEW_ELASTIC_FLOOR = COLUMN.TEXT_MIN;

/** The dialog's width (ImportStatementModal). */
export const IMPORT_DIALOG_WIDTH = 720;

/** What a table inside it has: the dialog less its 24px padding a side. */
export const IMPORT_DIALOG_BOX = IMPORT_DIALOG_WIDTH - 48;

/** On a phone: every measured column, and Description at its floor; the table scrolls inside its own box. */
export const IMPORT_PREVIEW_MIN_WIDTH =
  IMPORT_PREVIEW_WIDTH.aside + IMPORT_PREVIEW_WIDTH.date + IMPORT_PREVIEW_WIDTH.amount + IMPORT_PREVIEW_ELASTIC_FLOOR;
