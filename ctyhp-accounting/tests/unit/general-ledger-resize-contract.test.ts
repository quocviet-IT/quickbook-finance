import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GENERAL_LEDGER_COLUMN_KEYS } from "@/app/(app)/reports/general-ledger/general-ledger-columns";

const raw = readFileSync(
  join(process.cwd(), "app", "(app)", "reports", "general-ledger", "GeneralLedgerClient.tsx"),
  "utf8",
);

/**
 * The code, without its prose.
 *
 * That file explains at length what its `scroll` prop used to be and why it
 * changed, quoting the old JSX. Asserting against the raw text would fail on
 * the explanation rather than on the behaviour — and the explanation is worth
 * more than a tidier assertion, so the test gives way, not the comment.
 *
 * Only whole-line `//` comments are removed, never a trailing one: a `//`
 * inside a string (a URL, a route) is indistinguishable from a comment
 * without parsing, and dropping the rest of that line would quietly hide code
 * from every assertion below.
 */
const source = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

/** Just the column definitions, so a filter input's own width is not mistaken
 *  for a column's. */
const columnsBlock = source.slice(source.indexOf("columns={["));

/**
 * REQ-01, from the second reference video (2026-08-18):
 *
 *   "But I just want to have a feature where you can just drag the end of this
 *    column just like that."
 *   "Where we can able to read the amount, the date, then yeah, that's all."
 *
 * The columns they pointed at — DATE, DESCRIPTION, DEBIT, CREDIT, BALANCE —
 * are this report's, not Bank Transactions'. Bank Transactions has no debit,
 * credit or balance column at all. This screen is the one the video is about.
 *
 * These assertions exist because the failure mode here is silent. Every one of
 * them can break while the screen still renders, still passes typecheck, and
 * still looks approximately right — and the reader is left dragging a handle
 * that changes a number and not the screen.
 */
describe("the General Ledger column widths", () => {
  it("gives every measured column a width the reader controls", () => {
    // Every column except the memo. The memo is the elastic one now — it
    // carries no width at all and absorbs whatever the others leave, which is
    // what the reviewer was dragging it towards by hand. See
    // docs/superpowers/specs/2026-08-24-lists-that-fit-the-screen-design.md.
    for (const key of GENERAL_LEDGER_COLUMN_KEYS) {
      if (key === "memo") {
        expect(source).not.toContain(`width: widths.${key}`);
        continue;
      }
      expect(source, key).toContain(`width: widths.${key}`);
    }
  });

  it("leaves no column pinned to a literal width", () => {
    // A literal survives a resize and then silently disagrees with the total
    // handed to `scroll.x`, which is how a column ends up overlapping its
    // neighbour rather than simply refusing to move. Scoped to the columns:
    // the account picker and the search box above have widths of their own
    // and neither is a column.
    expect(columnsBlock).not.toMatch(/width:\s*\d+/);
  });

  it("gives every measured column a handle, not only the one the video pointed at", () => {
    // Memo is the column they dragged, but TC-04 asks for DATE, DEBIT, CREDIT
    // and BALANCE too. Counting is what catches a column added later with a
    // width but no handle — it would look resizable and refuse to move.
    //
    // One fewer than the key count: the elastic column has no handle, because
    // it is the column paying for every other column's width. A width of its
    // own would leave nothing absorbing the remainder, and the row total would
    // stop being the width of the box.
    const handles = columnsBlock.match(/onHeaderCell:/g) ?? [];
    expect(handles.length).toBe(GENERAL_LEDGER_COLUMN_KEYS.length - 1);
  });

  it("names its table layout instead of inheriting one by accident", () => {
    // Today this table lands in `fixed` layout only because Memo happens to
    // carry `ellipsis`, which rc-table treats as a signal. Remove that one
    // property — an entirely reasonable edit — and every width here silently
    // stops binding. Saying it outright is what stops that.
    expect(source).toContain('tableLayout="fixed"');
  });

  it("asks for no horizontal scroll at all", () => {
    // This assertion has now been written three ways, which is the history of
    // the complaint. `x: undefined` was the first fix, a real total was the
    // second, and both were answers to "how wide should the scroll be" when
    // the reader had been saying all along that there should not be one.
    //
    // Under a fitted table the memo takes the remainder, so the row total IS
    // the box: there is nothing to scroll to. A total handed to rc-table is
    // what let a widened column manufacture the scrollbar again.
    expect(source).not.toMatch(/scroll=\{\{\s*x:/);
  });

  it("renders through the shared header cell, which is what draws the handle", () => {
    expect(source).toContain("ColumnHeaderCell");
    expect(source).toContain("resizeHandleProps");
  });

  it("lets the elastic column take the stretch, rather than fighting it", () => {
    // `accounting-table--exact-widths` used to be here, releasing the table
    // from the inline `min-width: 100%` rc-table writes when horizontal
    // scrolling is on. With no horizontal scrolling there is no such rule to
    // fight, and the stretch is now the mechanism: the memo is meant to grow
    // into whatever the measured columns leave. Keeping the class would leave
    // a gap down the right of every wide screen — the "gaps in the columns"
    // this work exists to remove.
    expect(source).not.toContain("accounting-table--exact-widths");
  });

  it("keeps the memo's tooltip, so narrowing a column never hides what it said", () => {
    // Cutting the memo to its column is only acceptable while the whole text
    // stays one hover away. Without this, a reader who narrows Memo has
    // destroyed their own access to the wire description.
    expect(source).toContain("ellipsis");
    expect(source).toContain("Tooltip");
  });
});
