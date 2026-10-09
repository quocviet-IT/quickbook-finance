/**
 * Financial Ratios: fifteen ratios worked out from the statements, this period
 * beside the same period a year earlier. Pure: the service reads the ledger,
 * this turns balances into the workings, the ratios, the arrows and the export.
 *
 * Money is integer minor units of the base currency. A ratio is a plain
 * number (a margin is a fraction: 0.25 is 25%); `null` means there was nothing
 * to divide by, and the screen shows a dash.
 */
import { naturalBalance } from "./accounts";
import { buildBalanceSheet, buildProfitAndLoss, type LedgerBalance } from "./reports";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";

// --- The workings --------------------------------------------------------------

export interface RatioWorkings {
  cashMinor: number;
  receivablesMinor: number;
  inventoryMinor: number;
  currentAssetsMinor: number;
  totalAssetsMinor: number;
  currentLiabilitiesMinor: number;
  totalLiabilitiesMinor: number;
  accountsPayableMinor: number;
  /** Total equity including profit to date, as the Balance Sheet shows it. */
  equityMinor: number;
  incomeMinor: number;
  costOfGoodsSoldMinor: number;
  /** Operating expenses: the Profit and Loss's `expense` accounts. */
  runningCostsMinor: number;
  otherExpensesMinor: number;
  grossProfitMinor: number;
  operatingIncomeMinor: number;
  netIncomeMinor: number;
  interestMinor: number;
  /** From to To inclusive, at least 1. */
  days: number;
}

const INTEREST_NAME = /interest/i;

