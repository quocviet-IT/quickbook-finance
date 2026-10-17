import { COLUMN } from "@/lib/design/table-metrics";

/**
 * The reconciliation workspace's three tables, and how narrow each is drawn on
 * a phone.
 *
 * The figures here are the ones `workspace.module.css` draws with; change one
 * and change the other, and `tests/unit/reconcile-history-screens.test.ts`
 * adds them up. Under 640px each table is held to its widths plus its floors
 * and scrolls inside its own box, so the page never scrolls sideways and the
 * right-hand columns ("With the books", Not a transaction / Restore, "Would
 * post to") can still be reached. At 1280 nothing here changes how a table is
 * drawn.
 */

/**
 * The statement lines table: its measured columns, in the order they are
 * drawn, and the floor of its one elastic column (Description).
 *
 * 2.03 adds a column for the line's action — Not a transaction, or Restore —
 * shown to someone who can write while the reconciliation is in progress. Its
 * width comes out of Description, and Date takes the date token, since the
 * table prints the date as 2026-07-13, the very format the token measures.
 * Kept apart from the client component so a unit test can add the row up
 * against the 984px box of a 1280px window.
 */
export const STATEMENT_LINE_WIDTH = {
  date: COLUMN.DATE,
  reference: 130,
  amount: 130,
  /** "Paired · check number · not ticked", or "Not in the books" with "Extra" beside it. */
  standing: 280,
  /** One small link button, "Not a transaction" at its longest. */
  aside: 148,
} as const;

/** Description takes what the measured columns leave, down to this. */
export const STATEMENT_LINE_ELASTIC_FLOOR = COLUMN.TEXT_MIN;

/** On a phone, with the line's action: every measured column, and Description at its floor. */
export const STATEMENT_LINES_MIN_WIDTH =
  STATEMENT_LINE_WIDTH.date +
  STATEMENT_LINE_WIDTH.reference +
  STATEMENT_LINE_WIDTH.amount +
  STATEMENT_LINE_WIDTH.standing +
  STATEMENT_LINE_WIDTH.aside +
  STATEMENT_LINE_ELASTIC_FLOOR;

/** On a phone, for someone who sees no action column (a viewer, or a reconciliation completed). */
export const STATEMENT_LINES_READ_MIN_WIDTH = STATEMENT_LINES_MIN_WIDTH - STATEMENT_LINE_WIDTH.aside;

/**
 * A cell of Ant Design's default size carries 16px of padding a side, where
 * the small tables the column tokens are measured in carry 8: 16px more a
 * column.
 */
const DEFAULT_SIZE_EXTRA = 16;

/**
 * The ledger lines table declares no widths: at 1280 it lays itself out, and
 * that is left as it is. These are what its columns need to keep their text
 * on one line — the tokens, plus the default size's padding — used only for
 * the narrowest it is drawn on a phone, where its dates and entry numbers
 * otherwise broke over two lines and Amount fell off the right-hand edge.
 */
export const LEDGER_LINE_WIDTH = {
  /** "Cleared" over one checkbox. */
  cleared: 72 + DEFAULT_SIZE_EXTRA,
  date: COLUMN.DATE + DEFAULT_SIZE_EXTRA,
  entry: COLUMN.CODE + DEFAULT_SIZE_EXTRA,
  /** One tag: manual, bank, invoice… */
  source: COLUMN.STATUS + DEFAULT_SIZE_EXTRA,
  reference: COLUMN.CODE + DEFAULT_SIZE_EXTRA,
  amount: COLUMN.MONEY + DEFAULT_SIZE_EXTRA,
  /** The "Outstanding" tag. */
  outstanding: COLUMN.STATUS + DEFAULT_SIZE_EXTRA,
} as const;

/** Memo, typed text, at its floor. */
export const LEDGER_LINE_ELASTIC_FLOOR = COLUMN.TEXT_MIN;

export const LEDGER_LINES_MIN_WIDTH =
  LEDGER_LINE_WIDTH.cleared +
  LEDGER_LINE_WIDTH.date +
  LEDGER_LINE_WIDTH.entry +
  LEDGER_LINE_WIDTH.source +
  LEDGER_LINE_WIDTH.reference +
  LEDGER_LINE_WIDTH.amount +
  LEDGER_LINE_WIDTH.outstanding +
  LEDGER_LINE_ELASTIC_FLOOR;

/**
 * The Add missing box's "Would post to" table (a small DataTable). Description
 * carries no width and takes what is left; on a phone it had none left, and
 * ran over Amount.
 */
export const ADD_MISSING_WIDTH = {
  /** "09/30/2026". */
  date: 120,
  amount: 130,
  /** The account, with "needs coding" or the rule beside it. */
  postTo: 300,
} as const;

export const ADD_MISSING_ELASTIC_FLOOR = COLUMN.TEXT_MIN;

export const ADD_MISSING_MIN_WIDTH =
  ADD_MISSING_WIDTH.date + ADD_MISSING_WIDTH.amount + ADD_MISSING_WIDTH.postTo + ADD_MISSING_ELASTIC_FLOOR;
