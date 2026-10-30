/**
 * What Copy, CSV, PDF, Excel and Print hand over for the statements, the
 * General Ledger, the 1099 Review and the Journal Report: the same rows the
 * screen shows, money in major units.
 *
 * Pure: the shown data in, a sheet out.
 */

import { sourceLabel } from "./entry-detail";
import { journalEntryAmountMinor } from "./journal-entry-amount";
import { fromMinor } from "./money";
import { statementDocType, statementPayNote } from "./party-statement";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { statusLabel, humanizeStatus } from "./status-label";
import { formatDateRange } from "@/lib/format";
import type { StatementReport } from "@/lib/services/aging";
import type { GeneralLedger, GeneralLedgerRow, JournalEntrySummary } from "@/lib/services/journal";
import type { Report1099 } from "@/lib/services/vendorTax";

interface SheetContext {
  companyName: string;
  currencyCode: string;
  baseDecimals: number;
}

/** Customer Statement or Vendor Statement: opening balance, each document, closing balance. */
export function partyStatementSheet(
  kind: "customer" | "vendor",
  partyName: string,
  report: StatementReport,
  when: { from: string | null; to: string },
  ctx: SheetContext,
  /** The company's How to pay (2.83), printed under a customer statement that closes owing something. */
  payNote: string | null = null,
): ReportExportSheet {
  const money = (minor: number) => fromMinor(minor, ctx.baseDecimals);
  const customer = kind === "customer";
  const howToPay = statementPayNote(kind, report.closingMinor, payNote);
  return {
    fileName: sanitizeExportFileName(`${customer ? "customer" : "vendor"}-statement-${partyName}-${when.to}`),
    companyName: ctx.companyName,
    title: customer ? "Customer Statement" : "Vendor Statement",
    subtitle: `${partyName} · ${formatDateRange(when.from, when.to)}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "date", header: "Date", kind: "text", width: 12 },
      { key: "type", header: "Type", kind: "text", width: 18 },
      { key: "num", header: "Number", kind: "text", width: 16 },
      { key: "amount", header: "Amount", kind: "money", width: 16 },
      { key: "running", header: "Running", kind: "money", width: 16 },
    ],
    rows: [
      { date: "", type: "Opening balance", num: "", amount: null, running: money(report.openingMinor) },
      ...report.rows.map((row) => ({
        date: row.txnDate,
        type: statementDocType(row.docType),
        num: row.docNumber ?? "",
        amount: money(row.amountMinor),
        running: money(row.runningMinor),
      })),
      { date: "", type: "Closing balance", num: "", amount: null, running: money(report.closingMinor) },
    ],
    ...(howToPay ? { notes: [{ heading: "How to pay", text: howToPay }] } : {}),
  };
}

/** The General Ledger for one account: the rows shown, between its opening and closing balance. */
export function generalLedgerSheet(
  ledger: GeneralLedger,
  rows: readonly GeneralLedgerRow[],
  when: { from: string | null; to: string },
  ctx: SheetContext,
): ReportExportSheet {
  const money = (minor: number) => fromMinor(minor, ctx.baseDecimals);
  // A zero side is left blank, as the screen leaves it.
  const side = (minor: number) => (minor ? money(minor) : null);
  return {
    fileName: sanitizeExportFileName(`general-ledger-${ledger.accountCode}-${when.to}`),
    companyName: ctx.companyName,
    title: "General Ledger",
    subtitle: `${ledger.accountCode} ${ledger.accountName} · ${formatDateRange(when.from, when.to)}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "date", header: "Date", kind: "text", width: 12 },
      { key: "entry", header: "Entry", kind: "text", width: 14 },
      { key: "source", header: "Source", kind: "text", width: 18 },
      { key: "memo", header: "Memo", kind: "text", width: 40 },
      { key: "debit", header: "Debit", kind: "money", width: 16 },
      { key: "credit", header: "Credit", kind: "money", width: 16 },
      { key: "running", header: "Running", kind: "money", width: 16 },
    ],
    rows: [
      { date: "", entry: "", source: "", memo: "Opening balance", debit: null, credit: null, running: money(ledger.openingMinor) },
      ...rows.map((row) => ({
        date: row.entryDate,
        entry: row.entryNumber,
        source: sourceLabel(row.sourceType),
        memo: row.memo ?? "",
        debit: side(row.debitMinor),
        credit: side(row.creditMinor),
        running: money(row.runningMinor),
      })),
      { date: "", entry: "", source: "", memo: "Closing balance", debit: null, credit: null, running: money(ledger.closingMinor) },
    ],
  };
}

