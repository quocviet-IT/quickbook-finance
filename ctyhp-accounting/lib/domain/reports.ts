/**
 * Pure financial-report builders. Input is per-account debit/credit totals in
 * base-currency minor units (from acc_ledger_balances). All classification and
 * netting is derived from account type via the rules in ./accounts, so reports
 * cannot disagree with the chart of accounts.
 */
import { type AccountType, type NormalBalance, naturalBalance, statementSectionOf } from "./accounts";

export interface LedgerBalance {
  accountId: string;
  accountCode: string;
  name: string;
  accountType: AccountType;
  debitBase: number;
  creditBase: number;
}

// --- Trial Balance -----------------------------------------------------------
export interface TrialBalanceLine {
  accountId: string;
  accountCode: string;
  name: string;
  debit: number; // minor units, one side only
  credit: number;
}
export interface TrialBalance {
  lines: TrialBalanceLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export function buildTrialBalance(rows: LedgerBalance[]): TrialBalance {
  const lines: TrialBalanceLine[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const r of rows) {
    const net = r.debitBase - r.creditBase;
    if (net === 0) continue; // omit zero-balance accounts
    const debit = net > 0 ? net : 0;
    const credit = net < 0 ? -net : 0;
    totalDebit += debit;
    totalCredit += credit;
    lines.push({ accountId: r.accountId, accountCode: r.accountCode, name: r.name, debit, credit });
  }
  return { lines, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

// --- Profit & Loss -----------------------------------------------------------
export interface ReportSection {
  key: string;
  title: string;
  lines: { accountId: string | null; accountCode: string; name: string; amount: number }[];
  total: number;
}
export interface ProfitAndLoss {
  income: ReportSection;
  costOfGoodsSold: ReportSection;
  grossProfit: number;
  operatingExpenses: ReportSection;
  otherIncome: ReportSection;
  otherExpenses: ReportSection;
  netIncome: number;
}

function section(
  key: string,
  title: string,
  rows: LedgerBalance[],
  types: AccountType[],
): ReportSection {
  const set = new Set(types);
  const lines = rows
    .filter((r) => set.has(r.accountType))
    .map((r) => ({
      accountId: r.accountId,
      accountCode: r.accountCode,
      name: r.name,
      amount: naturalBalance(r.accountType, r.debitBase, r.creditBase),
    }))
    .filter((l) => l.amount !== 0);
  return { key, title, lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

export function buildProfitAndLoss(rows: LedgerBalance[]): ProfitAndLoss {
  const income = section("income", "Income", rows, ["income"]);
  const costOfGoodsSold = section("cogs", "Cost of Goods Sold", rows, ["cost_of_goods_sold"]);
  const operatingExpenses = section("opex", "Operating Expenses", rows, ["expense"]);
  const otherIncome = section("other_income", "Other Income", rows, ["other_income"]);
  const otherExpenses = section("other_expense", "Other Expenses", rows, ["other_expense"]);
  const grossProfit = income.total - costOfGoodsSold.total;
  const netIncome =
    grossProfit - operatingExpenses.total + otherIncome.total - otherExpenses.total;
  return { income, costOfGoodsSold, grossProfit, operatingExpenses, otherIncome, otherExpenses, netIncome };
}

/** Net income for a set of balances (used as retained/current earnings). */
export function netIncomeOf(rows: LedgerBalance[]): number {
  return buildProfitAndLoss(rows).netIncome;
}

// --- Balance Sheet -----------------------------------------------------------
export interface BalanceSheet {
  assets: ReportSection;
  liabilities: ReportSection;
  equity: ReportSection; // includes a synthetic "Current earnings" line
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  balanced: boolean;
}

export function buildBalanceSheet(rows: LedgerBalance[]): BalanceSheet {
  const assets = section("assets", "Assets", rows, [
    "bank",
    "accounts_receivable",
    "current_asset",
    "fixed_asset",
  ]);
  const liabilities = section("liabilities", "Liabilities", rows, [
    "accounts_payable",
    "credit_card",
    "current_liability",
  ]);
  const equity = section("equity", "Equity", rows, ["equity"]);

  // Current earnings (net income to date) is not booked to an equity account
  // until period close, so surface it explicitly to make the sheet balance.
  const currentEarnings = netIncomeOf(rows);
  if (currentEarnings !== 0) {
    equity.lines.push({ accountId: null, accountCode: "", name: "Current earnings", amount: currentEarnings });
    equity.total += currentEarnings;
  }

  return {
    assets,
    liabilities,
    equity,
    totalAssets: assets.total,
    totalLiabilities: liabilities.total,
    totalEquity: equity.total,
    balanced: assets.total === liabilities.total + equity.total,
  };
}

// --- Comparisons -------------------------------------------------------------

export interface DateRange {
  from: string;
  to: string;
}

/** Last day of the month a date falls in, as a UTC date. */
function monthEnd(year: number, month: number): Date {
  // Day 0 of the next month is the last day of this one, which is also how
  // February gets its leap day without anybody writing the rule down.
  return new Date(Date.UTC(year, month + 1, 0));
}

/** True when a range covers whole calendar months, first day to last day. */
function coversWholeMonths(start: Date, end: Date): boolean {
  return (
    start.getUTCDate() === 1 &&
    end.getUTCDate() === monthEnd(end.getUTCFullYear(), end.getUTCMonth()).getUTCDate()
  );
}

/**
 * The period a report should be compared against.
 *
 * A whole month, quarter or year is compared with the same period before it —
 * the quarter before, the year before — because that is what the comparison
 * means to the person reading it, and because it is the only answer that lands
 * on the calendar boundaries the books are kept on.
 *
 * This used to count days and step back that many, which sounds equivalent and
 * is not. Months and years are not all the same length, so the count landed a
 * day or two inside the period before the one intended: comparing 2024 reached
 * back to 2022-12-31, because 2024 has 366 days and 2023 has 365, folding a day
 * of 2022 into a column labelled as the prior year. Comparing 2025 started the
 * prior column on 2 January, so anything posted on New Year's Day 2024 was
 * missing from it and nothing said so.
 *
 * A range that is not whole months — someone picked two dates by hand — has no
 * calendar period to step back through, so the day count remains the only rule
 * available and is kept for exactly that case.
 */
export function previousPeriodRange(from: string, to: string): DateRange {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (end.getTime() < start.getTime()) {
    throw new Error("Report end date must not be before its start date");
  }

  if (coversWholeMonths(start, end)) {
    const months =
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth()) +
      1;
    const priorStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - months, 1));
    const priorEnd = monthEnd(
      priorStart.getUTCFullYear(),
      priorStart.getUTCMonth() + months - 1,
    );
    return {
      from: priorStart.toISOString().slice(0, 10),
      to: priorEnd.toISOString().slice(0, 10),
    };
  }

  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const priorEnd = new Date(start);
  priorEnd.setUTCDate(priorEnd.getUTCDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setUTCDate(priorStart.getUTCDate() - days + 1);
  return {
    from: priorStart.toISOString().slice(0, 10),
    to: priorEnd.toISOString().slice(0, 10),
  };
}

/** Last day of the calendar month immediately before an as-of date. */
export function previousMonthEnd(asOf: string): string {
  const [year, month] = asOf.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
}

export interface ComparativeLine {
  accountId: string | null;
  accountCode: string;
  name: string;
  current: number;
  prior: number;
  variance: number;
  variancePercent: number | null;
}

export function compareReportLines(
  current: ReportSection["lines"],
  prior: ReportSection["lines"],
): ComparativeLine[] {
  const keys = new Set([
    ...current.map((line) => line.accountId ?? `${line.accountCode}:${line.name}`),
    ...prior.map((line) => line.accountId ?? `${line.accountCode}:${line.name}`),
  ]);
  const find = (rows: ReportSection["lines"], key: string) =>
    rows.find((line) => (line.accountId ?? `${line.accountCode}:${line.name}`) === key);
  return [...keys]
    .map((key) => {
      const currentLine = find(current, key);
      const priorLine = find(prior, key);
      const currentAmount = currentLine?.amount ?? 0;
      const priorAmount = priorLine?.amount ?? 0;
      return {
        accountId: currentLine?.accountId ?? priorLine?.accountId ?? null,
        accountCode: currentLine?.accountCode ?? priorLine?.accountCode ?? "",
        name: currentLine?.name ?? priorLine?.name ?? "",
        current: currentAmount,
        prior: priorAmount,
        variance: currentAmount - priorAmount,
        variancePercent:
          priorAmount === 0 ? null : ((currentAmount - priorAmount) / Math.abs(priorAmount)) * 100,
      };
    })
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

// --- Budget vs Actual --------------------------------------------------------

export interface BudgetAccountAmount {
  accountId: string;
  accountCode: string;
  name: string;
  accountType: AccountType;
  amountMinor: number;
}

export interface BudgetVarianceLine extends ComparativeLine {
  accountType: AccountType;
  favorable: boolean | null;
}

export interface BudgetVsActual {
  lines: BudgetVarianceLine[];
  actual: ProfitAndLoss;
  budget: ProfitAndLoss;
}

export function buildBudgetVsActual(
  actualRows: LedgerBalance[],
  budgetAmounts: BudgetAccountAmount[],
): BudgetVsActual {
  const budgetRows: LedgerBalance[] = budgetAmounts.map((row) => {
    const creditNormal = row.accountType === "income" || row.accountType === "other_income";
    return {
      accountId: row.accountId,
      accountCode: row.accountCode,
      name: row.name,
      accountType: row.accountType,
      debitBase: creditNormal ? 0 : row.amountMinor,
      creditBase: creditNormal ? row.amountMinor : 0,
    };
  });
  const actual = buildProfitAndLoss(actualRows);
  const budget = buildProfitAndLoss(budgetRows);
  const actualById = new Map(
    [
      ...actual.income.lines,
      ...actual.costOfGoodsSold.lines,
      ...actual.operatingExpenses.lines,
      ...actual.otherIncome.lines,
      ...actual.otherExpenses.lines,
    ].filter((line) => line.accountId).map((line) => [line.accountId as string, line.amount]),
  );
  const budgetById = new Map(budgetAmounts.map((row) => [row.accountId, row.amountMinor]));
  const accountById = new Map(
    [...actualRows, ...budgetAmounts].map((row) => [row.accountId, row]),
  );
  const lines = [...accountById.values()]
    .filter((row) => statementSectionOf(row.accountType) === "profit_and_loss")
    .map((row) => {
      const actualAmount = actualById.get(row.accountId) ?? 0;
      const budgetAmount = budgetById.get(row.accountId) ?? 0;
      const variance = actualAmount - budgetAmount;
      const isIncome = row.accountType === "income" || row.accountType === "other_income";
      return {
        accountId: row.accountId,
        accountCode: row.accountCode,
        name: row.name,
        accountType: row.accountType,
        current: actualAmount,
        prior: budgetAmount,
        variance,
        variancePercent:
          budgetAmount === 0 ? null : (variance / Math.abs(budgetAmount)) * 100,
        favorable: variance === 0 ? null : isIncome ? variance > 0 : variance < 0,
      };
    })
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  return { lines, actual, budget };
}

// --- Statement of Equity ----------------------------------------------------

export interface EquityStatementLine {
  key: string;
  accountId: string | null;
  label: string;
  amount: number;
  kind: "opening" | "activity" | "income" | "closing";
}

export interface StatementOfEquity {
  openingEquity: number;
  equityActivity: number;
  netIncome: number;
  closingEquity: number;
  lines: EquityStatementLine[];
}

export function buildStatementOfEquity(
  openingRows: LedgerBalance[],
  periodRows: LedgerBalance[],
): StatementOfEquity {
  const openingAccounts = section("opening_equity", "Opening equity accounts", openingRows, ["equity"]);
  const openingEarnings = netIncomeOf(openingRows);
  const openingEquity = openingAccounts.total + openingEarnings;
  const activity = section("equity_activity", "Equity account activity", periodRows, ["equity"]);
  const netIncome = netIncomeOf(periodRows);
  const equityActivity = activity.total;
  const closingEquity = openingEquity + equityActivity + netIncome;
  return {
    openingEquity,
    equityActivity,
    netIncome,
    closingEquity,
    lines: [
      {
        key: "opening",
        accountId: null,
        label: "Beginning equity",
        amount: openingEquity,
        kind: "opening",
      },
      ...activity.lines.map((line) => ({
        key: `activity:${line.accountId ?? line.accountCode}`,
        accountId: line.accountId,
        label: `${line.accountCode ? `${line.accountCode} — ` : ""}${line.name}`,
        amount: line.amount,
        kind: "activity" as const,
      })),
      {
        key: "net-income",
        accountId: null,
        label: "Net income",
        amount: netIncome,
        kind: "income",
      },
      {
        key: "closing",
        accountId: null,
        label: "Ending equity",
        amount: closingEquity,
        kind: "closing",
      },
    ],
  };
}

// --- Running Balance ---------------------------------------------------------
export interface LedgerActivityRow {
  debitMinor: number;
  creditMinor: number;
}
export type RunningRow = LedgerActivityRow & { runningMinor: number };

/**
 * Running balance for a General Ledger account. `normal` decides which side
 * increases the balance: debit-normal adds debits, credit-normal adds credits.
 */
export function computeRunningBalance(
  openingMinor: number,
  rows: LedgerActivityRow[],
  normal: NormalBalance,
): RunningRow[] {
  let running = openingMinor;
  return rows.map((r) => {
    const delta = normal === "debit" ? r.debitMinor - r.creditMinor : r.creditMinor - r.debitMinor;
    running += delta;
    return { ...r, runningMinor: running };
  });
}

// --- Multi-period balance sheet ---------------------------------------------

export interface BalanceTrendRow {
  key: string;
  label: string;
  kind: "section" | "line" | "total";
  /** One amount per period, in the order the periods were given. */
  amounts: number[];
}

function trendSection(
  key: string,
  sections: ReportSection[],
  totals: number[],
  totalLabel: string,
): BalanceTrendRow[] {
  const order: string[] = [];
  const byLabel = new Map<string, number[]>();

  sections.forEach((section, index) => {
    for (const line of section.lines) {
      const label = `${line.accountCode} — ${line.name}`;
      if (!byLabel.has(label)) {
        // An account that appears only in a later period reads as zero in the
        // earlier ones, which is what it was.
        byLabel.set(label, new Array(sections.length).fill(0));
        order.push(label);
      }
      byLabel.get(label)![index] = line.amount;
    }
  });

  return [
    { key, label: sections[0]?.title ?? key, kind: "section", amounts: [] },
    ...order.map((label) => ({
      key: `${key}-${label}`,
      label,
      kind: "line" as const,
      amounts: byLabel.get(label)!,
    })),
    { key: `${key}-total`, label: totalLabel, kind: "total" as const, amounts: totals },
  ];
}

/**
 * Accounts down the side, one column per period across the top.
 *
 * An account is listed if it carried a balance in *any* period shown: a
 * receivable that cleared in March still has to appear, or the reader sees a
 * column of numbers with no line for the money that used to be there.
 */
export function balanceTrendRows(sheets: readonly BalanceSheet[]): BalanceTrendRow[] {
  if (sheets.length === 0) return [];
  return [
    ...trendSection(
      "assets",
      sheets.map((sheet) => sheet.assets),
      sheets.map((sheet) => sheet.totalAssets),
      "Total Assets",
    ),
    ...trendSection(
      "liabilities",
      sheets.map((sheet) => sheet.liabilities),
      sheets.map((sheet) => sheet.totalLiabilities),
      "Total Liabilities",
    ),
    ...trendSection(
      "equity",
      sheets.map((sheet) => sheet.equity),
      sheets.map((sheet) => sheet.totalEquity),
      "Total Equity",
    ),
    {
      key: "liabilities-equity",
      label: "Total Liabilities + Equity",
      kind: "total",
      amounts: sheets.map((sheet) => sheet.totalLiabilities + sheet.totalEquity),
    },
  ];
}

// --- Multi-period profit and loss --------------------------------------------

/** The trend-row shape is not balance-sheet-specific — reused as-is for P&L. */
export type PnlTrendRow = BalanceTrendRow;

/**
 * Accounts down the side, one column per period across the top — the profit
 * and loss counterpart to `balanceTrendRows`. Gross Profit and Net Income get
 * their own rows because those are the two figures a reader scans a column
 * for first, the same way the single-period P&L view surfaces them as totals
 * rather than making the reader add up sections by hand.
 */
export function pnlTrendRows(pnls: readonly ProfitAndLoss[]): PnlTrendRow[] {
  if (pnls.length === 0) return [];
  return [
    ...trendSection("income", pnls.map((p) => p.income), pnls.map((p) => p.income.total), "Total Income"),
    ...trendSection(
      "cogs",
      pnls.map((p) => p.costOfGoodsSold),
      pnls.map((p) => p.costOfGoodsSold.total),
      "Total Cost of Goods Sold",
    ),
    {
      key: "gross-profit",
      label: "Gross Profit",
      kind: "total",
      amounts: pnls.map((p) => p.grossProfit),
    },
    ...trendSection(
      "opex",
      pnls.map((p) => p.operatingExpenses),
      pnls.map((p) => p.operatingExpenses.total),
      "Total Operating Expenses",
    ),
    ...trendSection(
      "other_income",
      pnls.map((p) => p.otherIncome),
      pnls.map((p) => p.otherIncome.total),
      "Total Other Income",
    ),
    ...trendSection(
      "other_expense",
      pnls.map((p) => p.otherExpenses),
      pnls.map((p) => p.otherExpenses.total),
      "Total Other Expenses",
    ),
    {
      key: "net-income",
      label: "Net Income",
      kind: "total",
      amounts: pnls.map((p) => p.netIncome),
    },
  ];
}

/**
 * Adds several profit and loss statements together, account by account.
 *
 * This is what a "Total" column means next to a period trend. A P&L account
 * only ever holds the activity posted within the date range it was queried
 * for and carries no opening balance, so the total for the whole range is
 * exactly the sum of the period figures — unlike a balance sheet, where
 * summing snapshots would double-count everything each later one already
 * includes, which is why `balanceTrendRows` has no Total column at all.
 */
export function sumProfitAndLoss(pnls: readonly ProfitAndLoss[]): ProfitAndLoss {
  const sumSection = (key: string, title: string, sections: readonly ReportSection[]): ReportSection => {
    const order: string[] = [];
    const byKey = new Map<string, ReportSection["lines"][number]>();
    for (const section of sections) {
      for (const line of section.lines) {
        const lineKey = line.accountId ?? `${line.accountCode}:${line.name}`;
        const existing = byKey.get(lineKey);
        if (existing) {
          existing.amount += line.amount;
        } else {
          byKey.set(lineKey, { ...line });
          order.push(lineKey);
        }
      }
    }
    const lines = order.map((lineKey) => byKey.get(lineKey)!);
    return { key, title, lines, total: lines.reduce((sum, l) => sum + l.amount, 0) };
  };

  const income = sumSection("income", "Income", pnls.map((p) => p.income));
  const costOfGoodsSold = sumSection("cogs", "Cost of Goods Sold", pnls.map((p) => p.costOfGoodsSold));
  const operatingExpenses = sumSection("opex", "Operating Expenses", pnls.map((p) => p.operatingExpenses));
  const otherIncome = sumSection("other_income", "Other Income", pnls.map((p) => p.otherIncome));
  const otherExpenses = sumSection("other_expense", "Other Expenses", pnls.map((p) => p.otherExpenses));
  const grossProfit = income.total - costOfGoodsSold.total;
  const netIncome = grossProfit - operatingExpenses.total + otherIncome.total - otherExpenses.total;
  return { income, costOfGoodsSold, grossProfit, operatingExpenses, otherIncome, otherExpenses, netIncome };
}

/**
 * A figure as a percentage of a column's total income — QuickBooks' "% of
 * Income". Display-only: nothing here is ever stored, and the two arguments
 * are plain minor-unit integers so the ratio is exact regardless of currency
 * decimals.
 *
 * `null`, not `Infinity` or `NaN`, when income is zero: a column with no
 * income has no scale to measure anything against, and a percentage nobody
 * can act on is worse than an admission that there isn't one. A negative
 * income figure (a period where refunds or write-offs outran sales) is not
 * special-cased — the division is still well-defined and the sign is simply
 * part of what happened that period.
 */
export function percentOfIncome(amountMinor: number, incomeMinor: number): number | null {
  if (incomeMinor === 0) return null;
  return (amountMinor / incomeMinor) * 100;
}

/**
 * One sentence, shared by every screen that heads a column "% of Income", so
 * the explanation cannot drift out of sync between them. QuickBooks' Total
 * Income excludes Other Income, and this matches that, but a header reading
 * only "% of Income" does not say so on its own — this is what the tooltip
 * says instead.
 */
export const PERCENT_OF_INCOME_TOOLTIP =
  "Percentage of Total Income for this column — Other Income is not included.";
