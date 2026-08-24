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
  /** An amount with tabular figures, up to -327,089.13 — the largest on file. */
  MONEY: 116,
  /** A running balance, which carries one more digit than the amounts do. */
  MONEY_WIDE: 124,
  /** A document number, an account code, a prefix. */
  CODE: 110,
  /** One tag, such as "For review". */
  STATUS: 104,
  /** A count or a percentage. */
  QTY: 88,
  /** A select rendered inside the cell, which needs room for its arrow. */
  PICKER: 150,
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
