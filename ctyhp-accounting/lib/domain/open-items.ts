/**
 * Open Invoices, Unpaid Bills, Customer Balances and Vendor Balances: four
 * readings of the one open-item list the A/R and A/P Aging reports already read
 * (`acc_ar_ageing` / `acc_ap_ageing`).
 *
 * That list is the current open position: every document dated on or before
 * the as-of date, at what is still open on it today, in base currency. Credit
 * memos, vendor credits and unapplied payments are in it with a negative
 * balance. The aging reports net the lot, and so do the balances here; the
 * open-document reports list invoices (or bills) only and say what the credits
 * take off, so their total still ties to the aging.
 *
 * Pure: rows in, report out.
 */

import { fromMinor } from "./money";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";

/** One row of `acc_ar_ageing` / `acc_ap_ageing`, as the reports read it. */
export interface OpenItemRow {
  partyId: string;
  partyName: string;
  /** invoice, credit_memo, payment — or bill, vendor_credit, bill_payment. */
  docType: string;
  docNumber: string | null;
  docDate: string;
  dueDate: string;
  /** Base currency, what is still open; negative for a credit or an unapplied payment. */
  balanceMinor: number;
}

/** What a document was for in the first place, by its number. */
export interface DocumentAmount {
  number: string;
  /** In the document's own currency. */
  totalMinor: number;
  balanceMinor: number;
}

export interface OpenDocumentLine {
  key: string;
  partyId: string;
  partyName: string;
  docNumber: string | null;
  docDate: string;
  dueDate: string;
  /** Days past due on the as-of date; 0 or less is not yet due. */
  daysPastDue: number;
  /** The document's original amount in base currency, or null when it could not be read. */
  amountMinor: number | null;
  openMinor: number;
}

export interface OpenDocumentsReport {
  lines: OpenDocumentLine[];
  /** The open balance of the documents listed. */
  documentsMinor: number;
  /** Credits and unapplied payments: what they take off, as a negative number (0 when none). */
  creditsMinor: number;
  /** documentsMinor + creditsMinor: the Aging total for the same date. */
  agingTotalMinor: number;
}

export interface PartyBalanceLine {
  partyId: string;
  partyName: string;
  balanceMinor: number;
}

