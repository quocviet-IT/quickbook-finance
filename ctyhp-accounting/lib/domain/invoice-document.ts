/**
 * The printable form of an invoice: what a customer sees on paper.
 *
 * Pure. It turns stored minor units and raw rows into the exact strings the
 * renderer draws, so what gets printed is decided here — and tested here —
 * rather than inside a PDF library call.
 *
 * The seller block, the bill-to block, the line rows, the balance check and
 * the totals rows are shared with the estimate (lib/domain/estimate-document),
 * so the two documents print a company, a customer and a line the same way.
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

/** The customer a document is addressed to. */
export type DocumentCustomer = PostalParty & {
  name: string;
  email: string | null;
  contact_name: string | null;
  phone: string | null;
};

/** The company a document comes from: the current settings row. */
export type DocumentCompany = PostalParty & {
  legal_name: string;
  dba_name: string | null;
  /** Accepted so callers can pass the settings row as-is; never printed. */
  ein_ref?: string | null;
  /** How to pay (0179): printed at the foot of an invoice, and of nothing else. */
  pay_note?: string | null;
};

/** One stored line, as an invoice or an estimate keeps it. */
export interface DocumentSourceLine {
  line_order: number;
  description: string;
  quantity: number;
  unit_price_minor: number;
  line_subtotal_minor: number;
  line_tax_minor: number;
  line_total_minor: number;
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
  lines: DocumentSourceLine[];
  customer: DocumentCustomer;
  company: DocumentCompany;
}

export interface InvoiceDocumentLine {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface DocumentSeller {
  displayName: string;
  /** The legal name, shown only when it differs from the trading name. */
  legalLine: string | null;
  lines: string[];
}

export interface DocumentBillTo {
  name: string;
  lines: string[];
}

export interface DocumentTotal {
  label: string;
  amount: string;
}

/** What the shared renderer (lib/client/invoice-pdf) draws, whatever the document. */
export interface PrintedDocument {
  title: string;
  /** Drawn across the page so the copy cannot be mistaken; null for none. */
  watermark: string | null;
  seller: DocumentSeller;
  billTo: DocumentBillTo;
  meta: Array<{ label: string; value: string }>;
  lines: InvoiceDocumentLine[];
  totals: DocumentTotal[];
  memo: string | null;
  /** How to pay, under the totals and the memo; an invoice's only (2.86). */
  payNote?: string | null;
}

export interface InvoiceDocument extends PrintedDocument {
  status: string;
  /** DRAFT or VOID. */
  watermark: string | null;
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

/** The trading name first, the legal name beneath it only when they differ. */
export function documentSeller(company: DocumentCompany): DocumentSeller {
  return {
    displayName: company.dba_name?.trim() || company.legal_name,
    legalLine: company.dba_name?.trim() ? company.legal_name : null,
    lines: formatPostalAddress(company),
  };
}

/** The customer's address, then whichever contact details differ from their name. */
export function documentBillTo(customer: DocumentCustomer): DocumentBillTo {
  const addressLines = formatPostalAddress(customer);
  const contactLines = [customer.contact_name, customer.phone, customer.email]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0 && value !== customer.name);
  return { name: customer.name, lines: [...addressLines, ...contactLines] };
}

/**
 * The stored lines in their order, checked against the document's total.
 *
 * A printed document that contradicts the ledger is worse than no document,
 * so a mismatch throws rather than printing. `noun` names the document in the
 * message ("Invoice", "Estimate").
 */
export function linesMatchingTotal<L extends DocumentSourceLine>(
  lines: readonly L[],
  totalMinor: number,
  noun: string,
): L[] {
  const ordered = [...lines].sort((a, b) => a.line_order - b.line_order);
  const lineTotal = ordered.reduce((sum, line) => sum + line.line_total_minor, 0);
  if (lineTotal !== totalMinor) {
    throw new Error(
      `${noun} line total ${lineTotal} does not match the ${noun.toLowerCase()} total ${totalMinor}`,
    );
  }
  return ordered;
}

/** Description, quantity, unit price and amount, as the customer reads them. */
export function documentLines(
  lines: readonly DocumentSourceLine[],
  money: (minor: number) => string,
): InvoiceDocumentLine[] {
  return lines.map((line) => ({
    description: line.description.trim() || "—",
    quantity: quantityText(line.quantity),
    unitPrice: money(line.unit_price_minor),
    amount: money(line.line_subtotal_minor),
  }));
}

/** Subtotal, Sales tax (only when there is any) and Total. */
export function documentTotals(
  amounts: { subtotalMinor: number; taxMinor: number; totalMinor: number },
  money: (minor: number) => string,
): DocumentTotal[] {
  const totals: DocumentTotal[] = [{ label: "Subtotal", amount: money(amounts.subtotalMinor) }];
  if (amounts.taxMinor !== 0) {
    totals.push({ label: "Sales tax", amount: money(amounts.taxMinor) });
  }
  totals.push({ label: "Total", amount: money(amounts.totalMinor) });
  return totals;
}

/**
 * The terms an invoice was raised under, read from its own dates: "Net 30"
 * for 30 days between issue and due, "Due on receipt" when it is due the day
 * it is issued or has no due date. An invoice keeps no terms of its own, so its
 * dates are the record of them, and they cannot disagree with the Due date row.
 */
export function invoiceTermsLabel(issueDate: string, dueDate: string | null): string {
  if (!dueDate) return "Due on receipt";
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const days = Math.round((day(dueDate) - day(issueDate)) / 86_400_000);
  return days > 0 ? `Net ${days}` : "Due on receipt";
}

export function buildInvoiceDocument(source: InvoiceDocumentSource): InvoiceDocument {
  const { invoice, customer, company } = source;
  const decimals = USD_DECIMAL_PLACES;
  const money = (minor: number) => formatMoney(minor, invoice.currency_code, decimals);

  const lines = linesMatchingTotal(source.lines, invoice.total_minor, "Invoice");

  const paidMinor = invoice.total_minor - invoice.balance_due_minor;
  const totals = documentTotals(
    {
      subtotalMinor: invoice.subtotal_minor,
      taxMinor: invoice.tax_total_minor,
      totalMinor: invoice.total_minor,
    },
    money,
  );
  if (paidMinor > 0) {
    totals.push({ label: "Paid to date", amount: money(paidMinor) });
  }
  totals.push({ label: "Balance due", amount: money(invoice.balance_due_minor) });

  return {
    title: invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : "Draft invoice",
    status: invoice.status,
    watermark:
      invoice.status === "draft" ? "DRAFT" : invoice.status === "void" ? "VOID" : null,
    seller: documentSeller(company),
    billTo: documentBillTo(customer),
    meta: [
      { label: "Issue date", value: invoice.issue_date },
      { label: "Due date", value: invoice.due_date ?? "On receipt" },
      { label: "Terms", value: invoiceTermsLabel(invoice.issue_date, invoice.due_date) },
    ],
    lines: documentLines(lines, money),
    totals,
    memo: invoice.memo?.trim() || null,
    // A paid or voided invoice asks for nothing.
    payNote: invoice.balance_due_minor > 0 && invoice.status !== "void" ? company.pay_note?.trim() || null : null,
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
