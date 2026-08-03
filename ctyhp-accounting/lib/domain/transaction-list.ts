/**
 * Transaction List by Date — the chronological, one-row-per-transaction view
 * used for auditing and reconciling a period.
 *
 * The rows come from `acc_transaction_list`, which decides the hard parts in
 * SQL: who the transaction was with, which category and money accounts it
 * touched, and its signed amount. What is left here is arithmetic and shaping,
 * which is worth having testable because a total nobody can reproduce is worse
 * than no total.
 */
import type { Minor } from "./money";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";

export interface TransactionListRow {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  sourceType: string;
  /** The customer or vendor, when the transaction has one. */
  partyName: string | null;
  /** The category account, or "— Split —" across several. */
  categoryLabel: string | null;
  /** The bank or credit card account, when money actually moved. */
  moneyLabel: string | null;
  /** Signed: negative is money or value leaving the business. */
  amountMinor: Minor;
  currencyCode: string;
  reconciled: boolean;
}

export interface TransactionListTotals {
  count: number;
  inMinor: Minor;
  outMinor: Minor;
  netMinor: Minor;
  /** How much of the period still has to be reconciled. */
  unreconciled: number;
}

/**
 * What the visible range adds up to. `outMinor` is reported as a positive
 * magnitude because it is read as "money out", not as a negative quantity.
 */
export function transactionListTotals(rows: readonly TransactionListRow[]): TransactionListTotals {
  let inMinor = 0;
  let outMinor = 0;
  let unreconciled = 0;
  for (const row of rows) {
    if (row.amountMinor >= 0) inMinor += row.amountMinor;
    else outMinor += -row.amountMinor;
    if (!row.reconciled) unreconciled += 1;
  }
  return { count: rows.length, inMinor, outMinor, netMinor: inMinor - outMinor, unreconciled };
}

/**
 * The export, in the seven columns the report was asked for.
 *
 * Amount goes out as a number rather than a formatted string: this report is
 * exported precisely so someone can total and pivot it, and "-$1,250.00" in a
 * cell defeats that.
 */
export function buildTransactionListSheet(input: {
  rows: readonly TransactionListRow[];
  companyName: string;
  from: string;
  to: string;
  currencyCode: string;
}): ReportExportSheet {
  const decimalsDivisor = 100;
  return {
    fileName: sanitizeExportFileName(`transaction-list-${input.from}-to-${input.to}`),
    companyName: input.companyName,
    title: "Transaction List by Date",
    subtitle: `${input.from} to ${input.to}`,
    currencyCode: input.currencyCode,
    columns: [
      { key: "date", header: "Date", kind: "text", width: 14 },
      { key: "party", header: "Vendor/Customer Name", kind: "text", width: 28 },
      { key: "description", header: "Description", kind: "text", width: 34 },
      { key: "category", header: "Account Type", kind: "text", width: 26 },
      { key: "money", header: "Bank or Credit Card", kind: "text", width: 24 },
      { key: "amount", header: "Amount", kind: "money", width: 16 },
      { key: "reconciled", header: "Reconciled", kind: "text", width: 12 },
    ],
    rows: input.rows.map((row) => ({
      date: row.entryDate,
      party: row.partyName ?? "",
      description: row.description,
      category: row.categoryLabel ?? "",
      money: row.moneyLabel ?? "",
      amount: row.amountMinor / decimalsDivisor,
      reconciled: row.reconciled ? "Yes" : "No",
    })),
  };
}
