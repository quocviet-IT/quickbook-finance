import { describe, expect, it } from "vitest";
import { applyMapping, fieldsFor, proposeMapping } from "@/lib/domain/import-mapping";
import { groupInvoiceRows, type InvoiceImportRecord } from "@/lib/domain/invoice-import";

const HEADERS = [
  "Invoice No",
  "Client Name",
  "Invoice Date",
  "Due",
  "Item",
  "Qty",
  "Rate",
  "Sales Account",
  "Tax",
];

/** Map a file the way the screen does, then group it the way the importer does. */
function run(rows: string[][], headers = HEADERS) {
  const mapping = proposeMapping(headers, "invoices");
  const parsed = applyMapping(rows, mapping.columns, "invoices");
  const grouped = groupInvoiceRows(parsed.records as unknown as InvoiceImportRecord[]);
  return { mapping, parsed, grouped };
}

describe("the invoices import target", () => {
  it("has a field for every column the report asked for", () => {
    const keys = fieldsFor("invoices").map((f) => f.key);
    expect(keys).toEqual([
      "invoice_number",
      "customer",
      "issue_date",
      "due_date",
      "description",
      "quantity",
      "unit_price_minor",
      "income_account",
      "tax_code",
      "memo",
    ]);
  });

  it("maps a file whose headers are another product's wording", () => {
    // "Invoice No", "Client Name", "Qty", "Rate" — none of them our own labels.
    const { mapping } = run([]);
    expect(mapping.missingRequired).toEqual([]);
    expect(mapping.columns.invoice_number).toBe(0);
    expect(mapping.columns.customer).toBe(1);
    expect(mapping.columns.quantity).toBe(5);
    expect(mapping.columns.unit_price_minor).toBe(6);
  });

  it("carries a two-line invoice through to one document", () => {
    const { parsed, grouped } = run([
      ["INV-1001", "Elena Brooks", "2026-08-01", "2026-08-31", "Custom ring", "1", "3500.00", "4000", ""],
      ["INV-1001", "Elena Brooks", "2026-08-01", "2026-08-31", "Engraving", "1", "45.00", "4000", ""],
    ]);
    expect(parsed.problems).toEqual([]);
    expect(grouped.problems).toEqual([]);
    expect(grouped.invoices).toHaveLength(1);
    expect(grouped.invoices[0].subtotalMinor).toBe(354_500);
  });

  it("reads a quantity as a count, not as money", () => {
    // 2.5 hours is two and a half hours. Parsed as minor units it becomes 250.
    const { grouped } = run([
      ["INV-1", "Elena Brooks", "2026-08-01", "", "Consulting", "2.5", "100.00", "4000", ""],
    ]);
    expect(grouped.invoices[0].lines[0].quantity).toBe(2.5);
    expect(grouped.invoices[0].subtotalMinor).toBe(25_000);
  });

  it("accepts a slash date in day-first order", () => {
    const { grouped } = run([
      ["INV-1", "Elena Brooks", "31/08/2026", "", "Ring", "1", "10.00", "4000", ""],
    ]);
    expect(grouped.invoices[0].issueDate).toBe("2026-08-31");
  });

  it("refuses a two-digit year rather than guessing the century", () => {
    const { parsed } = run([
      ["INV-1", "Elena Brooks", "01/02/26", "", "Ring", "1", "10.00", "4000", ""],
    ]);
    expect(parsed.problems.some((p) => /issue date/i.test(p.message))).toBe(true);
  });

  it("reports the spreadsheet row number of an unreadable amount", () => {
    const { parsed } = run([
      ["INV-1", "Elena Brooks", "2026-08-01", "", "Ring", "1", "three thousand", "4000", ""],
    ]);
    // Row 2, because the header is row 1 — what the person sees in Excel.
    expect(parsed.problems[0].row).toBe(2);
  });

  it("does not treat an invoice-number column as the customer", () => {
    // "Reference" is an alias of invoice_number; it must not steal another field.
    const { mapping } = run([], ["Reference", "Client Name", "Date", "Qty", "Rate", "Account"]);
    expect(mapping.columns.invoice_number).toBe(0);
    expect(mapping.columns.customer).toBe(1);
  });
});
