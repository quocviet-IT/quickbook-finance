import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLUMN, fitsBox } from "@/lib/design/table-metrics";
import { INVOICE_LIST_FIXED_WIDTHS } from "@/app/(app)/invoices/InvoicesClient";

/**
 * 3.0.11: the layout findings of the 3.0.8 review of the Sales screens. The
 * order and the words are lib/domain/invoice-attention.ts (tested there);
 * this pins that the list and the invoice dialog use them.
 */
// A Windows checkout has CRLF line endings; CI's has LF.
const source = () =>
  readFileSync(join(process.cwd(), "app", "(app)", "invoices", "InvoicesClient.tsx"), "utf8").replace(/\r\n/g, "\n");

const dialogSource = () =>
  readFileSync(join(process.cwd(), "app", "(app)", "invoices", "InvoiceDetailDialog.tsx"), "utf8").replace(/\r\n/g, "\n");

const sum = (widths: readonly number[]) => widths.reduce((total, px) => total + px, 0);

describe("the invoice list", () => {
  it("fits 1280px with a Due column, the customer at its floor", () => {
    expect(INVOICE_LIST_FIXED_WIDTHS).toHaveLength(7);
    expect(fitsBox(sum(INVOICE_LIST_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("opens with the invoices that need attention first, not by number", () => {
    const s = source();
    expect(s).toContain("sortInvoicesByAttention(");
    expect(s).not.toContain('defaultSortOrder: "descend"');
  });

  it("has a Due column, and the status says how late or how soon", () => {
    const s = source();
    expect(s).toMatch(/title: "Due",\s+dataIndex: "due_date"/);
    expect(s).toContain("invoiceAttentionLook(");
  });

  // Rows were 58–59px: a second line under the customer, the balance and the status.
  it("keeps every row to one line", () => {
    const s = source();
    // The three second lines, as they were rendered.
    expect(s).not.toContain("raised ${");
    expect(s).not.toMatch(/\} paid`/);
    expect(s).not.toContain("{age.overdueDays} d overdue");
  });

  it("filters by status from tabs that carry their counts", () => {
    const s = source();
    expect(s).toContain("<Tabs");
    expect(s).toContain("invoiceStatusCounts(");
    expect(s).not.toContain('aria-label="Filter invoices by status"');
  });
});

describe("the invoice dialog", () => {
  it("opens with who, what state and which dates, then the lines with their totals", () => {
    const s = dialogSource();
    for (const label of ['label: "Customer"', 'label: "Status"', 'label: "Issued"', 'label: "Due"', 'label: "Journal entry"']) {
      expect(s, label).toContain(label);
    }
    expect(s).toMatch(/Subtotal[\s\S]{0,400}Tax[\s\S]{0,400}Total/);
  });

  it("offers the invoice's actions in its footer and puts the change history last", () => {
    const dialog = dialogSource();
    expect(dialog).toContain("Download PDF");
    // The dialog calls what its parent hands it; the parent decides who may.
    expect(dialog).toContain("onIssue(invoice)");
    expect(dialog).toContain("onVoid(invoice)");
    expect(dialog.indexOf("<SettlementHistory")).toBeLessThan(dialog.indexOf("<DocumentAuditTrail"));
    expect(dialog.indexOf("<DataTable<InvoiceLineRow>")).toBeLessThan(dialog.indexOf("<DocumentAuditTrail"));
  });
});
