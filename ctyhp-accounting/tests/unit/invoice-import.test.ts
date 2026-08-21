import { describe, expect, it } from "vitest";
import {
  groupInvoiceRows,
  resolveInvoiceImports,
  type InvoiceImportDocument,
  type InvoiceImportRecord,
} from "@/lib/domain/invoice-import";

const line = (over: Partial<InvoiceImportRecord> = {}): InvoiceImportRecord => ({
  invoice_number: "INV-1001",
  customer: "Elena Brooks",
  issue_date: "2026-08-01",
  due_date: "2026-08-31",
  description: "Custom ring",
  quantity: 1,
  unit_price_minor: 350_000,
  income_account: "4000",
  tax_code: null,
  memo: null,
  ...over,
});

describe("groupInvoiceRows", () => {
  it("turns consecutive lines sharing a number into one invoice", () => {
    const { invoices, problems } = groupInvoiceRows([
      line({ description: "Custom ring", unit_price_minor: 350_000 }),
      line({ description: "Engraving", unit_price_minor: 4_500 }),
    ]);
    expect(problems).toEqual([]);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].lines).toHaveLength(2);
    expect(invoices[0].invoiceNumber).toBe("INV-1001");
  });

  it("keeps separate numbers as separate invoices, in file order", () => {
    const { invoices } = groupInvoiceRows([
      line({ invoice_number: "INV-1002" }),
      line({ invoice_number: "INV-1001" }),
      line({ invoice_number: "INV-1002", description: "Second line" }),
    ]);
    expect(invoices.map((i) => i.invoiceNumber)).toEqual(["INV-1002", "INV-1001"]);
    expect(invoices[0].lines).toHaveLength(2);
  });

  it("groups rows that are not adjacent", () => {
    // A spreadsheet sorted by product rather than by invoice is still valid.
    const { invoices, problems } = groupInvoiceRows([
      line({ invoice_number: "A" }),
      line({ invoice_number: "B" }),
      line({ invoice_number: "A", description: "Later line" }),
    ]);
    expect(problems).toEqual([]);
    expect(invoices.find((i) => i.invoiceNumber === "A")?.lines).toHaveLength(2);
  });

  it("refuses a group whose rows disagree about the customer", () => {
    // Two customers under one invoice number is a file someone mis-sorted, and
    // guessing which one is right would post revenue against the wrong party.
    const { invoices, problems } = groupInvoiceRows([
      line({ customer: "Elena Brooks" }),
      line({ customer: "Daniel Carter" }),
    ]);
    expect(invoices).toHaveLength(0);
    expect(problems[0].message).toMatch(/more than one customer/i);
    expect(problems[0].reference).toBe("INV-1001");
  });

  it("refuses a group whose rows disagree about the issue date", () => {
    const { invoices, problems } = groupInvoiceRows([
      line({ issue_date: "2026-08-01" }),
      line({ issue_date: "2026-08-02" }),
    ]);
    expect(invoices).toHaveLength(0);
    expect(problems[0].message).toMatch(/more than one issue date/i);
  });

  it("rejects a quantity that is not positive", () => {
    const { invoices, problems } = groupInvoiceRows([line({ quantity: 0 })]);
    expect(invoices).toHaveLength(0);
    expect(problems[0].message).toMatch(/quantity/i);
  });

  it("rejects a negative unit price rather than inventing a credit note", () => {
    const { invoices, problems } = groupInvoiceRows([line({ unit_price_minor: -100 })]);
    expect(invoices).toHaveLength(0);
    expect(problems[0].message).toMatch(/unit price/i);
  });

  it("accepts a zero unit price, which a free line legitimately has", () => {
    const { invoices, problems } = groupInvoiceRows([line({ unit_price_minor: 0 })]);
    expect(problems).toEqual([]);
    expect(invoices[0].lines[0].unitPriceMinor).toBe(0);
  });

  it("rejects a date that is not a real calendar date", () => {
    const { problems } = groupInvoiceRows([line({ issue_date: "2026-02-31" })]);
    expect(problems[0].message).toMatch(/issue date/i);
  });

  it("rejects a due date before the issue date", () => {
    const { problems } = groupInvoiceRows([
      line({ issue_date: "2026-08-10", due_date: "2026-08-01" }),
    ]);
    expect(problems[0].message).toMatch(/due date/i);
  });

  it("carries the external number through as a reference, never as the new number", () => {
    // Issuing assigns our own sequence; the file's number is what the customer
    // knows the invoice by, so it is kept as a reference and nothing else.
    const { invoices } = groupInvoiceRows([line({ invoice_number: "OLD-77" })]);
    expect(invoices[0].externalReference).toBe("OLD-77");
  });

  it("reports a row with no invoice number instead of inventing a document", () => {
    const { invoices, problems } = groupInvoiceRows([line({ invoice_number: "" })]);
    expect(invoices).toHaveLength(0);
    expect(problems[0].message).toMatch(/invoice number/i);
  });

  it("keeps good invoices when a different one is broken", () => {
    // One bad document must not cost the whole file.
    const { invoices, problems } = groupInvoiceRows([
      line({ invoice_number: "GOOD" }),
      line({ invoice_number: "BAD", quantity: -1 }),
    ]);
    expect(invoices.map((i) => i.invoiceNumber)).toEqual(["GOOD"]);
    expect(problems).toHaveLength(1);
  });

  it("totals each invoice from its own lines", () => {
    const { invoices } = groupInvoiceRows([
      line({ quantity: 2, unit_price_minor: 150_000 }),
      line({ quantity: 1, unit_price_minor: 4_500 }),
    ]);
    expect(invoices[0].subtotalMinor).toBe(304_500);
  });

  it("is empty for an empty file rather than throwing", () => {
    expect(groupInvoiceRows([])).toEqual({ invoices: [], problems: [] });
  });
});

