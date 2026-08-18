/**
 * How wide each column is, and what a reader is allowed to make it.
 *
 * RQ-01-REV (follow-up video, 2026-08-18). The first reading of RQ-01 was
 * that dragging a column header should move the column; the reviewer watched
 * that ship and said plainly it was not what they asked for:
 *
 *   "The one that I suggested is not a drag for like this one. Not this one."
 *   "I want is like a Excel feature where you can minimize—maximize a column."
 *   "Because look at this, you have to scroll again, wherever in left or right."
 *
 * Their problem is horizontal scrolling, not column order. Description holds
 * long text, so it pushes Amount and Category off the side of the screen and
 * they scroll back and forth to compare two numbers. Moving a column does not
 * fix that. Narrowing one does. Both interactions now exist, which is what
 * Excel itself offers: drag the middle of a heading to move it, drag the edge
 * to resize it.
 *
 * Everything here is pure arithmetic on numbers — no React, no DOM, no
 * storage API — so the rules that decide how far a column may shrink can be
 * asserted directly rather than through a rendered table.
 */

/**
 * A column may not shrink past this.
 *
 * 60px still shows a truncated value, and — the part that matters — it still
 * leaves the resize handle itself wide enough to grab, so narrowing stays
 * reversible. A column dragged to zero would be a column nobody could get
 * back.
 */
export const MIN_COLUMN_WIDTH = 60;

/**
 * And it may not grow past this.
 *
 * Wider than any column ships at today (Match, the widest, is 300) and still
 * under half of an ordinary 1440px screen, so one column can never take over
 * the viewport the way the change request asks it must not.
 */
export const MAX_COLUMN_WIDTH = 800;

/**
 * A width, made safe to render.
 *
 * Whole pixels: a pointer delta arrives fractional on a scaled display, and a
 * column re-rendering at 187.5px then 187.6px costs renders and shows nobody
 * anything. `NaN` collapses to the minimum rather than propagating into a
 * style attribute, where it would silently drop the width entirely.
 */
export function clampColumnWidth(px: number): number {
  if (Number.isNaN(px)) return MIN_COLUMN_WIDTH;
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, px)));
}

/**
 * The width a column should have while the pointer is this far from where the
 * drag started.
 *
 * Measured from the width at pointer-down and the total travel since — never
 * by adding each frame's delta to the last frame's width. Accumulating
 * deltas drifts against the pointer once the clamp starts discarding
 * movement, and the column ends up somewhere the pointer is not.
 */
export function resizedWidth(startWidth: number, deltaX: number): number {
  return clampColumnWidth(startWidth + deltaX);
}

/**
 * Widths recovered from storage, narrowed to what this table can actually use.
 *
 * Every hostile shape is answered with "nothing stored" rather than an
 * exception: `localStorage` is editable by hand, shared with every other tab,
 * and survives releases that removed the columns it names. A table that threw
 * while reading it would be a blank screen — a far worse outcome than a
 * column at its default width.
 */
export function parseStoredWidths<K extends string>(
  raw: string | null,
  allowedKeys: readonly K[],
): Partial<Record<K, number>> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  // Arrays are objects too, and `typeof null` is "object" — both would pass a
  // bare typeof check and neither is a width map.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

  const source = parsed as Record<string, unknown>;
  const widths: Partial<Record<K, number>> = {};
  for (const key of allowedKeys) {
    const value = source[key];
    // Infinity is a number and is not usable; a stored string never is.
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    // Clamped, not rejected: a stored width is a preference, and bounds can
    // tighten between releases without making the preference meaningless.
    widths[key] = clampColumnWidth(value);
  }
  return widths;
}

/** What goes into storage. The inverse of `parseStoredWidths`. */
export function serializeColumnWidths(widths: Record<string, number>): string {
  return JSON.stringify(widths);
}

/**
 * The shipped widths, with the reader's own preferences laid over the top.
 *
 * A column they never resized keeps the width it ships at, so a new column
 * added in a later release appears at its designed width rather than at
 * whatever a stale storage entry happens to hold.
 */
export function mergeColumnWidths<K extends string>(
  defaults: Record<K, number>,
  stored: Partial<Record<K, number>>,
): Record<K, number> {
  return { ...defaults, ...stored };
}

/**
 * How wide the whole table is, which is the number its horizontal scroll needs.
 *
 * This is the part that makes resizing worth doing at all. Ant Design's table
 * falls back to `table-layout: auto` when `scroll.x` is `"max-content"` and
 * the table has a pinned column — and under `auto` a declared column width is
 * a hint the browser may ignore, so narrowing Description would change a
 * number and not the screen. Handing the table a real total instead puts it
 * in `fixed` layout, where the widths are binding and the scrollbar actually
 * gets shorter as columns get narrower.
 *
 * `pinnedWidth` is the fixed action columns, which the reader cannot resize
 * but which still occupy the row.
 */
export function totalColumnWidth(widths: Record<string, number>, pinnedWidth: number): number {
  return Object.values(widths).reduce((sum, width) => sum + width, 0) + pinnedWidth;
}
