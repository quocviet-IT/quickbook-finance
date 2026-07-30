import { describe, expect, it } from "vitest";
import {
  buildInvoiceDocument,
  formatPostalAddress,
  invoiceDocumentFileName,
  type InvoiceDocumentSource,
} from "@/lib/domain/invoice-document";

const company = {
  legal_name: "CTYHP Jewelry LLC",
  dba_name: "CTYHP Fine Jewelry",
  address_line1: "18 Pearl Street",
  address_line2: "Suite 400",
  city: "Boston",
  region: "MA",
  postal_code: "02109",
  country: "United States",
  ein_ref: "12-3456789",
};

const customer = {
  name: "Elena Brooks",
  email: "elena@example.com",
  contact_name: "Elena Brooks",
  phone: "+1 617 555 0143",
  address_line1: "9 Charles Street",
  address_line2: null,
  city: "Cambridge",
  region: "MA",
  postal_code: "02138",
  country: "United States",
};

const source: InvoiceDocumentSource = {
  invoice: {
    invoice_number: "INV-000010",
    issue_date: "2026-03-22",
    due_date: "2026-04-21",
    currency_code: "USD",
    subtotal_minor: 248_750,
    tax_total_minor: 15_547,
    total_minor: 264_297,
    balance_due_minor: 264_297,
    status: "issued",
    memo: "Thank you for your business",
  },
  lines: [
    {
      line_order: 1,
      description: "Jewelry appraisal and setting service",
      quantity: 1,
      unit_price_minor: 248_750,
      line_subtotal_minor: 248_750,
      line_tax_minor: 15_547,
      line_total_minor: 264_297,
    },
  ],
  customer,
  company,
};

describe("formatPostalAddress", () => {
  it("puts city, region and postal code on one line", () => {
    expect(formatPostalAddress(customer)).toEqual([
      "9 Charles Street",
      "Cambridge, MA 02138",
      "United States",
    ]);
  });

  it("drops every missing part instead of leaving gaps or stray commas", () => {
    expect(
      formatPostalAddress({
        address_line1: null,
        address_line2: null,
        city: "Boston",
        region: null,
        postal_code: null,
        country: null,
      }),
    ).toEqual(["Boston"]);
  });

  it("returns nothing when the party has no address at all", () => {
    expect(
      formatPostalAddress({
        address_line1: null,
        address_line2: null,
        city: null,
        region: null,
        postal_code: null,
        country: null,
      }),
    ).toEqual([]);
  });
});

