/**
 * Pure financial-report builders. Input is per-account debit/credit totals in
 * base-currency minor units (from acc_ledger_balances). All classification and
 * netting is derived from account type via the rules in ./accounts, so reports
 * cannot disagree with the chart of accounts.
 */
import { type AccountType, naturalBalance, statementSectionOf } from "./accounts";

export interface LedgerBalance {
  accountCode: string;
  name: string;
  accountType: AccountType;
  debitBase: number;
  creditBase: number;
}

// --- Trial Balance -----------------------------------------------------------
export interface TrialBalanceLine {
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
    lines.push({ accountCode: r.accountCode, name: r.name, debit, credit });
  }
  return { lines, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

// --- Profit & Loss -----------------------------------------------------------
export interface ReportSection {
  key: string;
  title: string;
  lines: { accountCode: string; name: string; amount: number }[];
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
  return rows
    .filter((r) => statementSectionOf(r.accountType) === "profit_and_loss")
    .reduce((s, r) => s + naturalBalance(r.accountType, r.debitBase, r.creditBase), 0);
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
    equity.lines.push({ accountCode: "", name: "Current earnings", amount: currentEarnings });
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
