"use client";

import { Tooltip } from "antd";

/**
 * The three properties a column needs when it holds text somebody typed.
 *
 * A memo, a note, a reason, a description: there is no length these are held
 * to, and a table asked to be as wide as its contents will let one of them
 * decide the width of the whole thing. Two screens reached us that way — the
 * general ledger, where the amounts ended up off the right-hand edge, and the
 * journal, where the Reverse button did. In both the reader could only find the
 * missing columns by scrolling sideways on a page that gives no sign it scrolls.
 *
 * A width bounds the column. `ellipsis` cuts what does not fit and switches the
 * table to a fixed layout, so the width binds. `showTitle: false` turns off the
 * browser's own tooltip, which is slow to appear and renders a long line without
 * wrapping; the one below opens at once and wraps.
 *
 * This lives apart from `columns.tsx` on purpose. That module imports Ant Design
 * for types only, which is what keeps a unit test of it at 0.4 seconds instead
 * of 55 — and `Tooltip` is a runtime import.
 */
export function longTextColumn(width = 260) {
  return {
    width,
    ellipsis: { showTitle: false as const },
    render: (value: string | null | undefined) =>
      value && String(value).trim() !== "" ? (
        <Tooltip title={value} placement="topLeft" styles={{ root: { maxWidth: 640 } }}>
          <span>{value}</span>
        </Tooltip>
      ) : (
        // The same em dash the rest of the kit uses, so an empty cell never
        // reads as something the row actually said.
        "—"
      ),
  };
}
