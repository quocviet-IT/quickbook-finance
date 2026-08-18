"use client";

import type { CSSProperties, HTMLAttributes, PointerEvent as ReactPointerEvent } from "react";
import { TOKENS } from "@/lib/design/tokens";

/**
 * The header-cell renderer a `Table` is given through
 * `components: { header: { cell: ColumnHeaderCell } }`.
 *
 * It carries the two things a reader may do to a column heading, which are
 * the two things a spreadsheet lets them do:
 *
 *   * drag the heading itself, to move the column (RQ-01)
 *   * drag the heading's right edge, to resize the column (RQ-01-REV)
 *
 * Both are opt-in per column. A column only becomes draggable, a drop target,
 * or resizable when its own `onHeaderCell` supplies the props for it (see the
 * two hooks beside this file). Every OTHER header cell — the row-selection
 * checkbox Ant Design injects, and any `fixed: "right"` action column —
 * reaches this component with none of them set, so it renders exactly the
 * plain `<th>` Ant Design would have rendered itself. That is the whole
 * mechanism keeping those columns out of both interactions: this component
 * never singles them out by name, because it never has to. A column that was
 * never made a drag source cannot be picked up; a column whose cell never
 * calls `preventDefault()` on `dragover` is never accepted as a drop target
 * by the browser; and a column with no handle has nothing to grab.
 *
 * No hook of its own, deliberately. Being a plain function of its props is
 * what lets its whole contract be asserted by calling it — see
 * tests/unit/column-header-cell.test.ts. The guard that stops a drag on the
 * resize handle from also reordering the column is therefore NOT here; it is
 * in `useColumnResize`, which wraps `onDragStart` before it ever arrives.
 */
export interface ColumnHeaderCellProps extends HTMLAttributes<HTMLTableCellElement> {
  /** Set only on the column currently being dragged. */
  "data-dragging"?: boolean;
  /** Set only on the column currently under the pointer as a drop target. */
  "data-drop-target"?: boolean;
  /**
   * Begin a width drag. Present only on a resizable column; its absence is
   * what decides that no handle is drawn. Never reaches the DOM — it is
   * destructured out below, because Ant Design spreads these props straight
   * onto the `<th>` and this is not an attribute a `<th>` has.
   */
  onResizeStart?: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * Wide enough to find without hunting, narrow enough not to swallow clicks
 * meant for the heading. The change request asks for 6–8px; this is the
 * middle of it. Half of it overhangs the column boundary so the target reads
 * as the line between two headings rather than as part of one.
 */
const HANDLE_WIDTH = 7;

export function ColumnHeaderCell(props: ColumnHeaderCellProps) {
  const {
    style,
    children,
    "data-dragging": dragging,
    "data-drop-target": dropTarget,
    onResizeStart,
    ...rest
  } = props;

  const cellStyle: CSSProperties = {
    ...(rest.draggable ? { cursor: "grab" } : null),
    // Picked up: fades in place so the reader can still see where it came
    // from while they choose where it goes.
    ...(dragging ? { opacity: 0.4 } : null),
    // Hovering with a column in hand: an inset rule in the one colour this
    // codebase is allowed to draw with (lib/design/tokens.ts), so it stays
    // correct if the palette ever changes and never needs a hex value here.
    ...(dropTarget ? { boxShadow: `inset 3px 0 0 ${TOKENS.intent.primary}` } : null),
    // The handle is positioned against this cell, so the cell has to be a
    // positioning context — but only if it is not already one. A fixed
    // column arrives `position: sticky` with a `left` offset that means
    // nothing under `relative`, and forcing it would unpin the column.
    ...(onResizeStart && !style?.position ? { position: "relative" as const } : null),
  };

  if (!onResizeStart) {
    return <th {...rest} style={{ ...style, ...cellStyle }}>{children}</th>;
  }

  return (
    <th {...rest} style={{ ...style, ...cellStyle }}>
      {children}
      <span
        // Not a button and not focusable: it is a pointer affordance over a
        // table border, and putting it in the tab order would mean one extra
        // stop per column on the way to the data.
        aria-hidden
        draggable={false}
        onPointerDown={onResizeStart}
        style={{
          position: "absolute",
          top: 0,
          right: -Math.floor(HANDLE_WIDTH / 2),
          height: "100%",
          width: HANDLE_WIDTH,
          cursor: "col-resize",
          // Without this the browser claims a touch drag as a scroll and the
          // column never moves at all.
          touchAction: "none",
          // Stops a drag across the header from painting every heading it
          // passes as selected text.
          userSelect: "none",
          zIndex: 1,
        }}
      />
    </th>
  );
}
