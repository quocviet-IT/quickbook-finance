/**
 * The printable form of an estimate: a quotation, on the invoice's layout.
 *
 * Pure, like the invoice's model (lib/domain/invoice-document), and built
 * from the same pieces: the seller block, the bill-to block, the line rows,
 * the balance check and the totals rows are that module's own helpers. It
 * adds one thing the invoice has not got: a closing line, always printed,
 * saying nothing is owed on it.
 */
import { USD_DECIMAL_PLACES } from "@/lib/domain/currency";
import {
  documentBillTo,
  documentLines,
  documentSeller,
  documentTotals,
  linesMatchingTotal,
  type DocumentCompany,
  type DocumentCustomer,
  type DocumentSourceLine,
  type PrintedDocument,
} from "@/lib/domain/invoice-document";
import { formatMoney } from "@/lib/format";

/** Printed at the foot of every estimate, after the note. */
export const ESTIMATE_CLOSING_LINE = "This is a quotation, not an invoice. Nothing is owed on it.";

export interface EstimateDocumentSource {
  estimate: {
    estimate_number: string;
    estimate_date: string;
    expiry_date: string;
    currency_code: string;
    subtotal_minor: number;
    tax_minor: number;
    total_minor: number;
    /** "Note printed at the foot". */
    memo: string | null;
  };
  lines: DocumentSourceLine[];
  customer: DocumentCustomer;
  company: DocumentCompany;
}

/**
 * The invoice's printed shape plus a closing line. Nothing is owed on an
 * estimate, so its totals stop at Total: no Paid to date, no Balance due.
 */
export interface EstimateDocument extends PrintedDocument {
  /** Always ESTIMATE_CLOSING_LINE, drawn after the note. */
  footer: string;
  /** `Estimate EST-000001 <customer>.pdf`. */
  fileName: string;
}

/** Characters no file system takes in a name, and control characters. */
const UNSAFE_IN_FILE_NAME = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

/**
 * `Estimate EST-000001 <customer>.pdf`. Characters a file system refuses are
 * dropped from the customer's name, so "Rivera / Sons" saves as
 * "Estimate EST-000001 Rivera Sons.pdf".
 */
export function estimateDocumentFileName(estimateNumber: string, customerName: string): string {
  const customer = customerName.replace(UNSAFE_IN_FILE_NAME, " ").replace(/\s+/g, " ").trim();
  const stem = [`Estimate ${estimateNumber}`, customer].filter((part) => part.length > 0).join(" ");
  return `${stem}.pdf`;
}

export function buildEstimateDocument(source: EstimateDocumentSource): EstimateDocument {
  const { estimate, customer, company } = source;
  const money = (minor: number) => formatMoney(minor, estimate.currency_code, USD_DECIMAL_PLACES);

  const lines = linesMatchingTotal(source.lines, estimate.total_minor, "Estimate");

  return {
    title: `Estimate ${estimate.estimate_number}`,
    watermark: null,
    seller: documentSeller(company),
    billTo: documentBillTo(customer),
    meta: [
      { label: "Estimate date", value: estimate.estimate_date },
      { label: "Valid until", value: estimate.expiry_date },
    ],
    lines: documentLines(lines, money),
    totals: documentTotals(
      {
        subtotalMinor: estimate.subtotal_minor,
        taxMinor: estimate.tax_minor,
        totalMinor: estimate.total_minor,
      },
      money,
    ),
    memo: estimate.memo?.trim() || null,
    footer: ESTIMATE_CLOSING_LINE,
    fileName: estimateDocumentFileName(estimate.estimate_number, customer.name),
  };
}
