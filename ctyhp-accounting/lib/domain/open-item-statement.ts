/**
 * The open-item statement (3.0.13): what one customer still owes on a day,
 * line by line and aged, as the prototype lays it out (statementHTML and
 * statementEmail in Accounting System-v4.html).
 *
 * Every string the page, the PDF and the email show is built here, so the
 * three cannot disagree. The items are acc_ar_ageing's, the rows A/R Aging
 * reads, so a customer's statement totals what their A/R Aging row does. A
 * credit memo or a payment with money left over is a negative line and comes
 * off the total.
 */
import { AGING_BUCKETS, computeAging, daysPastDue } from "./aging";
import {
  documentBillTo,
  documentSeller,
  type DocumentBillTo,
  type DocumentCompany,
  type DocumentCustomer,
  type DocumentSeller,
  type DocumentTable,
  type PrintedDocument,
} from "./invoice-document";
import { statementDocType, statementPayNote } from "./party-statement";
import { formatDate, formatLongDate, formatMoney } from "@/lib/format";

/** The prototype cuts a description at 44 characters. */
export const STATEMENT_DESCRIPTION_MAX = 44;
/** Lines listed in the email; a longer list keeps the mailto link short enough for every mail program. */
export const STATEMENT_EMAIL_MAX_LINES = 15;

const BUCKET_LABELS: Record<string, string> = {
  current: "Current",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "Over 90 days",
};

export const STATEMENT_TABLE_HEAD = ["Date", "Description", "Due", "Age", "Amount", "Outstanding"];

/** A document's own figures, in its own currency. */
export interface OpenItemDetail {
  /** Its total, positive. */
  totalMinor: number;
  /** What is still open of it, positive. */
  openMinor: number;
  currencyCode: string;
  /** An invoice's memo, a credit memo's memo or reason, a payment's reference. */
  note: string | null;
}

/** One acc_ar_ageing row for the customer, with its document's figures when they were found. */
export interface OpenItemSource {
  docType: string;
  docNumber: string | null;
  docDate: string;
  /** A credit memo's or a payment's own date. */
  dueDate: string;
  /** Base currency; negative for a credit memo or a payment. */
  outstandingMinor: number;
  detail: OpenItemDetail | null;
}

export interface OpenItemStatementInput {
  asOf: string;
  /** The company's today, which says whether the figures are as at `asOf`. */
  today: string;
  company: DocumentCompany;
  customer: DocumentCustomer;
  items: OpenItemSource[];
  currencyCode: string;
  decimals: number;
}

export interface OpenItemStatementLine {
  key: string;
  docType: string;
  date: string;
  docNumber: string;
  description: string;
  due: string;
  age: string;
  ageDays: number;
  amount: string;
  outstanding: string;
  outstandingMinor: number;
  /** An invoice past its due date; never a payment or a credit. */
  overdue: boolean;
}

export interface OpenItemStatementBucket {
  key: string;
  label: string;
  amount: string;
  amountMinor: number;
}

export interface OpenItemStatement {
  asOf: string;
  asOfText: string;
  asOfLong: string;
  seller: DocumentSeller;
  party: DocumentBillTo;
  companyName: string;
  customerName: string;
  customerEmail: string | null;
  currencyCode: string;
  lines: OpenItemStatementLine[];
  buckets: OpenItemStatementBucket[];
  totalMinor: number;
  totalLabel: "Total due" | "Credit balance";
  /** Never negative: a credit balance is said in its label. */
  totalAmount: string;
  overdueCount: number;
  payNote: string | null;
  emptyText: string | null;
  footnote: string;
}