describe("buildInvoiceDocument", () => {
  it("titles an issued invoice with its number", () => {
    const doc = buildInvoiceDocument(source);
    expect(doc.title).toBe("Invoice INV-000010");
    expect(doc.status).toBe("issued");
  });

  it("marks a draft so nobody mistakes it for an issued document", () => {
    const doc = buildInvoiceDocument({
      ...source,
      invoice: { ...source.invoice, invoice_number: null, status: "draft" },
    });
    expect(doc.title).toBe("Draft invoice");
    expect(doc.watermark).toBe("DRAFT");
  });

  it("marks a void invoice", () => {
    const doc = buildInvoiceDocument({
      ...source,
      invoice: { ...source.invoice, status: "void" },
    });
    expect(doc.watermark).toBe("VOID");
  });

  it("leaves an issued invoice unwatermarked", () => {
    expect(buildInvoiceDocument(source).watermark).toBeNull();
  });

  it("prefers the trading name and keeps the legal name beneath it", () => {
    const doc = buildInvoiceDocument(source);
    expect(doc.seller.displayName).toBe("CTYHP Fine Jewelry");
    expect(doc.seller.legalLine).toBe("CTYHP Jewelry LLC");
  });

  it("uses the legal name alone when there is no trading name", () => {
    const doc = buildInvoiceDocument({
      ...source,
      company: { ...company, dba_name: null },
    });
    expect(doc.seller.displayName).toBe("CTYHP Jewelry LLC");
    expect(doc.seller.legalLine).toBeNull();
  });

  it("never prints the employer identification number", () => {
    // A customer-facing invoice has no reason to carry the seller's EIN.
    expect(JSON.stringify(buildInvoiceDocument(source))).not.toContain("12-3456789");
  });

  it("formats money from minor units at the document edge", () => {
    const doc = buildInvoiceDocument(source);
    expect(doc.totals).toEqual([
      { label: "Subtotal", amount: "$2,487.50" },
      { label: "Sales tax", amount: "$155.47" },
      { label: "Total", amount: "$2,642.97" },
      { label: "Balance due", amount: "$2,642.97" },
    ]);
  });

  it("omits the sales tax row when there is no tax", () => {
    const doc = buildInvoiceDocument({
      ...source,
      invoice: {
        ...source.invoice,
        tax_total_minor: 0,
        total_minor: 248_750,
        balance_due_minor: 248_750,
      },
      lines: [{ ...source.lines[0], line_tax_minor: 0, line_total_minor: 248_750 }],
    });
    expect(doc.totals.map((t) => t.label)).toEqual(["Subtotal", "Total", "Balance due"]);
  });

  it("shows what was already paid when the invoice is partly settled", () => {
    const doc = buildInvoiceDocument({
      ...source,
      invoice: { ...source.invoice, balance_due_minor: 64_297, status: "partial" },
    });
    expect(doc.totals).toContainEqual({ label: "Paid to date", amount: "$2,000.00" });
    expect(doc.totals.at(-1)).toEqual({ label: "Balance due", amount: "$642.97" });
  });

  it("renders each line with quantity, unit price and total", () => {
    const doc = buildInvoiceDocument(source);
    expect(doc.lines).toEqual([
      {
        description: "Jewelry appraisal and setting service",
        quantity: "1",
        unitPrice: "$2,487.50",
        amount: "$2,487.50",
      },
    ]);
  });

  it("keeps line order stable regardless of the order rows arrive in", () => {
    const doc = buildInvoiceDocument({
      ...source,
      lines: [
        { ...source.lines[0], line_order: 2, description: "Second", line_total_minor: 132_149 },
        { ...source.lines[0], line_order: 1, description: "First", line_total_minor: 132_148 },
      ],
    });
    expect(doc.lines.map((l) => l.description)).toEqual(["First", "Second"]);
  });

  it("falls back to a dash when a line has no description", () => {
    const doc = buildInvoiceDocument({
      ...source,
      lines: [{ ...source.lines[0], description: "" }],
    });
    expect(doc.lines[0].description).toBe("—");
  });

  it("refuses to build a document whose lines do not add up to its total", () => {
    // Printing a document that contradicts the ledger is worse than not printing.
    expect(() =>
      buildInvoiceDocument({
        ...source,
        lines: [{ ...source.lines[0], line_total_minor: 1 }],
      }),
    ).toThrow(/does not match/i);
  });

  it("carries the dates and the memo", () => {
    const doc = buildInvoiceDocument(source);
    expect(doc.meta).toContainEqual({ label: "Issue date", value: "2026-03-22" });
    expect(doc.meta).toContainEqual({ label: "Due date", value: "2026-04-21" });
    expect(doc.memo).toBe("Thank you for your business");
  });

  it("says the invoice is due on receipt when it has no due date", () => {
    const doc = buildInvoiceDocument({
      ...source,
      invoice: { ...source.invoice, due_date: null },
    });
    expect(doc.meta).toContainEqual({ label: "Due date", value: "On receipt" });
  });

  it("shows the customer's name even when the address is empty", () => {
    const doc = buildInvoiceDocument({
      ...source,
      customer: {
        name: "Walk-in customer",
        email: null,
        contact_name: null,
        phone: null,
        address_line1: null,
        address_line2: null,
        city: null,
        region: null,
        postal_code: null,
        country: null,
      },
    });
    expect(doc.billTo.name).toBe("Walk-in customer");
    expect(doc.billTo.lines).toEqual([]);
  });
});

describe("invoiceDocumentFileName", () => {
  it("is named after the invoice number", () => {
    expect(invoiceDocumentFileName("INV-000010")).toBe("invoice-inv-000010.pdf");
  });

  it("names a draft by date instead of a number it does not have yet", () => {
    expect(invoiceDocumentFileName(null, "2026-03-22")).toBe("invoice-draft-2026-03-22.pdf");
  });
});
