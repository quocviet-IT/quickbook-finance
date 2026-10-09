import { dayBefore, fiscalYearForDate } from "./fiscal";
import { monthLabel } from "./purchases-inventory";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { shortDate } from "./report-presets";
import { tieOut, type TieOut } from "./tie-out";

/**
 * Sales Tax Liability: what was charged and what was paid over, period by
 * period, read from the ledger rather than from invoices.
 *
 * Pure calculation. The service reads the posted lines on the tax accounts and
 * on income accounts and hands them here. Amounts are base-currency minor
 * units. Lines are signed credit-positive, as the spec words it: a sale puts
 * income and tax on the credit side, a credit memo puts both on the debit side.
 */

export type Granularity = "monthly" | "quarterly" | "yearly";

export const GRANULARITIES: readonly { value: Granularity; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export const DEFAULT_GRANULARITY: Granularity = "quarterly";

// --- Which accounts are the tax accounts -----------------------------------

export interface TaxAccountCandidate {
  id: string;
  name: string;
  accountType: string;
}

export interface TaxCodeLink {
  direction: string;
  taxAccountId: string | null;
}

const LIABILITY_TYPES: ReadonlySet<string> = new Set(["current_liability", "long_term_liability"]);

/** Taxes that are not sales tax: a name carrying one of these words never reads as sales tax. */
const OTHER_TAX = /payroll|income|withholding|employ|federal|property|corporate|franchise|excise|vat/;

/** Whether a name, letters only, reads as sales tax: "salestax" or "tax…payable", and not another kind of tax. */
export function readsAsSalesTax(name: string): boolean {
  const letters = name.toLowerCase().replace(/[^a-z]/g, "");
  return (/salestax/.test(letters) || /tax.*payable/.test(letters)) && !OTHER_TAX.test(letters);
}

export type TaxAccountBasis = "codes" | "names" | "none";

export interface TaxAccounts {
  accountIds: string[];
  basis: TaxAccountBasis;
  /** Liability accounts that read as sales tax but no tax rate posts to; they are not in the figures. */
  unlinked: { id: string; name: string }[];
}

/**
 * The accounts the report reads. The ones sales-direction tax codes post to;
 * if the company has none, the liability accounts whose names read as sales
 * tax. With codes in use, any other liability account that reads as sales tax
 * is named in `unlinked`, because it holds what looks like sales tax the
 * report is not counting.
 */
export function resolveTaxAccounts(accounts: readonly TaxAccountCandidate[], codes: readonly TaxCodeLink[]): TaxAccounts {
  const known = new Set(accounts.map((a) => a.id));
  const sales = new Set(
    codes.filter((c) => c.direction === "sales" && c.taxAccountId && known.has(c.taxAccountId)).map((c) => c.taxAccountId as string),
  );
  const looksLikeIt = accounts.filter((a) => LIABILITY_TYPES.has(a.accountType) && readsAsSalesTax(a.name));
  if (sales.size === 0) {
    return { accountIds: looksLikeIt.map((a) => a.id), basis: looksLikeIt.length > 0 ? "names" : "none", unlinked: [] };
  }
  const linked = new Set(codes.map((c) => c.taxAccountId).filter((id): id is string => !!id));
  return {
    accountIds: [...sales],
    basis: "codes",
    unlinked: looksLikeIt.filter((a) => !linked.has(a.id)).map((a) => ({ id: a.id, name: a.name })),
  };
}

// --- Classifying the entries -------------------------------------------------

/** One posted line on a tax account or an income account. Credit-positive, base currency. */
export interface TaxLedgerLine {
  entryId: string;
  entryDate: string;
  kind: "tax" | "income";
  creditMinor: number;
}

/** What one day's entries added up to, by how each was classified. */
export interface TaxDay {
  date: string;
  taxableMinor: number;
  exemptMinor: number;
  collectedMinor: number;
  paidMinor: number;
  adjustmentMinor: number;
}

/**
 * Classify every entry and add the entries up by day.
 *
 * - Income and tax lines: the income is taxable, the tax is collected.
 * - Income and no tax line: the income is exempt.
 * - No income line: a net debit to the tax accounts is paid over, a net credit
 *   is an adjustment (it adds to what is owed).
 *
 * A credit memo has both on the debit side, so its amounts come out negative
 * and it takes away from taxable and collected.
 */
export function classifyEntries(lines: readonly TaxLedgerLine[]): TaxDay[] {
  const entries = new Map<string, { date: string; income: number; tax: number; hasIncome: boolean; hasTax: boolean }>();
  for (const l of lines) {
    const e = entries.get(l.entryId) ?? { date: l.entryDate, income: 0, tax: 0, hasIncome: false, hasTax: false };
    if (l.kind === "income") {
      e.income += l.creditMinor;
      e.hasIncome = true;
    } else {
      e.tax += l.creditMinor;
      e.hasTax = true;
    }
    entries.set(l.entryId, e);
  }
  const days = new Map<string, TaxDay>();
  for (const e of entries.values()) {
    const day = days.get(e.date) ?? { date: e.date, taxableMinor: 0, exemptMinor: 0, collectedMinor: 0, paidMinor: 0, adjustmentMinor: 0 };
    if (e.hasIncome && e.hasTax) {
      day.taxableMinor += e.income;
      day.collectedMinor += e.tax;
    } else if (e.hasIncome) {
      day.exemptMinor += e.income;
    } else if (e.tax < 0) {
      day.paidMinor += -e.tax;
    } else if (e.tax > 0) {
      day.adjustmentMinor += e.tax;
    }
    days.set(e.date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// --- Periods -----------------------------------------------------------------

export interface TaxPeriod {
  key: string;
  label: string;
  start: string;
  end: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const firstOf = (year: number, month: number) => iso(new Date(Date.UTC(year, month - 1, 1)));
const lastOf = (year: number, month: number) => iso(new Date(Date.UTC(year, month, 0)));
const dayAfter = (date: string) => {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
};

/** How a fiscal year is named: "2026" when the year starts in January, "FY2026" otherwise. */
export function fiscalYearLabel(fiscalYear: number, fiscalStartMonth: number): string {
  return fiscalStartMonth === 1 ? String(fiscalYear) : `FY${fiscalYear}`;
}

/** The calendar months, calendar quarters or fiscal years from `from` to `to`, the first and last clipped to the range. */
export function buildPeriods(from: string, to: string, granularity: Granularity, fiscalStartMonth: number): TaxPeriod[] {
  const periods: TaxPeriod[] = [];
  let cursor = from;
  while (cursor <= to) {
    const [year, month] = cursor.split("-").map(Number);
    let start: string;
    let end: string;
    let label: string;
    if (granularity === "monthly") {
      start = firstOf(year, month);
      end = lastOf(year, month);
      label = monthLabel(`${year}-${String(month).padStart(2, "0")}`);
    } else if (granularity === "quarterly") {
      const quarter = Math.floor((month - 1) / 3);
      start = firstOf(year, quarter * 3 + 1);
      end = lastOf(year, quarter * 3 + 3);
      label = `Q${quarter + 1} ${year}`;
    } else {
      const fiscalYear = fiscalYearForDate(cursor, fiscalStartMonth);
      start = firstOf(fiscalYear, fiscalStartMonth);
      end = dayBefore(firstOf(fiscalYear + 1, fiscalStartMonth));
      label = fiscalYearLabel(fiscalYear, fiscalStartMonth);
    }
    periods.push({ key: start, label, start: start < from ? from : start, end: end > to ? to : end });
    cursor = dayAfter(end);
  }
  return periods;
}

// --- The report --------------------------------------------------------------

/** What the service reads: everything the report is worked out from, before a period size is chosen. */
export interface SalesTaxLiabilityData {
  from: string;
  to: string;
  fiscalStartMonth: number;
  basis: TaxAccountBasis;
  /** Owed (credit less debit on the tax accounts) the day before `from`. */
  openingMinor: number;
  /** Owed on `to` according to the tax accounts' own ledger balance. */
  ledgerClosingMinor: number;
  days: TaxDay[];
  unlinked: { id: string; name: string }[];
}

export interface TaxPeriodRow {
  key: string;
  label: string;
  start: string;
  end: string;
  grossMinor: number;
  taxableMinor: number;
  exemptMinor: number;
  /** Collected ÷ taxable, the rate actually charged; null when nothing was taxable. */
  ratePercent: number | null;
  collectedMinor: number;
  paidMinor: number;
  adjustmentMinor: number;
  owedMinor: number;
}

export interface SalesTaxLiabilityReport {
  from: string;
  to: string;
  granularity: Granularity;
  basis: TaxAccountBasis;
  /** Shown as the first row when it is not zero. */
  openingMinor: number;
  periods: TaxPeriodRow[];
  total: Omit<TaxPeriodRow, "key" | "label" | "start" | "end" | "ratePercent" | "owedMinor"> & { owedMinor: number };
  collectedMinor: number;
  paidMinor: number;
  owedAtEndMinor: number;
  /** Collected ÷ taxable over the whole range. */
  effectiveRatePercent: number | null;
  /** The closing figure against the tax accounts' own balance. */
  proof: TieOut;
  unlinked: { id: string; name: string }[];
}

function rateOf(collectedMinor: number, taxableMinor: number): number | null {
  return taxableMinor === 0 ? null : (collectedMinor / taxableMinor) * 100;
}

/** The report for one period size, from what the service read. */
export function buildSalesTaxLiability(data: SalesTaxLiabilityData, granularity: Granularity): SalesTaxLiabilityReport {
  const periods = buildPeriods(data.from, data.to, granularity, data.fiscalStartMonth);
  const days = [...data.days].filter((d) => d.date >= data.from && d.date <= data.to).sort((a, b) => a.date.localeCompare(b.date));
  let owed = data.openingMinor;
  let next = 0;
  const rows: TaxPeriodRow[] = periods.map((p) => {
    const row: TaxPeriodRow = {
      ...p,
      grossMinor: 0,
      taxableMinor: 0,
      exemptMinor: 0,
      ratePercent: null,
      collectedMinor: 0,
      paidMinor: 0,
      adjustmentMinor: 0,
      owedMinor: 0,
    };
    while (next < days.length && days[next].date <= p.end) {
      const d = days[next++];
      row.taxableMinor += d.taxableMinor;
      row.exemptMinor += d.exemptMinor;
      row.collectedMinor += d.collectedMinor;
      row.paidMinor += d.paidMinor;
      row.adjustmentMinor += d.adjustmentMinor;
    }
    row.grossMinor = row.taxableMinor + row.exemptMinor;
    row.ratePercent = rateOf(row.collectedMinor, row.taxableMinor);
    owed += row.collectedMinor - row.paidMinor + row.adjustmentMinor;
    row.owedMinor = owed;
    return row;
  });

  const sum = (pick: (r: TaxPeriodRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const taxableMinor = sum((r) => r.taxableMinor);
  const exemptMinor = sum((r) => r.exemptMinor);
  const collectedMinor = sum((r) => r.collectedMinor);
  const paidMinor = sum((r) => r.paidMinor);
  return {
    from: data.from,
    to: data.to,
    granularity,
    basis: data.basis,
    openingMinor: data.openingMinor,
    periods: rows,
    total: {
      grossMinor: taxableMinor + exemptMinor,
      taxableMinor,
      exemptMinor,
      collectedMinor,
      paidMinor,
      adjustmentMinor: sum((r) => r.adjustmentMinor),
      owedMinor: owed,
    },
    collectedMinor,
    paidMinor,
    owedAtEndMinor: owed,
    effectiveRatePercent: rateOf(collectedMinor, taxableMinor),
    proof: tieOut(owed, data.ledgerClosingMinor),
    unlinked: data.unlinked,
  };
}

// --- Words -------------------------------------------------------------------

export const OPENING_ROW_LABEL = "Owed before this range";
export const NO_TAX_ACCOUNT_TITLE = "No sales tax account in this chart.";
export const NO_TAX_ACCOUNT_HINT = "Set up a sales tax rate under Sales Tax, and what you charge lands here.";
export const NOTHING_OUTSTANDING = "Nothing outstanding.";
export const LIABILITY_REPORT_LINK_LABEL = "Sales Tax Liability by period";

export const SALES_TAX_FOOTNOTE_TITLE = "Read from the entries, not from a rate table.";
export const SALES_TAX_FOOTNOTE =
  "A sale is taxable when its entry carries a line to the tax account. The Exempt column is where a missing tax line would show. The rate shown is the rate actually charged.";

export function owedAtLabel(report: Pick<SalesTaxLiabilityReport, "to">): string {
  return `Owed at ${shortDate(report.to)}`;
}

export function paymentButtonLabel(amountText: string): string {
  return `Record a payment of ${amountText}`;
}

export function unlinkedWarning(unlinked: readonly { name: string }[]): string | null {
  if (unlinked.length === 0) return null;
  const names = unlinked.map((a) => `“${a.name}”`).join(", ");
  return `${names} ${unlinked.length === 1 ? "reads" : "read"} as sales tax, but no tax rate posts to ${unlinked.length === 1 ? "it" : "them"}, so ${unlinked.length === 1 ? "it is" : "they are"} not in these figures.`;
}

export function formatRate(ratePercent: number | null): string {
  return ratePercent === null ? "—" : `${ratePercent.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** The report as one flat export: the opening row, a row for each period, then the total. */
export function salesTaxLiabilitySheet(
  report: SalesTaxLiabilityReport,
  ctx: { companyName: string; currencyCode: string; money: (minor: number) => string },
): ReportExportSheet {
  const money = ctx.money;
  const rows: ReportExportSheet["rows"] = [];
  const blank = { gross: "", taxable: "", exempt: "", rate: "", collected: "", paid: "", adjustment: "" };
  if (report.openingMinor !== 0) rows.push({ period: OPENING_ROW_LABEL, ...blank, owed: money(report.openingMinor) });
  for (const p of report.periods) {
    rows.push({
      period: p.label,
      gross: money(p.grossMinor),
      taxable: money(p.taxableMinor),
      exempt: money(p.exemptMinor),
      rate: p.ratePercent === null ? "" : formatRate(p.ratePercent),
      collected: money(p.collectedMinor),
      paid: money(p.paidMinor),
      adjustment: money(p.adjustmentMinor),
      owed: money(p.owedMinor),
    });
  }
  rows.push({
    period: "Total",
    gross: money(report.total.grossMinor),
    taxable: money(report.total.taxableMinor),
    exempt: money(report.total.exemptMinor),
    rate: "",
    collected: money(report.total.collectedMinor),
    paid: money(report.total.paidMinor),
    adjustment: money(report.total.adjustmentMinor),
    owed: money(report.total.owedMinor),
  });
  return {
    fileName: sanitizeExportFileName(`sales-tax-liability-${report.from}-to-${report.to}`),
    companyName: ctx.companyName,
    title: "Sales Tax Liability",
    subtitle: `${report.from} to ${report.to}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "period", header: "Period", kind: "text", width: 24 },
      { key: "gross", header: "Gross sales", kind: "text", width: 16 },
      { key: "taxable", header: "Taxable", kind: "text", width: 16 },
      { key: "exempt", header: "Exempt", kind: "text", width: 16 },
      { key: "rate", header: "Rate", kind: "text", width: 10 },
      { key: "collected", header: "Tax collected", kind: "text", width: 16 },
      { key: "paid", header: "Paid over", kind: "text", width: 16 },
      { key: "adjustment", header: "Adjustments", kind: "text", width: 16 },
      { key: "owed", header: "Owed at period end", kind: "text", width: 18 },
    ],
    rows,
  };
}
