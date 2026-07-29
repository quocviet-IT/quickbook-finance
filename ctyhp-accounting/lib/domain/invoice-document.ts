/**
 * The printable form of an invoice: what a customer sees on paper.
 *
 * Pure. It turns stored minor units and raw rows into the exact strings the
 * renderer draws, so what gets printed is decided here — and tested here —
 * rather than inside a PDF library call.
 */
import { USD_DECIMAL_PLACES } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";

export interface PostalParty {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
}

export interface InvoiceDocumentSource {
  invoice: {
    invoice_number: string | null;
    issue_date: string;
    due_date: string | null;
    currency_code: string;
    subtotal_minor: number;
    tax_total_minor: number;
    total_minor: number;
    balance_due_minor: number;
    status: string;
    memo: string | null;
  };
  lines: Array<{
    line_order: number;
    description: string;
    quantity: number;
    unit_price_minor: number;
    line_subtotal_minor: number;
    line_tax_minor: number;
    line_total_minor: number;
  }>;
  customer: PostalParty & {
    name: string;
    email: string | null;
    contact_name: string | null;
    phone: string | null;
  };
  company: PostalParty & {
    legal_name: string;
    dba_name: string | null;
    /** Accepted so callers can pass the settings row as-is; never printed. */
    ein_ref?: string | null;
  };
}

export interface InvoiceDocumentLine {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface InvoiceDocument {
  title: string;
  status: string;
  /** DRAFT or VOID, drawn across the page so the copy cannot be mistaken. */
  watermark: string | null;
  seller: {
    displayName: string;
    /** The legal name, shown only when it differs from the trading name. */
    legalLine: string | null;
    lines: string[];
  };
  billTo: { name: string; lines: string[] };
  meta: Array<{ label: string; value: string }>;
  lines: InvoiceDocumentLine[];
  totals: Array<{ label: string; amount: string }>;
  memo: string | null;
}

/** Address lines with every missing part dropped — no gaps, no stray commas. */
export function formatPostalAddress(party: PostalParty): string[] {
  const cityLine = [party.city, [party.region, party.postal_code].filter(Boolean).join(" ")]
    .filter((part) => part && part.trim())
    .join(", ");
  return [party.address_line1, party.address_line2, cityLine, party.country]
    .map((line) => line?.trim() ?? "")
    .filter((line) => line.length > 0);
}

function quantityText(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(quantity);
}

export function buildInvoiceDocument(source: InvoiceDocumentSource): InvoiceDocument {
  const { invoice, customer, company } = source;
  const decimals = USD_DECIMAL_PLACES;
  const money = (minor: number) => formatMoney(minor, invoice.currency_code, decimals);

  const lines = [...source.lines].sort((a, b) => a.line_order - b.line_order);

  // A printed document that contradicts the ledger is worse than no document.
  const lineTotal = lines.reduce((sum, line) => sum + line.line_total_minor, 0);
  if (lineTotal !== invoice.total_minor) {
    throw new Error(
      `Invoice line total ${lineTotal} does not match the invoice total ${invoice.total_minor}`,
    );
  }

  const paidMinor = invoice.total_minor - invoice.balance_due_minor;
  const totals: Array<{ label: string; amount: string }> = [
    { label: "Subtotal", amount: money(invoice.subtotal_minor) },
  ];
  if (invoice.tax_total_minor !== 0) {
    totals.push({ label: "Sales tax", amount: money(invoice.tax_total_minor) });
  }
  totals.push({ label: "Total", amount: money(invoice.total_minor) });
  if (paidMinor > 0) {
    totals.push({ label: "Paid to date", amount: money(paidMinor) });
  }
  totals.push({ label: "Balance due", amount: money(invoice.balance_due_minor) });

  const billToLines = formatPostalAddress(customer);
  const contactLines = [customer.contact_name, customer.phone, customer.email]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0 && value !== customer.name);

  return {
    title: invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : "Draft invoice",
    status: invoice.status,
    watermark:
      invoice.status === "draft" ? "DRAFT" : invoice.status === "void" ? "VOID" : null,
    seller: {
      displayName: company.dba_name?.trim() || company.legal_name,
      legalLine: company.dba_name?.trim() ? company.legal_name : null,
      lines: formatPostalAddress(company),
    },
    billTo: { name: customer.name, lines: [...billToLines, ...contactLines] },
    meta: [
      { label: "Issue date", value: invoice.issue_date },
      { label: "Due date", value: invoice.due_date ?? "On receipt" },
    ],
    lines: lines.map((line) => ({
      description: line.description.trim() || "—",
      quantity: quantityText(line.quantity),
      unitPrice: money(line.unit_price_minor),
      amount: money(line.line_subtotal_minor),
    })),
    totals,
    memo: invoice.memo?.trim() || null,
  };
}

export function invoiceDocumentFileName(
  invoiceNumber: string | null,
  issueDate = "",
): string {
  const stem = invoiceNumber
    ? invoiceNumber.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    : `draft-${issueDate}`;
  return `invoice-${stem}.pdf`;
}