export type StatementPrintedDocument = PrintedDocument & {
  partyHeading: string;
  table: DocumentTable;
  footnote: string;
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The statement's day from `?asOf=`: a real calendar date, or the company's today. */
export function parseStatementAsOf(value: string | string[] | undefined, today: string): string {
  if (typeof value !== "string") return today;
  const match = ISO.exec(value);
  if (!match) return today;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? value : today;
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > STATEMENT_DESCRIPTION_MAX ? `${flat.slice(0, STATEMENT_DESCRIPTION_MAX - 1)}…` : flat;
}

/** What a line is, in the customer's terms. */
export function openItemDescription(docType: string, note: string | null | undefined): string {
  const text = note?.trim() || null;
  switch (docType) {
    case "invoice":
      return shorten(text ?? "Invoice");
    case "credit_memo":
      return shorten(text ? `Credit memo: ${text}` : "Credit memo");
    case "payment":
      return shorten(text ? `Payment received, ref ${text}` : "Payment received");
    default:
      return shorten(statementDocType(docType));
  }
}

/**
 * The document's amount in base currency, signed as its outstanding is. A
 * foreign document is converted at the rate its outstanding was, so the two
 * columns agree.
 */
export function openItemAmountMinor(item: OpenItemSource, baseCurrency: string): number {
  const detail = item.detail;
  if (!detail || detail.openMinor <= 0) return item.outstandingMinor;
  const sign = item.outstandingMinor < 0 ? -1 : 1;
  if (detail.currencyCode === baseCurrency) return sign * detail.totalMinor;
  return sign * Math.round((detail.totalMinor * Math.abs(item.outstandingMinor)) / detail.openMinor);
}

function ageText(days: number): string {
  if (days <= 0) return "current";
  return days === 1 ? "1 day" : `${days} days`;
}

export function buildOpenItemStatement(input: OpenItemStatementInput): OpenItemStatement {
  const { asOf, today, company, customer, currencyCode, decimals } = input;
  const money = (minor: number) => formatMoney(minor, currencyCode, decimals);
  const items = [...input.items].sort((a, b) =>
    a.docDate === b.docDate ? (a.docNumber ?? "").localeCompare(b.docNumber ?? "") : a.docDate < b.docDate ? -1 : 1,
  );
  const lines: OpenItemStatementLine[] = items.map((item, index) => {
    const ageDays = Math.max(0, daysPastDue(item.dueDate, asOf));
    const isInvoice = item.docType === "invoice";
    return {
      key: `${item.docType}:${item.docNumber ?? `#${index}`}`,
      docType: item.docType,
      date: formatDate(item.docDate),
      docNumber: item.docNumber ?? "—",
      description: openItemDescription(item.docType, item.detail?.note),
      due: isInvoice ? formatDate(item.dueDate) : "—",
      age: ageText(ageDays),
      ageDays,
      amount: money(openItemAmountMinor(item, currencyCode)),
      outstanding: money(item.outstandingMinor),
      outstandingMinor: item.outstandingMinor,
      overdue: isInvoice && ageDays > 0,
    };
  });
  const { buckets, total } = computeAging(
    items.map((item) => ({ dueDate: item.dueDate, balanceMinor: item.outstandingMinor })),
    asOf,
  );
  const seller = documentSeller(company);
  const asOfLong = formatLongDate(asOf);
  const footnote = [
    asOf === today
      ? `Every figure is as at ${asOfLong}. Anything paid after that date is not reflected here.`
      : `Lists what was dated on or before ${asOfLong}, aged to that date. Amounts outstanding are as they stand on ${formatLongDate(today)}.`,
    lines.some((line) => line.outstandingMinor < 0)
      ? "Payments not yet applied and unused credits are shown as negative amounts and reduce the total."
      : null,
  ]
    .filter((sentence): sentence is string => sentence !== null)
    .join(" ");

  return {
    asOf,
    asOfText: formatDate(asOf),
    asOfLong,
    seller,
    party: documentBillTo(customer),
    companyName: seller.displayName,
    customerName: customer.name,
    customerEmail: customer.email?.trim() || null,
    currencyCode,
    lines,
    buckets: AGING_BUCKETS.map((bucket) => ({
      key: bucket.key,
      label: BUCKET_LABELS[bucket.key],
      amountMinor: buckets[bucket.key] ?? 0,
      amount: money(buckets[bucket.key] ?? 0),
    })),
    totalMinor: total,
    totalLabel: total < 0 ? "Credit balance" : "Total due",
    totalAmount: money(Math.abs(total)),
    overdueCount: lines.filter((line) => line.overdue).length,
    payNote: statementPayNote("customer", total, company.pay_note),
    emptyText: lines.length === 0 ? `Nothing outstanding as of ${asOfLong}.` : null,
    footnote,
  };
}

/**
 * The Email button's message: the prototype's wording, for the user's own mail
 * program. The app sends no mail; the user attaches the PDF.
 */
export function openItemStatementEmail(s: OpenItemStatement): {
  to: string;
  subject: string;
  body: string;
  href: string;
} {
  const subject = `Statement from ${s.companyName} as of ${s.asOfText}`;
  const out = [`Dear ${s.customerName},`, "", `A statement of your account with ${s.companyName} as at ${s.asOfLong}.`, ""];
  if (s.lines.length === 0) {
    out.push(`Nothing is outstanding on your account as at ${s.asOfLong}.`);
  } else {
    for (const line of s.lines.slice(0, STATEMENT_EMAIL_MAX_LINES)) {
      const parts = [line.date, line.docNumber, line.outstanding];
      if (line.docType === "invoice") parts.push(`due ${line.due}`);
      if (line.overdue) parts.push(`${line.ageDays} ${line.ageDays === 1 ? "day" : "days"} overdue`);
      out.push(`  ${parts.join("   ")}`);
    }
    const more = s.lines.length - STATEMENT_EMAIL_MAX_LINES;
    if (more > 0) out.push(`  …and ${more} more, listed in the attached statement.`);
    out.push("", `${s.totalLabel}: ${s.totalAmount} ${s.currencyCode}`);
    if (s.overdueCount > 0) {
      out.push("", `${s.overdueCount} of these ${s.overdueCount === 1 ? "is" : "are"} past the due date.`);
    }
  }
  if (s.payNote) out.push("", s.payNote);
  out.push("", "If any line does not match your own records, tell me which one and I will look into it.", "", s.companyName);
  const body = out.join("\r\n");
  const to = s.customerEmail ?? "";
  const address = encodeURIComponent(to).replace(/%40/g, "@");
  return {
    to,
    subject,
    body,
    href: `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}

/** What lib/client/invoice-pdf draws for the statement. */
export function openItemStatementDocument(s: OpenItemStatement): StatementPrintedDocument {
  return {
    title: "Statement",
    watermark: null,
    seller: s.seller,
    billTo: s.party,
    meta: [
      { label: "As of", value: s.asOfText },
      { label: "Open items", value: String(s.lines.length) },
    ],
    lines: [],
    table: {
      head: STATEMENT_TABLE_HEAD,
      body: s.lines.map((line) => [
        `${line.date}\n${line.docNumber}`,
        line.description,
        line.due,
        line.age,
        line.amount,
        line.outstanding,
      ]),
      rightAligned: [2, 3, 4, 5],
    },
    totals: s.lines.length
      ? [
          ...s.buckets.map((bucket) => ({ label: bucket.label, amount: bucket.amount })),
          { label: s.totalLabel, amount: s.totalAmount },
        ]
      : [],
    memo: s.emptyText,
    payNote: s.payNote,
    partyHeading: "STATEMENT FOR",
    footnote: s.footnote,
  };
}

/** `statement-blueridge-foods-2026-11-10.pdf`, as `invoiceDocumentFileName` names an invoice. */
export function openItemStatementFileName(s: OpenItemStatement): string {
  const slug = s.customerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "customer";
  return `statement-${slug}-${s.asOf}.pdf`;
}
