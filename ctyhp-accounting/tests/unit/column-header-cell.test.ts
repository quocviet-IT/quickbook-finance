import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { ColumnHeaderCell, type ColumnHeaderCellProps } from "@/components/ui/ColumnHeaderCell";
import { TOKENS } from "@/lib/design/tokens";

/**
 * ColumnHeaderCell carries no Ant Design import — it is a plain `<th>`
 * wrapper — so, like components/ui/columns.tsx, it can be exercised the same
 * way the rest of this repo tests a render function: call it directly and
 * read the React element it returns. No jsdom, no antd, no 55-second import.
 *
 * That property is deliberate and is why this component holds no hook of its
 * own: `useState`/`useRef` outside a render has no dispatcher here and throws.
 * The hooks that feed it from real pointer events — `useColumnDrag` and
 * `useColumnResize` — live beside it and are not tested here. What is tested
 * is everything this component decides on its own, which is also everything a
 * reviewer could get wrong without a browser catching it.
 */
function asThElement(node: unknown): ReactElement<ColumnHeaderCellProps> {
  if (!isValidElement<ColumnHeaderCellProps>(node as Parameters<typeof isValidElement>[0])) {
    throw new Error("ColumnHeaderCell rendered no element");
  }
  return node as ReactElement<ColumnHeaderCellProps>;
}

/** The handle, when this cell has one. Second child, after the heading. */
function handleOf(cell: ReactElement<ColumnHeaderCellProps>) {
  const children = cell.props.children;
  if (!Array.isArray(children)) return null;
  const handle = children[1];
  return isValidElement<Record<string, unknown>>(handle) ? handle : null;
}

describe("ColumnHeaderCell — the plain cell", () => {
  it("renders a plain th, untouched, for a header with no drag and no resize", () => {
    // This is the pinned-column path: the row-selection checkbox and the
    // fixed-right action columns reach this component without draggable,
    // data-dragging, data-drop-target or onResizeStart set, and must come out
    // exactly as Ant Design's own header cell would have rendered them. Fails
    // if any always-on style (cursor, opacity, position, outline) is ever
    // added outside the conditions this component checks.
    const cell = asThElement(
      ColumnHeaderCell({ className: "ant-table-cell", style: { textAlign: "right" }, children: "Status" }),
    );
    expect(cell.type).toBe("th");
    expect(cell.props.className).toBe("ant-table-cell");
    expect(cell.props.style).toEqual({ textAlign: "right" });
    expect(cell.props.children).toBe("Status");
  });
});

describe("ColumnHeaderCell — dragging to reorder", () => {
  it("shows a grab cursor only once a column is marked draggable", () => {
    // Fails if the cursor is applied unconditionally instead of gated on the
    // same `draggable` flag the drag hook sets only for reorderable columns
    // — which would make every header, including the pinned ones, look
    // draggable even though none of them has a drag handler attached.
    const cell = asThElement(ColumnHeaderCell({ draggable: true }));
    expect(cell.props.style?.cursor).toBe("grab");
  });

  it("fades the column currently being dragged", () => {
    const cell = asThElement(ColumnHeaderCell({ draggable: true, "data-dragging": true }));
    // Fails if the opacity condition is removed or its threshold changed —
    // this is the only visual signal telling the reader which header they
    // actually picked up.
    expect(cell.props.style?.opacity).toBe(0.4);
  });

  it("marks the drop target with the design system's own colour token, not a literal", () => {
    const cell = asThElement(ColumnHeaderCell({ "data-drop-target": true }));
    // Reads the live token rather than hard-coding a hex string in the test:
    // fails if the component is ever changed to draw the indicator in any
    // colour that is not TOKENS.intent.primary — including a hard-coded hex,
    // which would also fail the separate no-hard-coded-colour guard.
    expect(cell.props.style?.boxShadow).toBe(`inset 3px 0 0 ${TOKENS.intent.primary}`);
  });

  it("merges the drag styling into the caller's own style instead of replacing it", () => {
    // Ant Design's own header cell carries real layout in `style` (sticky
    // offsets, fixed-column positioning). Fails if this component ever
    // overwrites `style` wholesale instead of spreading into it — which
    // would silently break sticky headers and fixed columns the moment a
    // drag starts.
    const cell = asThElement(
      ColumnHeaderCell({ style: { left: 88, position: "sticky" }, draggable: true, "data-dragging": true }),
    );
    expect(cell.props.style).toEqual({ left: 88, position: "sticky", cursor: "grab", opacity: 0.4 });
  });

  it("forwards the drag event handlers to the th unchanged", () => {
    // Fails if the component ever wraps or omits these instead of spreading
    // them straight through. It matters more now than it did: the guard that
    // stops a resize from turning into a reorder lives in useColumnResize,
    // which wraps onDragStart *before* it reaches this component. If this
    // component started wrapping it too there would be two guards, neither
    // obviously in charge.
    const onDragStart = () => {};
    const onDragOver = () => {};
    const onDrop = () => {};
    const cell = asThElement(ColumnHeaderCell({ draggable: true, onDragStart, onDragOver, onDrop }));
    expect(cell.props.onDragStart).toBe(onDragStart);
    expect(cell.props.onDragOver).toBe(onDragOver);
    expect(cell.props.onDrop).toBe(onDrop);
  });
});

