import { dayBefore, fiscalMonths, fiscalYearForDate } from "./fiscal";
import { NO_VENDOR } from "./party-activity";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";

/**
 * Purchases and Inventory: what was bought, from whom, and whether the stock
 * adds up year by year.
 *
 * Pure calculation. The service reads the posted lines on the inventory,
 * cost-of-goods-sold and adjustment accounts (plus which entries have an equity
 * line) and hands them here. Amounts are base-currency minor units, debit
 * positive: a purchase is positive and a return is negative.
 */

/** One posted line on an inventory, cost-of-goods-sold or adjustment account, with its entry's facts. */
export interface PurchaseLedgerLine {
  entryId: string;
  entryDate: string;
  sourceType: string | null;
  description: string | null;
  sourceId: string | null;
  accountId: string;
  /** Base currency, debit positive. */
  signedMinor: number;
}

/** What the rules need to know about an account. */
export interface PurchaseAccount {
  id: string;
  name: string;
  accountType: string;
}

export interface PurchasesInventoryInput {
  lines: readonly PurchaseLedgerLine[];
  /** Every account, so a line's kind can be told. Only the ones with lines in `lines` matter. */
  accounts: readonly PurchaseAccount[];
  /** The company's inventory accounts (see `lib/domain/inventory-accounts`). */
  inventoryAccountIds: ReadonlySet<string>;
  /** Ids of the posted entries that have a line on an `equity` account. */
  equityEntryIds: ReadonlySet<string>;
  /** Source document id (bill, expense, vendor credit, bill payment, goods receipt) → its vendor. */
  vendorOfSource: ReadonlyMap<string, { id: string; name: string }>;
  fiscalStartMonth: number;
  from: string;
  to: string;
}

/** An inventory-adjustment or write-down account, by its name. */
export const ADJUSTMENT_ACCOUNT_NAME = /inventory\s*adjust|write[- ]?down|shrink/i;

const OPENING_DESCRIPTION = /^\s*opening balance/i;

export type LineKind = "inventory" | "cogs" | "adjustment" | "other";

export function lineKind(
  account: PurchaseAccount | undefined,
  inventoryAccountIds: ReadonlySet<string>,
): LineKind {
  if (!account) return "other";
  if (inventoryAccountIds.has(account.id)) return "inventory";
  if (ADJUSTMENT_ACCOUNT_NAME.test(account.name)) return "adjustment";
  return account.accountType === "cost_of_goods_sold" ? "cogs" : "other";
}

/** An entry that brings stock in rather than buying it: any one of three marks. */
export function isOpeningEntry(entry: {
  id: string;
  sourceType: string | null;
  description: string | null;
}, equityEntryIds: ReadonlySet<string>): boolean {
  return (
    entry.sourceType === "opening_balance" ||
    OPENING_DESCRIPTION.test(entry.description ?? "") ||
    equityEntryIds.has(entry.id)
  );
}

interface ClassifiedLine extends PurchaseLedgerLine {
  kind: LineKind;
  opening: boolean;
  count: boolean;
}

export interface PurchaseYearRow {
  /** The calendar year the fiscal year starts in. */
  fiscalYear: number;
  label: string;
  start: string;
  end: string;
  openingMinor: number;
  boughtMinor: number;
  countAdjustmentMinor: number;
  costOfSalesMinor: number;
  closingMinor: number;
  /** Opening + bought + count adjustment − cost of sales − closing; 0 when the year adds up. */
  offByMinor: number;
}

export interface SupplierRow {
  /** Vendor id, or null for the "(No vendor)" row. */
  vendorId: string | null;
  name: string;
  /** Entries, not posting lines. */
  purchases: number;
  amountMinor: number;
  /** Percent of the period's total, or null when that total is zero. */
  sharePercent: number | null;
}

export interface MonthRow {
  /** "2026-03". */
  month: string;
  label: string;
  amountMinor: number;
  sharePercent: number | null;
}

