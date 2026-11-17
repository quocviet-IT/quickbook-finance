import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLUMN, fitsBox } from "@/lib/design/table-metrics";
import { BILL_LIST_FIXED_WIDTHS } from "@/app/(app)/bills/BillsClient";

/**
 * 3.0.44: the Bills list as Invoices has been since 3.0.11. The order and the
 * words are lib/domain/bill-attention.ts and invoice-attention.ts (tested
 * there); this pins that the list uses them.
 */
// A Windows checkout has CRLF line endings; CI's has LF.
const source = () =>
  readFileSync(join(process.cwd(), "app", "(app)", "bills", "BillsClient.tsx"), "utf8").replace(/\r\n/g, "\n");

const sum = (widths: readonly number[]) => widths.reduce((total, px) => total + px, 0);

describe("the bill list", () => {
  it("fits 1280px with a Due column, the vendor at its floor", () => {
    expect(BILL_LIST_FIXED_WIDTHS).toHaveLength(7);
    expect(fitsBox(sum(BILL_LIST_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("opens with the bills that need attention first, not in the order they were read", () => {
    const s = source();
    expect(s).toContain("if (!initialQueue) return sortBillsByAttention(bills, today);");
    expect(s).not.toContain("if (!initialQueue) return bills;");
    expect(s).not.toContain("defaultSortOrder");
  });

  it("says in the status how late or how soon a bill is due", () => {
    const s = source();
    expect(s).toMatch(/title: "Due",\s+dataIndex: "due_date"/);
    expect(s).toContain("<BillStatusTag bill={r} today={today} />");
  });

  it("keeps every row to one line: the vendor's reference beside the name, the journal entry in the menu", () => {
    const s = source();
    expect(s).not.toContain('"No vendor reference"');
    expect(s).not.toMatch(/\{secondaryLine\(\s*<>\s*\{r\.vendor_ref/);
    expect(s).toContain("· Ref {r.vendor_ref}");
    expect(s).toContain("label: `Journal entry ${r.entry_number}`");
    expect(s).toContain("router.push(`/journal?entry=${r.journal_entry_id}`)");
  });

  it("filters by status from tabs that carry their counts", () => {
    const s = source();
    expect(s).toContain("<Tabs");
    expect(s).toContain("billStatusCounts(visibleBills, today)");
    expect(s).not.toContain('aria-label="Filter bills by status"');
  });

  it("still searches the vendor's reference", () => {
    expect(source()).toContain("matchesDocumentKeyword([bill.bill_number, bill.vendor_name, bill.vendor_ref], keyword)");
  });
});
