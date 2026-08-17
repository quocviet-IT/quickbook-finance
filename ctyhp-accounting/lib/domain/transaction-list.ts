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
import { fromMinor, type Minor } from "./money";
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
  /**
   * Every account the entry touched.
   *
   * The labels above collapse to "— Split —" when a side hit more than one
   * account, so they cannot answer "did this entry touch 6010". This can.
   */
  accountIds: string[];
}

/**
 * The choice standing for rows with no customer or vendor.
 *
 * A sentinel rather than null, because a Select needs a value and an empty
 * string cannot be told apart from "nothing chosen". The brackets keep it clear
 * of any real customer or vendor name.
 */
export const NO_PARTY = "[no party]";

export interface TransactionListFilter {
  /** An exact party name, or NO_PARTY for rows without one. */
  party: string | null;
  accountId: string | null;
  sourceType: string | null;
  reconciled: "all" | "yes" | "no";
  /** Matched against description, entry number, party and both labels. */
  search: string;
}

/**
 * Narrow the rows already on screen.
 *
 * Every filter here works on rows the browser holds. Only the date range is a
 * query, because the range is what was asked of the database.
 */
export function filterTransactionList(
  rows: TransactionListRow[],
  filter: TransactionListFilter,
): TransactionListRow[] {
  const search = filter.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.party !== null) {
      const party = row.partyName ?? NO_PARTY;
      if (party !== filter.party) return false;
    }
    // Any line, not the label: a split entry touching this account must stay.
    if (filter.accountId !== null && !row.accountIds.includes(filter.accountId)) return false;
    if (filter.sourceType !== null && row.sourceType !== filter.sourceType) return false;
    if (filter.reconciled !== "all" && row.reconciled !== (filter.reconciled === "yes")) {
      return false;
    }
    if (search) {
      const haystack = [
        row.description,
        row.entryNumber,
        row.partyName ?? "",
        row.categoryLabel ?? "",
        row.moneyLabel ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

/**
 * What to offer in the dropdowns, taken from the rows on screen.
 *
 * Not the whole chart of accounts: a list of everything makes the reader hunt
 * for the entries that have anything in them, and choosing one that is absent
 * empties the table in a way that looks like a fault.
 */
export function transactionListChoices(rows: TransactionListRow[]): {
  parties: string[];
  accountIds: string[];
  sourceTypes: string[];
} {
  const parties = new Set<string>();
  const accountIds = new Set<string>();
  const sourceTypes = new Set<string>();
  for (const row of rows) {
    if (row.partyName) parties.add(row.partyName);
    for (const id of row.accountIds) accountIds.add(id);
    if (row.sourceType) sourceTypes.add(row.sourceType);
  }
  return {
    parties: [...parties].sort((a, b) => a.localeCompare(b)),
    accountIds: [...accountIds].sort(),
    sourceTypes: [...sourceTypes].sort(),
  };
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
  /** The base currency's own decimal_places — 0 for a currency like VND. */
  baseDecimals: number;
}): ReportExportSheet {
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
      amount: fromMinor(row.amountMinor, input.baseDecimals),
      reconciled: row.reconciled ? "Yes" : "No",
    })),
  };
}
