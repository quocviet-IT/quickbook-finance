/**
 * Sales by Customer and Expenses by Vendor: the ledger's income (or spending)
 * for a period, divided by who it was with.
 *
 * Both read posted ledger lines in base currency, so sales tax — which posts to
 * a liability, not to income — is never in them, and a foreign-currency
 * document counts at the rate it was posted at. A line whose entry came from no
 * customer (or vendor) document still counts, on one row of its own, so the
 * report's total is the Profit and Loss's for the same period.
 *
 * Pure: lines in, report out.
 */

import { fromMinor } from "./money";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";

/** One posted ledger line on an income (or expense) account, signed so that a sale (or a spend) is positive. */
export interface PartyLedgerLine {
  entryId: string;
  accountId: string;
  amountMinor: number;
  /** The customer or vendor on the document the entry came from; null when there is none. */
  partyId: string | null;
  partyName: string | null;
  /** The invoice the line came from, for counting documents; null for anything else. */
  invoiceId: string | null;
}

export interface PartyActivityLine {
  /** null for the row of lines that came from no customer or vendor document. */
  partyId: string | null;
  partyName: string;
  /** Documents (invoices) for sales; entries, counted once per account, for spending. */
  count: number;
  totalMinor: number;
  /** Share of the grand total, 0–100; null when the grand total is 0. */
  percent: number | null;
}

export interface PartyActivityReport {
  lines: PartyActivityLine[];
  totalMinor: number;
  /** How many lines' entries came from no customer or vendor document. */
  unattributedCount: number;
}

export type PartyCount = "invoices" | "entryAccounts";

export const NO_CUSTOMER = "(No customer)";
export const NO_VENDOR = "(No vendor)";

const byName = (a: string, b: string) => a.localeCompare(b, "en-US", { sensitivity: "base" });

/**
 * One row per party, largest total first, then the row of lines with no party
 * last. `count` decides what the count column counts: distinct invoices (sales)
 * or distinct (entry, account) pairs — an entry touching three expense accounts
 * counts three, as the client's mockup counts it.
 */
export function partyActivity(
  lines: readonly PartyLedgerLine[],
  count: PartyCount,
  noPartyLabel: string,
): PartyActivityReport {
  interface Bucket {
    partyId: string | null;
    partyName: string;
    totalMinor: number;
    keys: Set<string>;
  }
  const buckets = new Map<string, Bucket>();
  let unattributedCount = 0;
  for (const line of lines) {
    const key = line.partyId ?? "";
    if (!line.partyId) unattributedCount += 1;
    const bucket =
      buckets.get(key) ??
      { partyId: line.partyId, partyName: line.partyId ? (line.partyName ?? "") : noPartyLabel, totalMinor: 0, keys: new Set<string>() };
    bucket.totalMinor += line.amountMinor;
    if (count === "invoices") {
      if (line.invoiceId) bucket.keys.add(line.invoiceId);
    } else {
      bucket.keys.add(`${line.entryId}:${line.accountId}`);
    }
    buckets.set(key, bucket);
  }

  const totalMinor = [...buckets.values()].reduce((sum, b) => sum + b.totalMinor, 0);
  const percentOf = (minor: number) => (totalMinor === 0 ? null : (minor / totalMinor) * 100);

  const named = [...buckets.values()]
    .filter((b) => b.partyId !== null && b.totalMinor !== 0)
    .sort((a, b) => b.totalMinor - a.totalMinor || byName(a.partyName, b.partyName));
  const unnamed = buckets.get("");
  const ordered = unnamed && unnamed.totalMinor !== 0 ? [...named, unnamed] : named;

  return {
    lines: ordered.map((b) => ({
      partyId: b.partyId,
      partyName: b.partyName,
      count: b.keys.size,
      totalMinor: b.totalMinor,
      percent: percentOf(b.totalMinor),
    })),
    totalMinor,
    unattributedCount,
  };
}

// --- Export -------------------------------------------------------------------

/** Sales by Customer Summary or Expenses by Vendor Summary. */
export function partyActivitySheet(
  report: PartyActivityReport,
  kind: "sales" | "expenses",
  ctx: { companyName: string; from: string; to: string; currencyCode: string; baseDecimals: number },
): ReportExportSheet {
  const sales = kind === "sales";
  return {
    fileName: sanitizeExportFileName(`${sales ? "sales-by-customer" : "expenses-by-vendor"}-${ctx.from}-to-${ctx.to}`),
    companyName: ctx.companyName,
    title: sales ? "Sales by Customer Summary" : "Expenses by Vendor Summary",
    subtitle: `${ctx.from} to ${ctx.to}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "party", header: sales ? "Customer" : "Vendor", kind: "text", width: 36 },
      { key: "count", header: sales ? "Documents" : "Entries", kind: "number", width: 12 },
      { key: "total", header: "Total", kind: "money", width: 18 },
      { key: "percent", header: sales ? "% of sales" : "% of spend", kind: "percent", width: 12 },
    ],
    rows: [
      ...report.lines.map((line) => ({
        party: line.partyName,
        // Sales with no customer have no invoice to count.
        count: sales && line.partyId === null ? null : line.count,
        total: fromMinor(line.totalMinor, ctx.baseDecimals),
        percent: line.percent === null ? null : Math.round(line.percent * 10) / 10,
      })),
      {
        party: "Total",
        count: null,
        total: fromMinor(report.totalMinor, ctx.baseDecimals),
        percent: report.totalMinor === 0 ? null : 100,
      },
    ],
  };
}
