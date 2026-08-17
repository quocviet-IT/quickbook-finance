"use client";

import type { CSSProperties, HTMLAttributes } from "react";
import { TOKENS } from "@/lib/design/tokens";

/**
 * RQ-01: the header-cell renderer a `Table` is given through
 * `components: { header: { cell: DraggableHeaderCell } }`.
 *
 * A column only becomes draggable, or a valid drop target, when its own
 * column definition supplies `onHeaderCell` returning the props below (see
 * the drag hook alongside this file). Every OTHER header cell — the
 * row-selection checkbox Ant Design injects, and any `fixed: "right"` action
 * column — reaches this component with none of them set, so it renders
 * exactly the plain `<th>` Ant Design would have rendered itself. That is
 * the whole mechanism that keeps those columns out of the reorder: this
 * component never singles them out by name, because it never has to. A
 * column that was never made a drag source cannot be picked up, and a column
 * whose cell never calls `preventDefault()` on `dragover` is never accepted
 * as a drop target by the browser — native behaviour, not a check written
 * here.
 */
export interface DraggableHeaderCellProps extends HTMLAttributes<HTMLTableCellElement> {
  /** Set only on the column currently being dragged. */
  "data-dragging"?: boolean;
  /** Set only on the column currently under the pointer as a drop target. */
  "data-drop-target"?: boolean;
}

export function DraggableHeaderCell(props: DraggableHeaderCellProps) {
  const { style, "data-dragging": dragging, "data-drop-target": dropTarget, ...rest } = props;

  const dragStyle: CSSProperties = {
    ...(rest.draggable ? { cursor: "grab" } : null),
    // Picked up: fades in place so the reader can still see where it came
    // from while they choose where it goes.
    ...(dragging ? { opacity: 0.4 } : null),
    // Hovering with a column in hand: an inset rule in the one colour this
    // codebase is allowed to draw with (lib/design/tokens.ts), so it stays
    // correct if the palette ever changes and never needs a hex value here.
    ...(dropTarget ? { boxShadow: `inset 3px 0 0 ${TOKENS.intent.primary}` } : null),
  };

  return <th {...rest} style={{ ...style, ...dragStyle }} />;
}
