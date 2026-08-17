/**
 * RQ-01: drag a column header to change the display order, the way a reader
 * would in Excel or Google Sheets.
 *
 * This is the one piece of the feature that can actually be trusted by a
 * test. The drag mechanics — `onDragStart`/`onDragOver`/`onDrop`, the drop
 * indicator, the header-cell override — live in components/ui, where they
 * necessarily import Ant Design at runtime; this repository forbids that in
 * a test file (import type is free, a plain runtime import costs 55 seconds
 * per file), so nothing there can be exercised directly. What follows is the
 * part that decides what actually happens on a drop, kept dependency-free on
 * purpose so it can be.
 *
 * It is also the part an accountant would notice getting wrong. A table
 * renders every row's cells from the same `columns` array it renders the
 * header from — there is no second, separate "cell order" to fall out of
 * sync with the header order. So the one array this function returns IS the
 * column order for both the header row and every data row beneath it: get
 * the array right and a cell can never end up under the wrong heading,
 * because there is nowhere else for that misalignment to come from.
 */

/**
 * Move `draggedKey` to sit where `dropTargetKey` currently sits, shifting
 * everything between the two by one.
 *
 * This is the standard "array move" a sortable list uses: the dragged item
 * ends up at the target's ORIGINAL index once removed and reinserted, not
 * "just before" or "just after" it as a fixed rule. That single rule is what
 * makes both ends of the header reachable with nothing more than a column
 * key to drop on — drop on the first column and the dragged column becomes
 * first (everything shifts right); drop on the last column and it becomes
 * last (`Array.prototype.splice` clamps an out-of-range index to the array's
 * new length, so no special "last column" case is needed here). Which side
 * of the target the dragged column lands on falls out of that same rule:
 * dragging rightward past a target lands after it, dragging leftward past it
 * lands before it — the ordinary feel of a sortable list, without hit-testing
 * which half of the header cell the pointer is over.
 *
 * Two situations leave `order` unchanged, both deliberately silent rather
 * than thrown: a `draggedKey` or `dropTargetKey` this order does not
 * contain (a stray or stale key reaching this function is a caller bug, not
 * a reason to crash the table someone is reading), and a drop onto the
 * dragged column itself (the reader let go where they picked up; nothing
 * should move). A fresh array is still returned in both cases, so a caller
 * that always calls `setOrder(reorderColumns(...))` never has to special-case
 * "did anything change" itself.
 */
export function reorderColumns<K extends string>(
  order: readonly K[],
  draggedKey: K,
  dropTargetKey: K,
): K[] {
  const from = order.indexOf(draggedKey);
  const to = order.indexOf(dropTargetKey);
  if (from === -1 || to === -1 || from === to) return [...order];

  const next = order.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
