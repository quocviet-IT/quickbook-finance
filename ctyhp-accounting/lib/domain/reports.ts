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

/** Immediately preceding range with the same inclusive number of calendar days. */
export function previousPeriodRange(from: string, to: string): DateRange {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days <= 0) throw new Error("Report end date must not be before its start date");
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