/** Days from `from` to `to` inclusive, at least 1. */
export function daysInPeriod(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 1;
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

/**
 * The figures behind the ratios.
 * - `balances`: the ledger cumulative to the To date (the Balance Sheet's input).
 * - `flow`: the ledger over From to To (the Profit and Loss's input).
 * - `inventoryAccountIds`: the company's inventory accounts.
 */
export function buildRatioWorkings(input: {
  balances: readonly LedgerBalance[];
  flow: readonly LedgerBalance[];
  inventoryAccountIds: ReadonlySet<string>;
  from: string;
  to: string;
}): RatioWorkings {
  const balances = [...input.balances];
  const sheet = buildBalanceSheet(balances);
  const pnl = buildProfitAndLoss([...input.flow]);

  const sumOf = (types: readonly string[]) =>
    balances
      .filter((r) => types.includes(r.accountType))
      .reduce((sum, r) => sum + naturalBalance(r.accountType, r.debitBase, r.creditBase), 0);

  const cash = sumOf(["bank"]);
  const receivables = sumOf(["accounts_receivable"]);
  const currentAssets = sumOf(["bank", "accounts_receivable", "current_asset"]);
  const accountsPayable = sumOf(["accounts_payable"]);
  const currentLiabilities = sumOf(["accounts_payable", "credit_card", "current_liability"]);
  const inventory = balances
    .filter((r) => input.inventoryAccountIds.has(r.accountId))
    .reduce((sum, r) => sum + naturalBalance(r.accountType, r.debitBase, r.creditBase), 0);

  const interest = [...pnl.operatingExpenses.lines, ...pnl.otherExpenses.lines]
    .filter((line) => INTEREST_NAME.test(line.name))
    .reduce((sum, line) => sum + line.amount, 0);

  return {
    cashMinor: cash,
    receivablesMinor: receivables,
    inventoryMinor: inventory,
    currentAssetsMinor: currentAssets,
    totalAssetsMinor: sheet.totalAssets,
    currentLiabilitiesMinor: currentLiabilities,
    totalLiabilitiesMinor: sheet.totalLiabilities,
    accountsPayableMinor: accountsPayable,
    equityMinor: sheet.totalEquity,
    incomeMinor: pnl.income.total,
    costOfGoodsSoldMinor: pnl.costOfGoodsSold.total,
    runningCostsMinor: pnl.operatingExpenses.total,
    otherExpensesMinor: pnl.otherExpenses.total,
    grossProfitMinor: pnl.grossProfit,
    operatingIncomeMinor: pnl.grossProfit - pnl.operatingExpenses.total,
    netIncomeMinor: pnl.netIncome,
    interestMinor: interest,
    days: daysInPeriod(input.from, input.to),
  };
}

// --- The year-earlier period -----------------------------------------------------

/** The same day one year earlier; Feb 29 becomes Feb 28 (the end is clamped to the month's end). */
export function shiftBackOneYear(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const year = y - 1;
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(m)}-${pad(Math.min(d, lastDay))}`;
}

export function yearEarlierRange(from: string, to: string): { from: string; to: string } {
  return { from: shiftBackOneYear(from), to: shiftBackOneYear(to) };
}

/** An earlier period with neither assets nor income has nothing to compare: its column is left blank. */
export function hasActivity(w: RatioWorkings): boolean {
  return w.totalAssetsMinor !== 0 || w.incomeMinor !== 0;
}

// --- The fifteen ratios ----------------------------------------------------------

export type RatioGroupId = "pay-bills" | "make-money" | "money-moves" | "borrowed";
export type RatioFormat = "ratio" | "money" | "percent" | "months" | "days";
export type RatioDirection = "higher" | "lower" | "neutral";

export const RATIO_GROUPS: ReadonlyArray<{ id: RatioGroupId; label: string }> = [
  { id: "pay-bills", label: "Can it pay its bills" },
  { id: "make-money", label: "Does it make money" },
  { id: "money-moves", label: "How fast money moves" },
  { id: "borrowed", label: "How much is borrowed" },
];

export interface RatioDefinition {
  id: string;
  group: RatioGroupId;
  name: string;
  /** One line under the name, in plain words. */
  meaning: string;
  format: RatioFormat;
  better: RatioDirection;
  compute: (w: RatioWorkings) => number | null;
}

const divide = (top: number, bottom: number): number | null => (bottom === 0 ? null : top / bottom);
const yearly = (w: RatioWorkings) => (w.netIncomeMinor * 365) / w.days;
const DAYS_PER_MONTH = 30.44;

export const RATIOS: readonly RatioDefinition[] = [
  {
    id: "current-ratio",
    group: "pay-bills",
    name: "Current ratio",
    meaning: "Current assets for each dollar of current liabilities.",
    format: "ratio",
    better: "higher",
    compute: (w) => divide(w.currentAssetsMinor, w.currentLiabilitiesMinor),
  },
  {
    id: "quick-ratio",
    group: "pay-bills",
    name: "Quick ratio",
    meaning: "Cash and receivables for each dollar of current liabilities.",
    format: "ratio",
    better: "higher",
    compute: (w) => divide(w.cashMinor + w.receivablesMinor, w.currentLiabilitiesMinor),
  },
  {
    id: "working-capital",
    group: "pay-bills",
    name: "Working capital",
    meaning: "What is left of current assets after current liabilities.",
    format: "money",
    better: "higher",
    compute: (w) => w.currentAssetsMinor - w.currentLiabilitiesMinor,
  },
  {
    id: "months-of-cash",
    group: "pay-bills",
    name: "Months of cash",
    meaning: "How long cash on hand covers the period's spending.",
    format: "months",
    better: "higher",
    compute: (w) => {
      const spend = w.costOfGoodsSoldMinor + w.runningCostsMinor + w.otherExpensesMinor;
      return divide(w.cashMinor, spend / (w.days / DAYS_PER_MONTH));
    },
  },
  {
    id: "gross-margin",
    group: "make-money",
    name: "Gross margin",
    meaning: "Share of income left after the cost of goods sold.",
    format: "percent",
    better: "higher",
    compute: (w) => divide(w.grossProfitMinor, w.incomeMinor),
  },
  {
    id: "operating-margin",
    group: "make-money",
    name: "Operating margin",
    meaning: "Share of income left after running costs.",
    format: "percent",
    better: "higher",
    compute: (w) => divide(w.operatingIncomeMinor, w.incomeMinor),
  },
  {
    id: "net-margin",
    group: "make-money",
    name: "Net margin",
    meaning: "Share of income that ends up as net income.",
    format: "percent",
    better: "higher",
    compute: (w) => divide(w.netIncomeMinor, w.incomeMinor),
  },
  {
    id: "return-on-assets",
    group: "make-money",
    name: "Return on assets, a year",
    meaning: "Net income for a year at this pace, for each dollar of assets.",
    format: "percent",
    better: "higher",
    compute: (w) => divide(yearly(w), w.totalAssetsMinor),
  },
  {
    id: "return-on-equity",
    group: "make-money",
    name: "Return on equity, a year",
    meaning: "Net income for a year at this pace, for each dollar of equity.",
    format: "percent",
    better: "higher",
    compute: (w) => (w.equityMinor <= 0 ? null : divide(yearly(w), w.equityMinor)),
  },
  {
    id: "days-to-get-paid",
    group: "money-moves",
    name: "Days to get paid",
    meaning: "How long customers take to pay, on average.",
    format: "days",
    better: "lower",
    compute: (w) => divide(w.receivablesMinor, w.incomeMinor / w.days),
  },
  {
    id: "days-to-pay-suppliers",
    group: "money-moves",
    name: "Days to pay suppliers",
    meaning: "How long the business takes to pay what it owes.",
    format: "days",
    better: "neutral",
    compute: (w) => divide(w.accountsPayableMinor, (w.costOfGoodsSoldMinor + w.runningCostsMinor) / w.days),
  },
  {
    id: "days-of-stock",
    group: "money-moves",
    name: "Days of stock",
    meaning: "How long the stock on hand would last at the cost of goods sold.",
    format: "days",
    better: "lower",
    compute: (w) => divide(w.inventoryMinor, w.costOfGoodsSoldMinor / w.days),
  },
  {
    id: "debt-to-equity",
    group: "borrowed",
    name: "Debt to equity",
    meaning: "Liabilities for each dollar of equity.",
    format: "ratio",
    better: "lower",
    compute: (w) => (w.equityMinor <= 0 ? null : divide(w.totalLiabilitiesMinor, w.equityMinor)),
  },
  {
    id: "debt-ratio",
    group: "borrowed",
    name: "Debt ratio",
    meaning: "Share of assets that is owed to others.",
    format: "percent",
    better: "lower",
    compute: (w) => divide(w.totalLiabilitiesMinor, w.totalAssetsMinor),
  },
  {
    id: "interest-cover",
    group: "borrowed",
    name: "Interest cover",
    meaning: "How many times operating income covers the interest.",
    format: "ratio",
    better: "higher",
    compute: (w) => divide(w.operatingIncomeMinor, w.interestMinor),
  },
];

/** Show a ratio the way its format says; a blank is a dash. */
export function formatRatio(format: RatioFormat, value: number | null, money: (minor: number) => string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  switch (format) {
    case "ratio":
      return value.toFixed(2);
    case "money":
      return money(Math.round(value));
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "months":
      return `${value.toFixed(1)} months`;
    case "days":
      return `${Math.round(value).toLocaleString("en-US")} days`;
  }
}

// --- The arrow --------------------------------------------------------------------

export type RatioArrow =
  | { kind: "steady" }
  | { kind: "moved"; up: boolean; verdict: "better" | "worse" | "longer" | "shorter" };

/** The smallest change that counts: the larger of 0.005 and 1% of the earlier value. */
export function arrowThreshold(previous: number): number {
  return Math.max(0.005, Math.abs(previous) * 0.01);
}

/**
 * How a ratio moved. Null when either side is blank. "Steady" when the change is
 * under the threshold; otherwise the direction, judged better or worse by the
 * ratio's own direction (a neutral ratio is only longer or shorter).
 */
export function ratioArrow(current: number | null, previous: number | null, better: RatioDirection): RatioArrow | null {
  if (current === null || previous === null) return null;
  const change = current - previous;
  if (Math.abs(change) < arrowThreshold(previous)) return { kind: "steady" };
  const up = change > 0;
  if (better === "neutral") return { kind: "moved", up, verdict: up ? "longer" : "shorter" };
  const good = better === "higher" ? up : !up;
  return { kind: "moved", up, verdict: good ? "better" : "worse" };
}

// --- The report -------------------------------------------------------------------

export interface RatioRow {
  id: string;
  group: RatioGroupId;
  name: string;
  meaning: string;
  format: RatioFormat;
  better: RatioDirection;
  current: number | null;
  /** Null for every row when the earlier column is blank. */
  earlier: number | null;
  arrow: RatioArrow | null;
}

export interface FinancialRatiosReport {
  from: string;
  to: string;
  earlierFrom: string;
  earlierTo: string;
  current: RatioWorkings;
  /** Null when the earlier period had neither assets nor income. */
  earlier: RatioWorkings | null;
  rows: RatioRow[];
}

export function buildFinancialRatios(input: {
  from: string;
  to: string;
  current: RatioWorkings;
  /** The year-earlier workings, as read; this decides itself whether they are blank. */
  earlier: RatioWorkings;
}): FinancialRatiosReport {
  const range = yearEarlierRange(input.from, input.to);
  const earlier = hasActivity(input.earlier) ? input.earlier : null;
  return {
    from: input.from,
    to: input.to,
    earlierFrom: range.from,
    earlierTo: range.to,
    current: input.current,
    earlier,
    rows: RATIOS.map((def) => {
      const current = def.compute(input.current);
      const before = earlier ? def.compute(earlier) : null;
      return {
        id: def.id,
        group: def.group,
        name: def.name,
        meaning: def.meaning,
        format: def.format,
        better: def.better,
        current,
        earlier: before,
        arrow: ratioArrow(current, before, def.better),
      };
    }),
  };
}

/** The words an arrow cell shows. */
export function arrowText(arrow: RatioArrow | null): string {
  if (arrow === null) return "";
  if (arrow.kind === "steady") return "steady";
  return `${arrow.up ? "▲" : "▼"} ${arrow.verdict}`;
}

// --- The workings table -------------------------------------------------------------

export interface WorkingsRow {
  label: string;
  kind: "money" | "days";
  /** Money in minor units, or a day count. */
  current: number;
  earlier: number | null;
}

export function workingsRows(current: RatioWorkings, earlier: RatioWorkings | null): WorkingsRow[] {
  const line = (label: string, key: keyof RatioWorkings, kind: "money" | "days" = "money"): WorkingsRow => ({
    label,
    kind,
    current: current[key],
    earlier: earlier ? earlier[key] : null,
  });
  return [
    line("Cash and bank", "cashMinor"),
    line("Receivables", "receivablesMinor"),
    line("Inventory", "inventoryMinor"),
    line("Current assets", "currentAssetsMinor"),
    line("Total assets", "totalAssetsMinor"),
    line("Current liabilities", "currentLiabilitiesMinor"),
    line("Total liabilities", "totalLiabilitiesMinor"),
    line("Accounts payable", "accountsPayableMinor"),
    line("Equity including profit to date", "equityMinor"),
    line("Income", "incomeMinor"),
    line("Cost of goods sold", "costOfGoodsSoldMinor"),
    line("Running costs", "runningCostsMinor"),
    line("Operating income", "operatingIncomeMinor"),
    line("Net income", "netIncomeMinor"),
    line("Interest", "interestMinor"),
    line("Days in the period", "days", "days"),
  ];
}

// --- Export ---------------------------------------------------------------------------

/**
 * One sheet: the ratios by group, then the figures behind them. Every cell is text
 * formatted as the screen shows it, because one column holds money, percentages and days.
 */
export function financialRatiosSheet(
  report: FinancialRatiosReport,
  ctx: { companyName: string; currencyCode: string; money: (minor: number) => string },
): ReportExportSheet {
  const rows: ReportExportSheet["rows"] = [];
  for (const group of RATIO_GROUPS) {
    for (const row of report.rows.filter((r) => r.group === group.id)) {
      rows.push({
        section: group.label,
        item: row.name,
        current: formatRatio(row.format, row.current, ctx.money),
        earlier: formatRatio(row.format, row.earlier, ctx.money),
        change: arrowText(row.arrow),
      });
    }
  }
  const shown = (kind: "money" | "days", value: number | null) =>
    value === null ? "" : kind === "money" ? ctx.money(value) : String(value);
  for (const w of workingsRows(report.current, report.earlier)) {
    rows.push({
      section: "The figures behind them",
      item: w.label,
      current: shown(w.kind, w.current),
      earlier: shown(w.kind, w.earlier),
      change: "",
    });
  }
  return {
    fileName: sanitizeExportFileName(`financial-ratios-${report.from}-to-${report.to}`),
    companyName: ctx.companyName,
    title: "Financial Ratios",
    subtitle: `${report.from} to ${report.to}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "section", header: "Group", kind: "text", width: 26 },
      { key: "item", header: "Ratio", kind: "text", width: 34 },
      { key: "current", header: "This period", kind: "text", width: 18 },
      { key: "earlier", header: "A year earlier", kind: "text", width: 18 },
      { key: "change", header: "Change", kind: "text", width: 16 },
    ],
    rows,
  };
}
