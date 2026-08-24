"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  MIN_COLUMN_WIDTH,
  discardOversizeWidths,
  mergeColumnWidths,
  parseStoredWidths,
  resizeWithinBox,
  serializeColumnWidths,
} from "@/lib/domain/column-width";
import { TABLE_BOX_AT_1280 } from "@/lib/design/table-metrics";
import type { ColumnHeaderCellProps } from "./ColumnHeaderCell";

/**
 * RQ-01-REV: dragging the edge of a column heading to change its width.
 *
 * Deliberately thin, for the same reason `useColumnDrag` beside it is: a hook
 * cannot be called outside a render in this test environment, so nothing here
 * runs under `vitest run`. Every decision worth getting wrong therefore lives
 * in `lib/domain/column-width.ts`, which is dependency-free and tested
 * directly — how far a column may shrink, what a corrupted stored value
 * means, which stored keys still exist. What is left in this file is
 * plumbing: remember where the pointer started, listen until it is released,
 * and write the result down.
 *
 * Two details here are load-bearing and easy to lose in an edit:
 *
 * **The listeners are on `window`, not on the handle.** The change request
 * requires a resize to end cleanly when the pointer is released outside the
 * table, and a reader dragging a column narrow will routinely leave the
 * table on the way. Handle-bound listeners would stop firing the moment the
 * pointer left the 7px strip and the column would freeze mid-drag.
 *
 * **`dragRef` is a ref, not state.** It is read from `onDragStart` — a native
 * event that fires within the same gesture as the `pointerdown` that sets it.
 * A `useState` update would not have been applied yet at that moment, and the
 * reorder would fire on top of the resize.
 */
export interface UseColumnResizeResult<K extends string> {
  /**
   * The width of every column that has one, in pixels, never outside the
   * bounds. A key that is absent has no width at all: that is an elastic
   * column, absorbing whatever the measured ones leave. Dragging one is what
   * gives it a width for the first time.
   */
  widths: Partial<Record<K, number>>;
  /**
   * Props for a resizable column's `onHeaderCell`. A column that never calls
   * this grows no handle, which is how the pinned action columns and the
   * selection checkbox stay unresizable — see ColumnHeaderCell.
   *
   * Typed as the header cell's own props rather than as the bare handler:
   * Ant Design's `onHeaderCell` is declared to return `HTMLAttributes`, and an
   * object holding nothing but `onResizeStart` has no property in common with
   * that, so it is rejected outright. `ColumnHeaderCellProps` extends
   * `HTMLAttributes`, which is exactly the relationship that makes it fit.
   */
  resizeHandleProps: (key: K) => ColumnHeaderCellProps;
  /**
   * Wraps a column's drag props so a pointer press on the resize handle
   * cannot also start a reorder. Both interactions live on the same heading —
   * as they do in a spreadsheet — and this is the line between them.
   */
  guardHeaderDrag: <P extends { onDragStart?: (event: DragEvent<HTMLTableCellElement>) => void }>(
    props: P,
  ) => P;
}

interface ActiveResize<K> {
  key: K;
  /** Where the pointer was when the drag began. */
  startX: number;
  /** How wide the column was then. Deltas are measured against this, never
   *  against the previous frame — see `resizedWidth`. */
  startWidth: number;
}