describe("ColumnHeaderCell — the resize handle", () => {
  it("grows no handle on a column the reader may not resize", () => {
    // The pinned Delete and attachment columns, and the selection checkbox,
    // never receive onResizeStart. Fails if a handle is rendered for every
    // header instead of only where one was asked for — a handle on a 56px
    // pinned column would sit over the button it holds.
    const cell = asThElement(ColumnHeaderCell({ draggable: true, children: "Status" }));
    expect(cell.props.children).toBe("Status");
  });

  it("puts the handle after the heading, not in place of it", () => {
    // Fails if the handle ever replaces `children`, which would render a
    // column of blank headings with a drag strip where the title used to be.
    const cell = asThElement(ColumnHeaderCell({ children: "Amount", onResizeStart: () => {} }));
    expect(Array.isArray(cell.props.children)).toBe(true);
    expect((cell.props.children as unknown[])[0]).toBe("Amount");
    expect(handleOf(cell)).not.toBeNull();
  });

  it("gives the handle a resize cursor and a hit area wide enough to find", () => {
    // The change request asks for 6-8px. Below that the handle is a pixel
    // hunt; the reviewer's complaint was about effort, so a handle that is
    // hard to grab fails the requirement even though it technically resizes.
    const handle = handleOf(asThElement(ColumnHeaderCell({ onResizeStart: () => {} })));
    const style = handle?.props.style as Record<string, unknown>;
    expect(style.cursor).toBe("col-resize");
    expect(Number(style.width)).toBeGreaterThanOrEqual(6);
    expect(Number(style.width)).toBeLessThanOrEqual(8);
  });

  it("stops the browser from scrolling or selecting text while the handle is dragged", () => {
    // touchAction none is what makes a pointer drag work at all on a touch
    // screen — without it the browser claims the gesture as a scroll and the
    // column never moves. userSelect none stops a drag from painting the
    // whole header blue on the way past.
    const handle = handleOf(asThElement(ColumnHeaderCell({ onResizeStart: () => {} })));
    const style = handle?.props.style as Record<string, unknown>;
    expect(style.touchAction).toBe("none");
    expect(style.userSelect).toBe("none");
  });

  it("starts the resize from the handle's own pointerdown", () => {
    const onResizeStart = () => {};
    const handle = handleOf(asThElement(ColumnHeaderCell({ onResizeStart })));
    expect(handle?.props.onPointerDown).toBe(onResizeStart);
  });

  it("never leaks onResizeStart onto the th as a DOM attribute", () => {
    // Ant Design spreads whatever onHeaderCell returns straight onto the
    // cell. `onResizeStart` is not a DOM prop, so leaving it in would put a
    // React unknown-prop warning on every header of every resizable table.
    const cell = asThElement(ColumnHeaderCell({ onResizeStart: () => {} }));
    expect("onResizeStart" in cell.props).toBe(false);
  });

  it("anchors the handle by making the cell a positioning context", () => {
    // The handle is absolutely positioned against the cell. Without this the
    // handle would anchor to whichever ancestor happens to be positioned —
    // in a sticky table header, the wrong one.
    const cell = asThElement(ColumnHeaderCell({ onResizeStart: () => {} }));
    expect(cell.props.style?.position).toBe("relative");
  });

  it("leaves a cell that already has a position alone", () => {
    // A fixed column is `position: sticky` and carries a `left` offset that
    // means nothing once the position changes. Fails if the component ever
    // forces relative unconditionally, which would unpin the column.
    const cell = asThElement(
      ColumnHeaderCell({ style: { position: "sticky", left: 88 }, onResizeStart: () => {} }),
    );
    expect(cell.props.style?.position).toBe("sticky");
    expect(cell.props.style?.left).toBe(88);
  });
});