describe("resolveInvoiceImports", () => {
  const doc = (overrides: Partial<InvoiceImportDocument> = {}): InvoiceImportDocument => ({
    invoiceNumber: "INV-1",
    externalReference: "INV-1",
    customer: "Elena Brooks",
    issueDate: "2026-08-01",
    dueDate: null,
    memo: null,
    lines: [
      { description: "Work", quantity: 1, unitPriceMinor: 10_000, incomeAccount: "4000", taxCode: null },
    ],
    subtotalMinor: 10_000,
    ...overrides,
  });

  const sources = {
    customers: ["Elena Brooks", "Daniel Carter"],
    incomeAccounts: [
      { code: "4000", name: "Sales Revenue" },
      { code: "4100", name: "Service Revenue" },
    ],
    taxCodes: [],
  };

  it("lets through an invoice whose customer and account both resolve", () => {
    const out = resolveInvoiceImports([doc()], sources);
    expect(out.importable).toHaveLength(1);
    expect(out.blocked).toEqual([]);
  });

  it("matches a customer ignoring case and surrounding space, as the importer does", () => {
    const out = resolveInvoiceImports([doc({ customer: "  elena BROOKS " })], sources);
    expect(out.importable).toHaveLength(1);
  });

  it("blocks an unknown customer, naming it — this is the commonest reason an import does nothing", () => {
    const out = resolveInvoiceImports([doc({ customer: "Acme Corporation" })], sources);
    expect(out.importable).toEqual([]);
    expect(out.blocked).toEqual([
      { reference: "INV-1", message: "No customer named Acme Corporation" },
    ]);
  });

  it("matches an income account by code or by name", () => {
    const byName = doc({
      lines: [
        { description: "", quantity: 1, unitPriceMinor: 1, incomeAccount: "Service Revenue", taxCode: null },
      ],
    });
    expect(resolveInvoiceImports([byName], sources).importable).toHaveLength(1);
  });

  it("blocks a line whose income account is not an active income account", () => {
    const out = resolveInvoiceImports(
      [
        doc({
          lines: [
            { description: "", quantity: 1, unitPriceMinor: 1, incomeAccount: "Repairs Income", taxCode: null },
          ],
        }),
      ],
      sources,
    );
    expect(out.importable).toEqual([]);
    expect(out.blocked[0].message).toBe("No active income account matches Repairs Income");
  });

  it("reports only the first fault of an invoice, the way the importer stops at it", () => {
    const out = resolveInvoiceImports([doc({ customer: "Nobody", lines: [
      { description: "", quantity: 1, unitPriceMinor: 1, incomeAccount: "Nothing", taxCode: null },
    ] })], sources);
    expect(out.blocked).toHaveLength(1);
    expect(out.blocked[0].message).toMatch(/No customer named Nobody/);
  });

  it("one blocked invoice never costs the others", () => {
    const out = resolveInvoiceImports(
      [doc({ invoiceNumber: "A", externalReference: "A", customer: "Ghost" }), doc({ invoiceNumber: "B", externalReference: "B" })],
      sources,
    );
    expect(out.importable.map((i) => i.externalReference)).toEqual(["B"]);
    expect(out.blocked.map((b) => b.reference)).toEqual(["A"]);
  });
});

describe("resolveInvoiceImports, sales tax code", () => {
  /**
   * The third lookup acc_import_invoices does, and the one this preview
   * missed on the day it shipped: a real import of six invoices previewed as
   * six creates and raised none, every one refused for a tax code the company
   * does not have. A preview that checks two of the three refusals is still a
   * promise the import will break.
   */
  const withTax = (taxCode: string | null): InvoiceImportDocument => ({
    invoiceNumber: "INV-1",
    externalReference: "INV-1",
    customer: "Elena Brooks",
    issueDate: "2026-08-01",
    dueDate: null,
    memo: null,
    lines: [
      { description: "Work", quantity: 1, unitPriceMinor: 10_000, incomeAccount: "4000", taxCode },
    ],
    subtotalMinor: 10_000,
  });

  const sources = {
    customers: ["Elena Brooks"],
    incomeAccounts: [{ code: "4000", name: "Sales Revenue" }],
    taxCodes: [{ code: "TAX", name: "Sales Tax" }, { code: "TAX0", name: "Non-Taxable" }],
  };

  it("blocks a tax code the company does not have, naming it", () => {
    const out = resolveInvoiceImports([withTax("CA-SJ")], sources);
    expect(out.importable).toEqual([]);
    expect(out.blocked).toEqual([
      { reference: "INV-1", message: "No sales tax code matches CA-SJ" },
    ]);
  });

  it("accepts a tax code by code or by name, ignoring case", () => {
    expect(resolveInvoiceImports([withTax("TAX")], sources).importable).toHaveLength(1);
    expect(resolveInvoiceImports([withTax("sales tax")], sources).importable).toHaveLength(1);
    expect(resolveInvoiceImports([withTax("tax0")], sources).importable).toHaveLength(1);
  });

  it("accepts a line with no tax code at all — sales tax is optional", () => {
    expect(resolveInvoiceImports([withTax(null)], sources).importable).toHaveLength(1);
    expect(resolveInvoiceImports([withTax("  ")], sources).importable).toHaveLength(1);
  });

  it("reports the customer first when both the customer and the tax code are wrong", () => {
    const doc = { ...withTax("CA-SJ"), customer: "Nobody" };
    expect(resolveInvoiceImports([doc], sources).blocked[0].message).toMatch(/No customer named/);
  });
});