export interface PurchasesInventoryReport {
  from: string;
  to: string;
  /** No purchase entry anywhere in the books. */
  neverBought: boolean;
  years: PurchaseYearRow[];
  /** Years whose columns do not add up. */
  offByYears: PurchaseYearRow[];
  boughtMinor: number;
  /** Entries in the period whose purchase lines do not net to zero. */
  purchases: number;
  /** Vendors with a purchase in the period; "(No vendor)" is not one. */
  suppliers: number;
  onShelfMinor: number;
  supplierRows: SupplierRow[];
  supplierTotal: { purchases: number; amountMinor: number };
  months: MonthRow[];
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${year}`;
}

function percentOf(part: number, total: number): number | null {
  return total === 0 ? null : (part / total) * 100;
}

function yearLabel(year: number, fiscalStartMonth: number): string {
  if (fiscalStartMonth === 1) return String(year);
  const months = fiscalMonths(year, fiscalStartMonth);
  const first = months[0];
  const last = months[11];
  return `${monthLabel(first.start.slice(0, 7))} – ${monthLabel(last.end.slice(0, 7))}`;
}

/** Inventory balance of the given classified lines on or before a date. */
function balanceUpTo(lines: readonly ClassifiedLine[], date: string): number {
  let sum = 0;
  for (const l of lines) if (l.kind === "inventory" && l.entryDate <= date) sum += l.signedMinor;
  return sum;
}

export function buildPurchasesInventory(input: PurchasesInventoryInput): PurchasesInventoryReport {
  const { fiscalStartMonth, from, to } = input;
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));

  // Entry-level marks first: one adjustment line makes the whole entry a count entry.
  const adjustmentEntries = new Set<string>();
  const kinds = new Map<string, LineKind>();
  for (const l of input.lines) {
    let kind = kinds.get(l.accountId);
    if (kind === undefined) {
      kind = lineKind(accountById.get(l.accountId), input.inventoryAccountIds);
      kinds.set(l.accountId, kind);
    }
    if (kind === "adjustment") adjustmentEntries.add(l.entryId);
  }
  const lines: ClassifiedLine[] = input.lines.map((l) => {
    return {
      ...l,
      kind: kinds.get(l.accountId) ?? "other",
      opening: isOpeningEntry({ id: l.entryId, sourceType: l.sourceType, description: l.description }, input.equityEntryIds),
      count: l.sourceType === "inventory_adjustment" || l.sourceType === "stock_count" || adjustmentEntries.has(l.entryId),
    };
  });

  // A purchase line: inventory, or cost of goods sold (not an adjustment account), in an
  // entry that neither brings stock in nor counts it.
  const isPurchaseLine = (l: ClassifiedLine) =>
    !l.opening && !l.count && (l.kind === "inventory" || l.kind === "cogs");

  // --- Year by year, over all the books ---
  const yearsSeen = new Set<number>();
  for (const l of lines) {
    if (l.kind === "inventory" || l.kind === "cogs") yearsSeen.add(fiscalYearForDate(l.entryDate, fiscalStartMonth));
  }
  const years: PurchaseYearRow[] = [...yearsSeen]
    .sort((a, b) => a - b)
    .map((fiscalYear) => {
      const months = fiscalMonths(fiscalYear, fiscalStartMonth);
      const start = months[0].start;
      const end = months[11].end;
      let broughtIn = 0;
      let bought = 0;
      let countAdjustment = 0;
      let costOfSales = 0;
      for (const l of lines) {
        if (l.entryDate < start || l.entryDate > end) continue;
        if (l.kind === "inventory" && l.opening) broughtIn += l.signedMinor;
        if (isPurchaseLine(l)) bought += l.signedMinor;
        if (l.kind === "inventory" && l.count && !l.opening) countAdjustment += l.signedMinor;
        if (l.kind === "cogs" && !l.count) costOfSales += l.signedMinor;
      }
      const openingMinor = balanceUpTo(lines, dayBefore(start)) + broughtIn;
      const closingMinor = balanceUpTo(lines, end);
      return {
        fiscalYear,
        label: yearLabel(fiscalYear, fiscalStartMonth),
        start,
        end,
        openingMinor,
        boughtMinor: bought,
        countAdjustmentMinor: countAdjustment,
        costOfSalesMinor: costOfSales,
        closingMinor,
        offByMinor: openingMinor + bought + countAdjustment - costOfSales - closingMinor,
      };
    });

  // --- Purchases: one figure per entry, so a perpetual sale (cost of sales against inventory) nets out ---
  interface PurchaseEntry {
    entryDate: string;
    sourceId: string | null;
    netMinor: number;
  }
  const perEntry = new Map<string, PurchaseEntry>();
  for (const l of lines) {
    if (!isPurchaseLine(l)) continue;
    const row = perEntry.get(l.entryId);
    if (row) row.netMinor += l.signedMinor;
    else perEntry.set(l.entryId, { entryDate: l.entryDate, sourceId: l.sourceId, netMinor: l.signedMinor });
  }
  const purchaseEntries = [...perEntry.values()].filter((e) => e.netMinor !== 0);
  const inPeriod = purchaseEntries.filter((e) => e.entryDate >= from && e.entryDate <= to);

  const boughtMinor = inPeriod.reduce((sum, e) => sum + e.netMinor, 0);

  const bySupplier = new Map<string, SupplierRow>();
  for (const e of inPeriod) {
    const vendor = e.sourceId ? input.vendorOfSource.get(e.sourceId) : undefined;
    const key = vendor ? vendor.id : "";
    const row = bySupplier.get(key) ?? {
      vendorId: vendor ? vendor.id : null,
      name: vendor ? vendor.name : NO_VENDOR,
      purchases: 0,
      amountMinor: 0,
      sharePercent: null,
    };
    row.purchases += 1;
    row.amountMinor += e.netMinor;
    bySupplier.set(key, row);
  }
  const supplierRows = [...bySupplier.values()]
    .map((r) => ({ ...r, sharePercent: percentOf(r.amountMinor, boughtMinor) }))
    .sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name));

  const byMonth = new Map<string, number>();
  for (const e of inPeriod) {
    const month = e.entryDate.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + e.netMinor);
  }
  const months: MonthRow[] = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amountMinor]) => ({
      month,
      label: monthLabel(month),
      amountMinor,
      sharePercent: percentOf(amountMinor, boughtMinor),
    }));

  return {
    from,
    to,
    neverBought: purchaseEntries.length === 0,
    years,
    offByYears: years.filter((y) => y.offByMinor !== 0),
    boughtMinor,
    purchases: inPeriod.length,
    suppliers: supplierRows.filter((r) => r.vendorId !== null).length,
    onShelfMinor: balanceUpTo(lines, to),
    supplierRows,
    supplierTotal: { purchases: inPeriod.length, amountMinor: boughtMinor },
    months,
  };
}

/** The footnote under the year-by-year table: either it holds everywhere or it names the years that do not. */
export function yearProofText(
  report: Pick<PurchasesInventoryReport, "offByYears">,
  money: (minor: number) => string,
): string {
  const off = report.offByYears;
  if (off.length === 0) return "That holds in every year shown.";
  const detail = off.map((y) => `${money(Math.abs(y.offByMinor))} in ${y.label}`).join(", ");
  return `${off.length === 1 ? "One year is" : `${off.length} years are`} off by ${detail}, usually stock bought or written off through neither account.`;
}

export const NOTHING_BOUGHT_TITLE = "Nothing has been bought in these books yet.";
export const NOTHING_BOUGHT_HINT = "Anything coded to cost of sales or straight to inventory shows up here.";
export const NOTHING_IN_PERIOD = "Nothing bought in this period.";

/** The report as one flat export: the three tables stacked under a section column. */
export function purchasesInventorySheet(
  report: PurchasesInventoryReport,
  ctx: { companyName: string; currencyCode: string; money: (minor: number) => string },
): ReportExportSheet {
  const percent = (value: number | null) => (value === null ? "" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);
  const blank = { opening: "", bought: "", adjustment: "", costOfSales: "", closing: "", note: "" };
  const rows: ReportExportSheet["rows"] = [];

  for (const y of report.years) {
    rows.push({
      section: "Year by year",
      item: y.label,
      count: "",
      opening: ctx.money(y.openingMinor),
      bought: ctx.money(y.boughtMinor),
      adjustment: ctx.money(y.countAdjustmentMinor),
      costOfSales: ctx.money(y.costOfSalesMinor),
      closing: ctx.money(y.closingMinor),
      note: y.offByMinor === 0 ? "" : `Off by ${ctx.money(Math.abs(y.offByMinor))}`,
    });
  }
  for (const s of report.supplierRows) {
    rows.push({ section: "Who it was bought from", item: s.name, count: String(s.purchases), ...blank, bought: ctx.money(s.amountMinor), note: percent(s.sharePercent) });
  }
  if (report.supplierRows.length > 0) {
    rows.push({
      section: "Who it was bought from",
      item: "Total",
      count: String(report.supplierTotal.purchases),
      ...blank,
      bought: ctx.money(report.supplierTotal.amountMinor),
      note: "",
    });
  }
  for (const m of report.months) {
    rows.push({ section: "Month by month", item: m.label, count: "", ...blank, bought: ctx.money(m.amountMinor), note: percent(m.sharePercent) });
  }

  return {
    fileName: sanitizeExportFileName(`purchases-and-inventory-${report.from}-to-${report.to}`),
    companyName: ctx.companyName,
    title: "Purchases and Inventory",
    subtitle: `${report.from} to ${report.to}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "section", header: "Table", kind: "text", width: 24 },
      { key: "item", header: "Year, supplier or month", kind: "text", width: 32 },
      { key: "count", header: "Purchases", kind: "text", width: 11 },
      { key: "opening", header: "Opening stock", kind: "text", width: 16 },
      { key: "bought", header: "Bought net of returns", kind: "text", width: 20 },
      { key: "adjustment", header: "Count adjustment", kind: "text", width: 16 },
      { key: "costOfSales", header: "Cost of sales", kind: "text", width: 16 },
      { key: "closing", header: "Closing stock", kind: "text", width: 16 },
      { key: "note", header: "Share or note", kind: "text", width: 18 },
    ],
    rows,
  };
}