export interface PartyBalancesReport {
  lines: PartyBalanceLine[];
  totalMinor: number;
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole calendar days from the due date to the as-of date. */
export function daysPastDue(dueDate: string, asOf: string): number {
  return Math.round(dayNumber(asOf) - dayNumber(dueDate));
}

/** "Current" when not yet due, otherwise "N days". */
export function ageLabel(days: number): string {
  if (days <= 0) return "Current";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

const byName = (a: string, b: string) => a.localeCompare(b, "en-US", { sensitivity: "base" });

/**
 * The documents still open on the as-of date, one line each, by party then due
 * date. `documentType` is "invoice" for Open Invoices and "bill" for Unpaid
 * Bills; every other row of the list is a credit and is totalled, not listed.
 *
 * A document's original amount comes from `amounts` (keyed by number) and is
 * put in base currency at the same rate as its open balance, so a
 * foreign-currency invoice reads consistently across its two columns.
 */
export function openDocuments(
  rows: readonly OpenItemRow[],
  asOf: string,
  documentType: "invoice" | "bill",
  amounts: ReadonlyMap<string, DocumentAmount>,
): OpenDocumentsReport {
  const lines: OpenDocumentLine[] = [];
  let documentsMinor = 0;
  let creditsMinor = 0;
  for (const row of rows) {
    if (row.docType !== documentType) {
      creditsMinor += row.balanceMinor;
      continue;
    }
    documentsMinor += row.balanceMinor;
    const source = row.docNumber ? amounts.get(row.docNumber) : undefined;
    const amountMinor =
      source && source.balanceMinor !== 0
        ? Math.round((source.totalMinor * row.balanceMinor) / source.balanceMinor)
        : null;
    lines.push({
      key: `${row.partyId}:${row.docNumber ?? row.docDate}`,
      partyId: row.partyId,
      partyName: row.partyName,
      docNumber: row.docNumber,
      docDate: row.docDate,
      dueDate: row.dueDate,
      daysPastDue: daysPastDue(row.dueDate, asOf),
      amountMinor,
      openMinor: row.balanceMinor,
    });
  }
  lines.sort(
    (a, b) =>
      byName(a.partyName, b.partyName) ||
      a.partyId.localeCompare(b.partyId) ||
      a.dueDate.localeCompare(b.dueDate) ||
      (a.docNumber ?? "").localeCompare(b.docNumber ?? ""),
  );
  return { lines, documentsMinor, creditsMinor, agingTotalMinor: documentsMinor + creditsMinor };
}

/** What each party owes (or is owed), netting its credits; parties at zero are left out. */
export function partyBalances(rows: readonly OpenItemRow[]): PartyBalancesReport {
  const byParty = new Map<string, PartyBalanceLine>();
  for (const row of rows) {
    const line = byParty.get(row.partyId) ?? { partyId: row.partyId, partyName: row.partyName, balanceMinor: 0 };
    line.balanceMinor += row.balanceMinor;
    byParty.set(row.partyId, line);
  }
  const lines = [...byParty.values()]
    .filter((line) => line.balanceMinor !== 0)
    .sort((a, b) => byName(a.partyName, b.partyName) || a.partyId.localeCompare(b.partyId));
  return { lines, totalMinor: lines.reduce((sum, line) => sum + line.balanceMinor, 0) };
}

// --- Export -------------------------------------------------------------------

export interface AsOfSheetContext {
  companyName: string;
  asOf: string;
  currencyCode: string;
  baseDecimals: number;
}

/** Open Invoices or Unpaid Bills as the table shows it, with the credits and the aging total under it. */
export function openDocumentsSheet(
  report: OpenDocumentsReport,
  kind: "invoice" | "bill",
  ctx: AsOfSheetContext,
): ReportExportSheet {
  const money = (minor: number | null) => (minor === null ? null : fromMinor(minor, ctx.baseDecimals));
  const invoices = kind === "invoice";
  const total = (party: string, open: number) => ({ date: "", num: "", party, due: "", age: "", amount: null, open: money(open) });
  return {
    fileName: sanitizeExportFileName(`${invoices ? "open-invoices" : "unpaid-bills"}-as-of-${ctx.asOf}`),
    companyName: ctx.companyName,
    title: invoices ? "Open Invoices" : "Unpaid Bills",
    subtitle: `As of ${ctx.asOf}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "date", header: "Date", kind: "text", width: 12 },
      { key: "num", header: "Num", kind: "text", width: 14 },
      { key: "party", header: invoices ? "Customer" : "Vendor", kind: "text", width: 30 },
      { key: "due", header: "Due", kind: "text", width: 12 },
      { key: "age", header: "Age", kind: "text", width: 10 },
      { key: "amount", header: "Amount", kind: "money", width: 16 },
      { key: "open", header: "Open balance", kind: "money", width: 16 },
    ],
    rows: [
      ...report.lines.map((line) => ({
        date: line.docDate,
        num: line.docNumber ?? "",
        party: line.partyName,
        due: line.dueDate,
        age: ageLabel(line.daysPastDue),
        amount: money(line.amountMinor),
        open: money(line.openMinor),
      })),
      total(invoices ? "Total open invoices" : "Total unpaid bills", report.documentsMinor),
      total("Credits and unapplied payments", report.creditsMinor),
      total(invoices ? "A/R Aging total" : "A/P Aging total", report.agingTotalMinor),
    ],
  };
}

/** Customer Balance Summary or Vendor Balance Summary. */
export function partyBalancesSheet(
  report: PartyBalancesReport,
  kind: "customer" | "vendor",
  ctx: AsOfSheetContext,
): ReportExportSheet {
  const customers = kind === "customer";
  return {
    fileName: sanitizeExportFileName(`${kind}-balances-as-of-${ctx.asOf}`),
    companyName: ctx.companyName,
    title: customers ? "Customer Balance Summary" : "Vendor Balance Summary",
    subtitle: `As of ${ctx.asOf}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "party", header: customers ? "Customer" : "Vendor", kind: "text", width: 36 },
      { key: "balance", header: "Balance", kind: "money", width: 18 },
    ],
    rows: [
      ...report.lines.map((line) => ({ party: line.partyName, balance: fromMinor(line.balanceMinor, ctx.baseDecimals) })),
      { party: "Total", balance: fromMinor(report.totalMinor, ctx.baseDecimals) },
    ],
  };
}
