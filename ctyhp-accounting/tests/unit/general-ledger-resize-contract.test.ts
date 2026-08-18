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
  it("gives every column a width the reader controls", () => {
    for (const key of GENERAL_LEDGER_COLUMN_KEYS) {
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

  it("gives every column a handle, not only the one the video pointed at", () => {
    // Memo is the column they dragged, but TC-04 asks for DATE, DEBIT, CREDIT
    // and BALANCE too. Counting is what catches a column added later with a
    // width but no handle — it would look resizable and refuse to move.
    const handles = columnsBlock.match(/onHeaderCell:/g) ?? [];
    expect(handles.length).toBe(GENERAL_LEDGER_COLUMN_KEYS.length);
  });

  it("names its table layout instead of inheriting one by accident", () => {
    // Today this table lands in `fixed` layout only because Memo happens to
    // carry `ellipsis`, which rc-table treats as a signal. Remove that one
    // property — an entirely reasonable edit — and every width here silently
    // stops binding. Saying it outright is what stops that.
    expect(source).toContain('tableLayout="fixed"');
  });

  it("scrolls sideways on a real total rather than giving up the scroll", () => {
    // `scroll={{ x: undefined }}` was the previous fix for this screen: a
    // several-hundred-character memo decided the table's width and pushed
    // Debit, Credit and Running off the edge, and dropping the horizontal
    // scroll is what made the widths bind. It cannot stay — REQ-01 requires
    // horizontal scrolling to keep working once the reader widens a column
    // past the viewport, and a table that cannot exceed the page cannot let
    // them widen anything without crushing its neighbours.
    //
    // Matched against the JSX prop, not against any mention of the string:
    // the comment above `scroll` in that file explains what the old value was
    // and why it went, and that history is worth more than a tidier assertion.
    expect(source).not.toMatch(/scroll=\{\{\s*x:\s*undefined/);
    expect(source).not.toMatch(/scroll=\{\{\s*x:\s*"max-content"/);
    expect(source).toMatch(/scroll=\{\{\s*x:\s*totalColumnWidth\(widths/);
  });

  it("renders through the shared header cell, which is what draws the handle", () => {
    expect(source).toContain("ColumnHeaderCell");
    expect(source).toContain("resizeHandleProps");
  });

  it("holds the table to its declared widths instead of stretching to the page", () => {
    // rc-table writes `min-width: 100%` inline whenever horizontal scrolling
    // is on, so a table narrower than its container is stretched and the
    // spare room is shared across every column. Narrowing Memo then widens
    // Debit, Credit and Running — measured, before this class existed: Debit
    // went 140px to 159px on a single drag, and Memo could not reach its own
    // 60px floor. REQ-01 says only the dragged column may change.
    expect(source).toContain("accounting-table--exact-widths");
  });

  it("keeps the memo's tooltip, so narrowing a column never hides what it said", () => {
    // Cutting the memo to its column is only acceptable while the whole text
    // stays one hover away. Without this, a reader who narrows Memo has
    // destroyed their own access to the wire description.
    expect(source).toContain("ellipsis");
    expect(source).toContain("Tooltip");
  });
});
