/**
 * How wide a column is allowed to be, in one place.
 *
 * A reader filed the same complaint four times between 2026-08-01 and
 * 2026-08-22: the columns have gaps, and the useful ones are off the side of
 * the screen. Both halves were one fault. `/banking` spent 200px on an account
 * name identical on every row and 135px on a column of em dashes, and pushed
 * Match and Status past the right-hand edge to do it.
 *
 * So a width is no longer a number somebody picks per screen. A column whose
 * content has a known length takes a token from here; a column holding text
 * somebody typed takes no width at all and absorbs what is left.
 *
 * Plain numbers, no imports: `tests/unit/table-metrics.test.ts` asserts against
 * them directly, and `fitsBox` lets each screen assert its own row without
 * rendering a table.
 */
export const COLUMN = {
  /** A date as this app prints it: 2026-07-13. */
  DATE: 88,
  /** A date and a time, "10/19/2026 10:42 AM" at 14px, with the cell's padding. */
  DATE_TIME: 160,
  /** An amount with tabular figures, up to -327,089.13 — the largest on file. */
  MONEY: 116,
  /** A running balance, which carries one more digit than the amounts do. */
  MONEY_WIDE: 124,
  /** A document number, an account code, a prefix. */
  CODE: 110,
  /**
   * One status tag, up to "Partially received": a 93px word and 31px of
   * icon, padding and border, in a cell with 8px either side, measured on the
   * page. At 104 the shared tag's border stopped short of "Partially paid".
   */
  STATUS: 140,
  /** A count or a percentage. */
  QTY: 88,
  /** A select rendered inside the cell, which needs room for its arrow. */
  PICKER: 150,
  /**
   * A switch under a heading up to "Segregation of duties": a 137px heading
   * and 8px either side, measured on Approval Policies. The switch is 44.
   */
  SWITCH: 160,
  /** One icon button. A group of three is 120. */
  ACTION: 40,
  /** Ant Design's row-selection checkbox column. */
  SELECTION: 36,
  /**
   * The floor for an elastic column holding text. 200px still shows enough of
   * a wire description to tell two lines apart, and the whole value is one
   * hover away.
   */
  TEXT_MIN: 200,
  /**
   * The floor for an elastic column holding controls. Match carries a tag, a
   * line of text and up to three buttons; below 240 those stack into the
   * broken pile a reader screenshotted in August.
   */
  RICH_MIN: 240,
} as const;

/**
 * The table's own width at the narrowest viewport this design supports.
 *
 * 1280 - 248 (Sider, components/AppShell.tsx) - 48 (.app-shell__content
 * margin, app/globals.css) = 984. Every reworked table has to fit here, not
 * merely on the reporter's 1470px screen.
 */
export const TABLE_BOX_AT_1280 = 984;

/**
 * Whether a row of columns fits, given what its elastic columns need at their
 * narrowest.
 *
 * `measured` is every fixed width in the row including the pinned actions and
 * the selection checkbox; `elasticFloor` is the sum of the floors of the
 * columns that carry no width. A screen calls this in its own unit test, so a
 * column added later fails a test rather than a reader's screen.
 */
export function fitsBox(
  measured: number,
  elasticFloor: number,
  box: number = TABLE_BOX_AT_1280,
): boolean {
  return measured + elasticFloor <= box;
}

/** The little of a column `tableFloorWidth` reads; an Ant Design column has all of it. */
export interface FloorColumn {
  width?: unknown;
  /** Carried by `flexColumn` (components/ui/columns.tsx): the elastic column's floor. */
  minWidth?: unknown;
  hidden?: boolean;
  children?: readonly FloorColumn[];
}

/**
 * The narrowest a held-to-its-box table can be drawn without losing a column:
 * every declared width, plus every elastic column's floor, plus the selection
 * checkbox and the expand button when the table has them.
 *
 * Under `table-layout: fixed` a column with no width gets only what the
 * declared ones leave. On a phone they leave nothing — Sales Receipts declares
 * 614px for a 358px frame — and Customer was drawn zero wide, gone from the
 * table with no sign it was ever there (system check, 2026-10-24: 46 columns
 * on 40 tables). DataTable sets this as the table's minimum width below 768px,
 * so a phone's frame scrolls instead; wider, tableMinimumWidth applies.
 */
export function tableFloorWidth(
  columns: readonly FloorColumn[] | undefined,
  extras: { selection?: boolean; expandable?: boolean } = {},
): number {
  const leaves = (list: readonly FloorColumn[]): number =>
    list.reduce((sum, column) => {
      if (column.hidden) return sum;
      if (column.children?.length) return sum + leaves(column.children);
      if (typeof column.width === "number") return sum + column.width;
      return sum + (typeof column.minWidth === "number" ? column.minWidth : 0);
    }, 0);
  return (
    leaves(columns ?? []) +
    (extras.selection ? COLUMN.SELECTION : 0) +
    (extras.expandable ? EXPAND_COLUMN_WIDTH : 0)
  );
}

/** Ant Design's expand-row button column at size="small". */
export const EXPAND_COLUMN_WIDTH = 48;

/**
 * The least an elastic column is ever drawn, at any width: a few letters and
 * an ellipsis, with the whole value in its tooltip. Enough to show the column
 * is there; not enough to read it, which is what the floor is for.
 */
export const ELASTIC_COLUMN_MIN = 48;

/**
 * The narrowest a fitted table is ever drawn on a computer: every declared
 * width, and ELASTIC_COLUMN_MIN for each column that declares none (with or
 * without a floor).
 *
 * The floor itself (tableFloorWidth) holds only on a phone. At 1280 sixteen
 * tables are a little wider than their box at their elastic floors — the page
 * scrollbar takes 15px of the 984 the arithmetic assumes — and there the
 * elastic column has always given way rather than the row scrolling. This
 * keeps that, and stops it giving way to nothing.
 */
export function tableMinimumWidth(
  columns: readonly FloorColumn[] | undefined,
  extras: { selection?: boolean; expandable?: boolean } = {},
): number {
  const leaves = (list: readonly FloorColumn[]): number =>
    list.reduce((sum, column) => {
      if (column.hidden) return sum;
      if (column.children?.length) return sum + leaves(column.children);
      return sum + (typeof column.width === "number" ? column.width : ELASTIC_COLUMN_MIN);
    }, 0);
  return (
    leaves(columns ?? []) +
    (extras.selection ? COLUMN.SELECTION : 0) +
    (extras.expandable ? EXPAND_COLUMN_WIDTH : 0)
  );
}