/** The 1099 Review: one row per vendor, the columns the old CSV carried. */
export function review1099Sheet(report: Report1099, ctx: SheetContext): ReportExportSheet {
  return {
    fileName: sanitizeExportFileName(`1099-review-${report.year}`),
    companyName: ctx.companyName,
    title: "1099 Review",
    subtitle: `Tax year ${report.year} · cash basis`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "vendor", header: "Vendor", kind: "text", width: 30 },
      { key: "reportingName", header: "Reporting name", kind: "text", width: 30 },
      { key: "classification", header: "Classification", kind: "text", width: 20 },
      { key: "w9", header: "W-9 status", kind: "text", width: 14 },
      { key: "tin", header: "TIN on file", kind: "text", width: 12 },
      { key: "address", header: "Address complete", kind: "text", width: 16 },
      { key: "box", header: "Form box", kind: "text", width: 12 },
      { key: "paid", header: `Paid (${ctx.currencyCode})`, kind: "money", width: 16 },
      { key: "reportable", header: "Reportable", kind: "text", width: 12 },
      { key: "exceptions", header: "Exceptions", kind: "text", width: 50 },
    ],
    rows: report.rows.map((row) => ({
      vendor: row.vendor_name,
      reportingName: row.reporting_name ?? "",
      classification: row.classification ? humanizeStatus(row.classification) : "",
      w9: statusLabel(row.w9_status),
      tin: row.tin_on_file ? "Yes" : "No",
      address: row.address_complete ? "Yes" : "No",
      box: row.box_code ?? "",
      paid: fromMinor(row.paid_minor, ctx.baseDecimals),
      reportable: row.reportable ? "Yes" : "No",
      exceptions: row.exceptions.map((e) => `${e.severity}: ${e.message}`).join("; "),
    })),
  };
}

/** The Journal Report: each entry's header and one row per line, as the expanded screen reads. */
export function journalReportSheet(
  entries: readonly JournalEntrySummary[],
  when: { from: string | null; to: string },
  ctx: SheetContext,
): ReportExportSheet {
  const money = (minor: number) => (minor ? fromMinor(minor, ctx.baseDecimals) : null);
  return {
    fileName: sanitizeExportFileName(`journal-report-${when.to}`),
    companyName: ctx.companyName,
    title: "Journal Report",
    subtitle: formatDateRange(when.from, when.to),
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "number", header: "Number", kind: "text", width: 14 },
      { key: "date", header: "Date", kind: "text", width: 12 },
      { key: "source", header: "Source", kind: "text", width: 18 },
      { key: "description", header: "Description", kind: "text", width: 40 },
      // The entry's own amount, as the screen shows it, beside each of its lines.
      { key: "amount", header: "Entry amount", kind: "money", width: 16 },
      { key: "status", header: "Status", kind: "text", width: 12 },
      { key: "account", header: "Account", kind: "text", width: 34 },
      { key: "debit", header: "Debit", kind: "money", width: 16 },
      { key: "credit", header: "Credit", kind: "money", width: 16 },
    ],
    rows: entries.flatMap((entry) => {
      const head = {
        number: entry.entryNumber,
        date: entry.entryDate,
        source: sourceLabel(entry.sourceType),
        description: entry.description ?? "",
        amount: money(journalEntryAmountMinor(entry.lines)),
        status: statusLabel(entry.isReversed ? "reversed" : entry.status),
      };
      if (entry.lines.length === 0) return [{ ...head, account: "", debit: null, credit: null }];
      return entry.lines.map((line) => ({
        ...head,
        account: `${line.accountCode} ${line.accountName}`,
        debit: money(line.debitMinor),
        credit: money(line.creditMinor),
      }));
    }),
  };
}
