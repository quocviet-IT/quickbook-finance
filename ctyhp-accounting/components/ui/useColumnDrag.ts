"use client";

import { useCallback, useState } from "react";
import type { DragEvent } from "react";
import { reorderColumns } from "@/lib/domain/column-order";
import type { ColumnHeaderCellProps } from "./ColumnHeaderCell";

/**
 * RQ-01: the state and DOM event wiring behind dragging a column header.
 *
 * Deliberately thin. The one decision worth getting wrong — what the new
 * order is once a column is dropped — is not made here; it is delegated to
 * `reorderColumns` (lib/domain/column-order.ts), which is dependency-free
 * and has the tests this hook cannot: calling a hook outside a render has no
 * dispatcher and throws, so nothing here runs under `vitest run` the way
 * that function's tests do. What is left in this file is event plumbing —
 * remember which key is being dragged, remember which key the pointer is
 * over, and hand both to the pure function on drop — verified instead by
 * the manual click-through in the RQ-01 report.
 *
 * Session-only by design (change request section 8): state lives in
 * `useState`, nothing is written to storage, and a reload or a fresh login
 * starts a table back at `defaultOrder`.
 */
export interface UseColumnDragResult<K extends string> {
  /** The current column order. Starts as `defaultOrder`, exactly. */
  order: K[];
  /**
   * Props to spread onto a reorderable column's `onHeaderCell`. A column
   * that never calls this — the row-selection checkbox, any `fixed: "right"`
   * action column — is never a drag source and never accepts a drop; see
   * ColumnHeaderCell's module comment for why that alone is enough.
   */
  headerCellProps: (key: K) => ColumnHeaderCellProps;
}

export function useColumnDrag<K extends string>(defaultOrder: readonly K[]): UseColumnDragResult<K> {
  const [order, setOrder] = useState<K[]>(() => [...defaultOrder]);
  const [draggingKey, setDraggingKey] = useState<K | null>(null);
  const [overKey, setOverKey] = useState<K | null>(null);

  const headerCellProps = useCallback(
    (key: K): ColumnHeaderCellProps => ({
      draggable: true,
      "data-dragging": draggingKey === key,
      "data-drop-target": draggingKey !== null && draggingKey !== key && overKey === key,
      onDragStart: (event: DragEvent<HTMLTableCellElement>) => {
        setDraggingKey(key);
        event.dataTransfer.effectAllowed = "move";
        // Firefox refuses to start a drag at all with no data payload set.
        // The value itself is never read back — the drop handler below
        // closes over `draggingKey` from React state instead of parsing
        // dataTransfer, because dataTransfer's data is unreadable during
        // dragover/drop in most browsers until the drop actually completes.
        event.dataTransfer.setData("text/plain", key);
      },
      onDragEnter: (event: DragEvent<HTMLTableCellElement>) => {
        event.preventDefault();
        setOverKey(key);
      },
      onDragOver: (event: DragEvent<HTMLTableCellElement>) => {
        // The one line that makes this cell a legal drop target at all: a
        // browser only fires `drop` on an element whose `dragover` handler
        // called this. Columns that never get this handler — because they
        // never call headerCellProps — stay un-droppable by native browser
        // behaviour, not by a check written anywhere in this codebase.
        event.preventDefault();
      },
      onDrop: (event: DragEvent<HTMLTableCellElement>) => {
        event.preventDefault();
        setOrder((current) => (draggingKey ? reorderColumns(current, draggingKey, key) : current));
        setDraggingKey(null);
        setOverKey(null);
      },
      onDragEnd: () => {
        // Fires on the source cell whether the drop landed on a valid target
        // or not (e.g. released outside the table, or over a pinned
        // column that never called preventDefault). Without this, a drag
        // abandoned that way would leave the header permanently faded.
        setDraggingKey(null);
        setOverKey(null);
      },
    }),
    [draggingKey, overKey],
  );

  return { order, headerCellProps };
}
