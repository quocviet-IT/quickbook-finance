"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  mergeColumnWidths,
  parseStoredWidths,
  resizedWidth,
  serializeColumnWidths,
} from "@/lib/domain/column-width";
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
  /** Current width of every column, in pixels. Never outside the bounds. */
  widths: Record<K, number>;
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
  defaults: Record<K, number>,
  storageKey: string,
): UseColumnResizeResult<K> {
  const [widths, setWidths] = useState<Record<K, number>>(defaults);
  // Storage is read after mount, never during render: the server has no
  // localStorage, so a width read during render would make the server and
  // client markup disagree and React would throw a hydration error.
  const [hydrated, setHydrated] = useState(false);
  const dragRef = useRef<ActiveResize<K> | null>(null);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidths(mergeColumnWidths(defaults, parseStoredWidths(stored, keys)));
    setHydrated(true);
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
        // The width as it is right now, read once. Every frame below measures
        // against this number and the pointer's total travel — see
        // `resizedWidth` for why accumulating per-frame deltas drifts.
        dragRef.current = { key, startX: event.clientX, startWidth: widths[key] };

        const move = (moveEvent: PointerEvent) => {
          const active = dragRef.current;
          if (!active) return;
          const next = resizedWidth(active.startWidth, moveEvent.clientX - active.startX);
          setWidths((current) =>
            current[active.key] === next ? current : { ...current, [active.key]: next },
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
    [widths],
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
