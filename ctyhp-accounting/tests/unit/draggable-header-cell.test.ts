import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { DraggableHeaderCell, type DraggableHeaderCellProps } from "@/components/ui/DraggableHeaderCell";
import { TOKENS } from "@/lib/design/tokens";

/**
 * DraggableHeaderCell carries no Ant Design import — it is a plain `<th>`
 * wrapper — so, like components/ui/columns.tsx, it can be exercised the same
 * way the rest of this repo tests a render function: call it directly and
 * read the React element it returns. No jsdom, no antd, no 55-second import.
 *
 * The drag *hook* that supplies these props from real pointer events lives
 * beside this component and is not tested here: it calls `useState` outside
 * a render, which has no dispatcher in this test environment and throws.
 * What is tested is everything this component actually decides on its own —
 * which is also everything a reviewer could get wrong without a browser
 * catching it, since nothing here needs a DOM to be judged correct.
 */
function asThElement(node: unknown): ReactElement<DraggableHeaderCellProps> {
  if (!isValidElement<DraggableHeaderCellProps>(node as Parameters<typeof isValidElement>[0])) {
    throw new Error("DraggableHeaderCell rendered no element");
  }
  return node as ReactElement<DraggableHeaderCellProps>;
}

describe("DraggableHeaderCell", () => {
  it("renders a plain th, untouched, for a header with no drag props", () => {
    // This is the pinned-column path: the row-selection checkbox and the
    // fixed-right action columns reach this component without draggable,
    // data-dragging or data-drop-target set, and must come out exactly as
    // Ant Design's own header cell would have rendered them. Fails if any
    // always-on style (cursor, opacity, outline) is ever added outside the
    // three conditions this component checks.
    const cell = asThElement(
      DraggableHeaderCell({ className: "ant-table-cell", style: { textAlign: "right" }, children: "Status" }),
    );
    expect(cell.type).toBe("th");
    expect(cell.props.className).toBe("ant-table-cell");
    expect(cell.props.style).toEqual({ textAlign: "right" });
    expect(cell.props.children).toBe("Status");
  });

  it("shows a grab cursor only once a column is marked draggable", () => {
    // Fails if the cursor is applied unconditionally instead of gated on the
    // same `draggable` flag the drag hook sets only for reorderable columns
    // — which would make every header, including the pinned ones, look
    // draggable even though none of them has a drag handler attached.
    const cell = asThElement(DraggableHeaderCell({ draggable: true }));
    expect(cell.props.style?.cursor).toBe("grab");
  });

  it("fades the column currently being dragged", () => {
    const cell = asThElement(DraggableHeaderCell({ draggable: true, "data-dragging": true }));
    // Fails if the opacity condition is removed or its threshold changed —
    // this is the only visual signal telling the reader which header they
    // actually picked up.
    expect(cell.props.style?.opacity).toBe(0.4);
  });

  it("marks the drop target with the design system's own colour token, not a literal", () => {
    const cell = asThElement(DraggableHeaderCell({ "data-drop-target": true }));
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
      DraggableHeaderCell({ style: { left: 88, position: "sticky" }, draggable: true, "data-dragging": true }),
    );
    expect(cell.props.style).toEqual({ left: 88, position: "sticky", cursor: "grab", opacity: 0.4 });
  });

  it("forwards the drag event handlers to the th unchanged", () => {
    // Fails if the component ever wraps or omits these instead of spreading
    // them straight through — the drag hook's onDragStart/onDragOver/onDrop
    // are what make the drop actually happen; a wrapped handler is easy to
    // get subtly wrong (e.g. forgetting preventDefault) in a way no type
    // error would catch.
    const onDragStart = () => {};
    const onDragOver = () => {};
    const onDrop = () => {};
    const cell = asThElement(DraggableHeaderCell({ draggable: true, onDragStart, onDragOver, onDrop }));
    expect(cell.props.onDragStart).toBe(onDragStart);
    expect(cell.props.onDragOver).toBe(onDragOver);
    expect(cell.props.onDrop).toBe(onDrop);
  });
});