export function useColumnResize<K extends string>(
  defaults: Partial<Record<K, number>>,
  storageKey: string,
  /** Floors above the global 60px, for columns whose content cannot shrink
   *  that far — a cell of buttons stacks into a broken pile at 60. Applied to
   *  the drag and to widths read back from storage alike. */
  mins: Partial<Record<K, number>> = {},
  /**
   * What this table spends on things a drag cannot reclaim, and what its
   * elastic columns need at their narrowest. Without it a drag has no ceiling
   * and can put the horizontal scrollbar back, which is the whole complaint.
   */
  budget: { chrome: number; elasticFloor: number } = { chrome: 0, elasticFloor: 0 },
  /**
   * A previous release's storage key, removed on first read. A layout saved
   * before the box was binding is exactly the layout being fixed.
   */
  legacyStorageKey?: string,
): UseColumnResizeResult<K> {
  const [widths, setWidths] = useState<Partial<Record<K, number>>>(defaults);
  // Storage is read after mount, never during render: the server has no
  // localStorage, so a width read during render would make the server and
  // client markup disagree and React would throw a hydration error.
  const [hydrated, setHydrated] = useState(false);
  const dragRef = useRef<ActiveResize<K> | null>(null);
  /** The table's width as the last drag measured it. See the mount effect. */
  const measuredBox = useRef<number | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey);
    } catch (err) {
      // Private browsing and locked-down profiles refuse storage entirely.
      // A column at its default width is a working screen; a thrown error
      // here would be a blank one.
      console.warn("reading stored column widths failed:", err);
    }
    const keys = Object.keys(defaults) as K[];
    // A layout saved before the box was binding is thrown away whole rather
    // than clamped column by column — see discardOversizeWidths. The box is
    // whatever a drag last measured, and TABLE_BOX_AT_1280 until one has:
    // judging a stored layout against the narrowest supported box is the
    // safe direction to be wrong in.
    const recovered = discardOversizeWidths(parseStoredWidths(stored, keys, mins), {
      box: measuredBox.current ?? TABLE_BOX_AT_1280,
      ...budget,
    });
    setWidths(mergeColumnWidths(defaults, recovered));
    setHydrated(true);
    if (legacyStorageKey) {
      try {
        window.localStorage.removeItem(legacyStorageKey);
      } catch {
        // A profile that refuses storage also refuses removal, and on such a
        // profile there was no saved layout to migrate in the first place.
      }
    }
    // `defaults` is a module constant at every call site; listing it would
    // re-read storage on every render for a value that never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    // Until storage has been read, `widths` is still the shipped defaults —
    // writing them now would overwrite the reader's saved widths with the
    // defaults before they were ever loaded.
    if (!hydrated) return;
    try {
      window.localStorage.setItem(storageKey, serializeColumnWidths(widths));
    } catch (err) {
      console.warn("saving column widths failed:", err);
    }
  }, [hydrated, widths, storageKey]);

  const resizeHandleProps = useCallback(
    (key: K): ColumnHeaderCellProps => ({
      onResizeStart: (event: ReactPointerEvent<HTMLElement>) => {
        // Stops the browser turning this press into a text selection or into
        // the native header drag; `guardHeaderDrag` below is the second half
        // of that, for the browsers where this alone is not enough.
        event.preventDefault();
        event.stopPropagation();
        // Both numbers are read once, here. An elastic column has no width in
        // state — it was absorbing the remainder — so its starting width is
        // whatever the browser gave the cell; and the box is measured rather
        // than watched, because a resize is a gesture, not a subscription.
        const cell = (event.target as HTMLElement).closest("th");
        const table = cell?.closest(".ant-table");
        const startWidth = Math.round(
          widths[key] ?? cell?.getBoundingClientRect().width ?? MIN_COLUMN_WIDTH,
        );
        const box = table?.clientWidth ?? TABLE_BOX_AT_1280;
        measuredBox.current = box;
        dragRef.current = { key, startX: event.clientX, startWidth };

        const move = (moveEvent: PointerEvent) => {
          const active = dragRef.current;
          if (!active) return;
          // Every frame measures against the width at pointer-down and the
          // pointer's total travel — see `resizedWidth` for why accumulating
          // per-frame deltas drifts away from the pointer.
          const wanted = active.startWidth + (moveEvent.clientX - active.startX);
          setWidths((current) =>
            resizeWithinBox(current, active.key, wanted, { box, ...budget }, mins),
          );
        };
        const end = () => {
          dragRef.current = null;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        // A pointer the system takes away — an incoming call, a gesture the
        // OS claims — never sends `pointerup`. Without this the listeners
        // would outlive the gesture and the next pointer move anywhere on the
        // page would still be resizing this column.
        window.addEventListener("pointercancel", end);
      },
    }),
    // `mins` and `budget` are module constants at every call site, so listing
    // them is free; a caller building one inline would re-create these props
    // per render, which costs nothing worse than the render itself.
    [widths, mins, budget],
  );

  const guardHeaderDrag = useCallback(
    <P extends { onDragStart?: (event: DragEvent<HTMLTableCellElement>) => void }>(props: P): P => ({
      ...props,
      onDragStart: (event: DragEvent<HTMLTableCellElement>) => {
        if (dragRef.current) {
          // A width drag is in progress on this very heading. Letting the
          // reorder start here is exactly the confusion the follow-up video
          // reported: they reached for the edge and the column moved.
          event.preventDefault();
          return;
        }
        props.onDragStart?.(event);
      },
    }),
    [],
  );

  return { widths, resizeHandleProps, guardHeaderDrag };
}
