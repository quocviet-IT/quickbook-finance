import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildInvoiceDocument } from "@/lib/domain/invoice-document";
import { renderInvoicePdf } from "@/lib/client/invoice-pdf";

const source = {
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
    memo: "Payment due within 30 days. Thank you for your business.",
  },
  lines: Array.from({ length: 3 }, (_, index) => ({
    line_order: index + 1,
    description: `Jewelry service line ${index + 1}`,
    quantity: 1,
    unit_price_minor: index === 0 ? 148_750 : 50_000,
    line_subtotal_minor: index === 0 ? 148_750 : 50_000,
    line_tax_minor: index === 0 ? 9_297 : 3_125,
    line_total_minor: index === 0 ? 158_047 : 53_125,
  })),
  customer: {
    name: "Elena Brooks",
    email: "elena@example.com",
    contact_name: null,
    phone: "+1 617 555 0143",
    address_line1: "9 Charles Street",
    address_line2: null,
    city: "Cambridge",
    region: "MA",
    postal_code: "02138",
    country: "United States",
  },
  company: {
    legal_name: "CTYHP Jewelry LLC",
    dba_name: "CTYHP Fine Jewelry",
    address_line1: "18 Pearl Street",
    address_line2: "Suite 400",
    city: "Boston",
    region: "MA",
    postal_code: "02109",
    country: "United States",
    ein_ref: "12-3456789",
  },
};

async function pdfBytes(status = "issued"): Promise<Uint8Array> {
  const doc = buildInvoiceDocument({
    ...source,
    invoice: { ...source.invoice, status },
  });
  // Awaited because the library is fetched on demand — see the contract test
  // at the bottom of this file for why.
  const pdf = await renderInvoicePdf(doc);
  return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer);
}

describe("renderInvoicePdf", () => {
  it("produces a real PDF file", async () => {
    const bytes = await pdfBytes();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("renders a draft, whose watermark makes the page larger than the issued one", async () => {
    // Cheap proof the watermark branch actually draws rather than silently
    // doing nothing — a rendering bug this test would otherwise miss.
    const [draft, issued] = await Promise.all([pdfBytes("draft"), pdfBytes("issued")]);
    expect(draft.byteLength).toBeGreaterThan(issued.byteLength);
  });

  it("does not throw on an invoice with no memo and no customer address", async () => {
    const doc = buildInvoiceDocument({
      ...source,
      invoice: { ...source.invoice, memo: null },
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
    await expect(renderInvoicePdf(doc)).resolves.toBeDefined();
    const pdf = await renderInvoicePdf(doc);
    expect(() => pdf.output("arraybuffer")).not.toThrow();
  });
});

describe("the PDF library is only loaded when a PDF is asked for", () => {
  const source = readFileSync(join(process.cwd(), "lib", "client", "invoice-pdf.ts"), "utf8");

  it("imports jspdf dynamically, not at the top of the module", () => {
    // A static import puts 123 KB of jspdf into the /invoices bundle for every
    // reader, whether or not anybody downloads an invoice — measured on
    // production, 25 August 2026. lib/client/report-export.ts already loads the
    // same library the right way; this module was the exception.
    expect(source).not.toMatch(/^import\s+\{[^}]*jsPDF[^}]*\}\s+from\s+"jspdf"/m);
    expect(source).not.toMatch(/^import\s+autoTable\s+from\s+"jspdf-autotable"/m);
    // A call expression, wherever it sits — the module loads both in one
    // Promise.all, so the assertion is on the dynamic form, not on `await`
    // appearing immediately before it.
    expect(source).toMatch(/[^.\w]import\("jspdf"\)/);
    expect(source).toMatch(/[^.\w]import\("jspdf-autotable"\)/);
  });

  it("still names the type it returns, which costs nothing at runtime", () => {
    // `import type` is erased by the compiler, so it keeps the signature
    // honest without pulling the library back into the bundle.
    expect(source).toMatch(/import type \{[^}]*jsPDF/);
  });
});
