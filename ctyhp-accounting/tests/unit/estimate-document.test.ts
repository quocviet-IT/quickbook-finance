import { describe, expect, it } from "vitest";
import {
  ESTIMATE_CLOSING_LINE,
  buildEstimateDocument,
  estimateDocumentFileName,
  type EstimateDocumentSource,
} from "@/lib/domain/estimate-document";
import { buildInvoiceDocument } from "@/lib/domain/invoice-document";

const company = {
  legal_name: "Larkspur Joinery LLC",
  dba_name: "Larkspur Woodworks",
  address_line1: "41 Example Avenue",
  address_line2: null,
  city: "Springfield",
  region: "OR",
  postal_code: "97477",
  country: "United States",
  ein_ref: "00-0000000",
};

const customer = {
  name: "Marisol Ortega",
  email: "marisol@example.com",
  contact_name: null,
  phone: "+1 555 0100",
  address_line1: "7 Sample Lane",
  address_line2: "Unit 2",
  city: "Eugene",
  region: "OR",
  postal_code: "97401",
  country: null,
};

// 3 × $19.99 = $59.97 at 6.25% → $3.75 tax; 2.5 × $42.50 = $106.25 untaxed.
const source: EstimateDocumentSource = {
  estimate: {
    estimate_number: "EST-000001",
    estimate_date: "2026-10-12",
    expiry_date: "2026-11-11",
    currency_code: "USD",
    subtotal_minor: 16_622,
    tax_minor: 375,
    total_minor: 16_997,
    memo: "  Prices hold for 30 days. Delivery within two weeks of acceptance.  ",
  },
  lines: [
    {
      line_order: 1,
      description: "Install brass shelf brackets",
      quantity: 2.5,
      unit_price_minor: 4_250,
      line_subtotal_minor: 10_625,
      line_tax_minor: 0,
      line_total_minor: 10_625,
    },
    {
      line_order: 0,
      description: "Walnut shelf, 90 cm",
      quantity: 3,
      unit_price_minor: 1_999,
      line_subtotal_minor: 5_997,
      line_tax_minor: 375,
      line_total_minor: 6_372,
    },
  ],
  customer,
  company,
};

describe("buildEstimateDocument", () => {
  it("titles the estimate with its number", () => {
    expect(buildEstimateDocument(source).title).toBe("Estimate EST-000001");
  });

  it("shows the estimate date and Valid until", () => {
    expect(buildEstimateDocument(source).meta).toEqual([
      { label: "Estimate date", value: "2026-10-12" },
      { label: "Valid until", value: "2026-11-11" },
    ]);
  });

  it("lists description, quantity, unit price and amount, in line order", () => {
    expect(buildEstimateDocument(source).lines).toEqual([
      { description: "Walnut shelf, 90 cm", quantity: "3", unitPrice: "$19.99", amount: "$59.97" },
      { description: "Install brass shelf brackets", quantity: "2.5", unitPrice: "$42.50", amount: "$106.25" },
    ]);
  });

  it("totals Subtotal, Sales tax and Total, with nothing paid or due", () => {
    expect(buildEstimateDocument(source).totals).toEqual([
      { label: "Subtotal", amount: "$166.22" },
      { label: "Sales tax", amount: "$3.75" },
      { label: "Total", amount: "$169.97" },
    ]);
  });

  it("leaves out a zero Sales tax row, as the invoice does", () => {
    const untaxed = buildEstimateDocument({
      ...source,
      estimate: { ...source.estimate, subtotal_minor: 10_625, tax_minor: 0, total_minor: 10_625 },
      lines: [source.lines[0]],
    });
    expect(untaxed.totals.map((total) => total.label)).toEqual(["Subtotal", "Total"]);
  });

  it("prints the note, then always the closing line", () => {
    const doc = buildEstimateDocument(source);
    expect(doc.memo).toBe("Prices hold for 30 days. Delivery within two weeks of acceptance.");
    expect(doc.footer).toBe("This is a quotation, not an invoice. Nothing is owed on it.");
    expect(ESTIMATE_CLOSING_LINE).toBe(doc.footer);
  });

  it("keeps the closing line when there is no note", () => {
    const doc = buildEstimateDocument({ ...source, estimate: { ...source.estimate, memo: "   " } });
    expect(doc.memo).toBeNull();
    expect(doc.footer).toBe(ESTIMATE_CLOSING_LINE);
  });

  it("names the file after the number and the customer", () => {
    expect(buildEstimateDocument(source).fileName).toBe("Estimate EST-000001 Marisol Ortega.pdf");
  });

  it("is never watermarked", () => {
    expect(buildEstimateDocument(source).watermark).toBeNull();
  });

  it("prints the seller and bill-to blocks exactly as the invoice does", () => {
    const invoice = buildInvoiceDocument({
      invoice: {
        invoice_number: "INV-000001",
        issue_date: "2026-10-12",
        due_date: null,
        currency_code: "USD",
        subtotal_minor: 16_622,
        tax_total_minor: 375,
        total_minor: 16_997,
        balance_due_minor: 16_997,
        status: "issued",
        memo: null,
      },
      lines: source.lines,
      customer,
      company,
    });
    const estimate = buildEstimateDocument(source);
    expect(estimate.seller).toEqual(invoice.seller);
    expect(estimate.billTo).toEqual(invoice.billTo);
    expect(estimate.seller).toEqual({
      displayName: "Larkspur Woodworks",
      legalLine: "Larkspur Joinery LLC",
      lines: ["41 Example Avenue", "Springfield, OR 97477", "United States"],
    });
    expect(estimate.billTo).toEqual({
      name: "Marisol Ortega",
      lines: ["7 Sample Lane", "Unit 2", "Eugene, OR 97401", "+1 555 0100", "marisol@example.com"],
    });
  });

  it("never prints the employer identification number", () => {
    expect(JSON.stringify(buildEstimateDocument(source))).not.toContain("00-0000000");
  });

  it("refuses to print lines that do not add up to the total", () => {
    expect(() =>
      buildEstimateDocument({ ...source, estimate: { ...source.estimate, total_minor: 16_998 } }),
    ).toThrow("Estimate line total 16997 does not match the estimate total 16998");
  });
});

describe("estimateDocumentFileName", () => {
  it("drops characters a file system refuses from the customer's name", () => {
    expect(estimateDocumentFileName("EST-000042", "Rivera / Sons: Cabinets?")).toBe(
      "Estimate EST-000042 Rivera Sons Cabinets.pdf",
    );
    expect(estimateDocumentFileName("EST-000042", 'A<b>c|d*e"f\\g')).toBe("Estimate EST-000042 A b c d e f g.pdf");
  });

  it("collapses runs of spaces and trims", () => {
    expect(estimateDocumentFileName("EST-000042", "  Two   Spaces  ")).toBe(
      "Estimate EST-000042 Two Spaces.pdf",
    );
  });

  it("keeps just the number when the name has nothing printable", () => {
    expect(estimateDocumentFileName("EST-000042", " / ")).toBe("Estimate EST-000042.pdf");
  });
});
