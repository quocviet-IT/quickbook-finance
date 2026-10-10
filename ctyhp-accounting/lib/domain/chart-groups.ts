/**
 * The Chart of Accounts read with balances: the fourteen groups an account
 * falls under, the figure each account shows, and the range that figure covers.
 *
 * Pure: accounts and ledger rows in, groups and figures out. The old ten
 * `ACCOUNT_SECTIONS` stay for the new-company chart templates; this module is
 * what the `/accounts` page reads.
 */
import {
  accountNormalBalance,
  statementSectionOf,
  type AccountType,
  type NormalBalance,
} from "./accounts";
import { isBankSectionDetail } from "./account-detail";
import { fiscalYearForDate } from "./fiscal";
import { shortDate } from "./report-presets";
import type { ZoomSpec } from "./statement";

export type ChartGroupKey =
  | "bank_cash"
  | "receivables"
  | "inventory"
  | "other_current_assets"
  | "long_term_assets"
  | "credit_cards"
  | "payables"
  | "other_current_liabilities"
  | "long_term_liabilities"
  | "equity"
  | "income"
  | "cost_of_sales"
  | "expenses"
  | "other_expenses";

export type ChartClass = "asset" | "liability" | "equity" | "income" | "expense";
export type ChartStatement = "balance_sheet" | "profit_and_loss";

/** The groups in statement order. */
export const CHART_GROUPS: readonly {
  key: ChartGroupKey;
  title: string;
  chartClass: ChartClass;
  statement: ChartStatement;
}[] = [
  { key: "bank_cash", title: "Bank and cash", chartClass: "asset", statement: "balance_sheet" },
  { key: "receivables", title: "Receivables", chartClass: "asset", statement: "balance_sheet" },
  { key: "inventory", title: "Inventory", chartClass: "asset", statement: "balance_sheet" },
  { key: "other_current_assets", title: "Other current assets", chartClass: "asset", statement: "balance_sheet" },
  { key: "long_term_assets", title: "Long-term assets", chartClass: "asset", statement: "balance_sheet" },
  { key: "credit_cards", title: "Credit cards", chartClass: "liability", statement: "balance_sheet" },
  { key: "payables", title: "Payables", chartClass: "liability", statement: "balance_sheet" },
  { key: "other_current_liabilities", title: "Other current liabilities", chartClass: "liability", statement: "balance_sheet" },
  { key: "long_term_liabilities", title: "Long-term liabilities", chartClass: "liability", statement: "balance_sheet" },
  { key: "equity", title: "Equity", chartClass: "equity", statement: "balance_sheet" },
  { key: "income", title: "Income", chartClass: "income", statement: "profit_and_loss" },
  { key: "cost_of_sales", title: "Cost of sales", chartClass: "expense", statement: "profit_and_loss" },
  { key: "expenses", title: "Expenses", chartClass: "expense", statement: "profit_and_loss" },
  { key: "other_expenses", title: "Other expenses", chartClass: "expense", statement: "profit_and_loss" },
];

/**
 * The group an account is listed under. An inventory-set current asset is
 * Inventory even if its detail type reads as money in transit: Inventory wins,
 * and only when the account is in the inventory set.
 */
export function chartGroupOf(
  account: { id: string; account_type: AccountType; detail_type: string | null },
  inventoryAccountIds: ReadonlySet<string>,
): ChartGroupKey {
  switch (account.account_type) {
    case "bank":
      return "bank_cash";
    case "current_asset":
      if (inventoryAccountIds.has(account.id)) return "inventory";
      return isBankSectionDetail(account.detail_type) ? "bank_cash" : "other_current_assets";
    case "accounts_receivable":
      return "receivables";
    case "fixed_asset":
      return "long_term_assets";
    case "credit_card":
      return "credit_cards";
    case "accounts_payable":
      return "payables";
    case "current_liability":
      return "other_current_liabilities";
    case "long_term_liability":
      return "long_term_liabilities";
    case "equity":
      return "equity";
    case "income":
    case "other_income":
      return "income";
    case "cost_of_goods_sold":
      return "cost_of_sales";
    case "expense":
      return "expenses";
    case "other_expense":
      return "other_expenses";
  }
}

export function chartClassOf(type: AccountType): ChartClass {
  switch (type) {
    case "bank":
    case "accounts_receivable":
    case "current_asset":
    case "fixed_asset":
      return "asset";
    case "accounts_payable":
    case "credit_card":
    case "current_liability":
    case "long_term_liability":
      return "liability";
    case "equity":
      return "equity";
    case "income":
    case "other_income":
      return "income";
    case "cost_of_goods_sold":
    case "expense":
    case "other_expense":
      return "expense";
  }
}

export function statementOf(type: AccountType): ChartStatement {
  return statementSectionOf(type);
}

export const CHART_FILTERS: readonly { key: "all" | ChartClass; label: string }[] = [
  { key: "all", label: "All" },
  { key: "asset", label: "Assets" },
  { key: "liability", label: "Liabilities" },
  { key: "equity", label: "Equity" },
  { key: "income", label: "Income" },
  { key: "expense", label: "Expenses" },
];

export function filterCounts(
  accounts: readonly { account_type: AccountType }[],
): Record<"all" | ChartClass, number> {
  const counts: Record<"all" | ChartClass, number> = {
    all: accounts.length,
    asset: 0,
    liability: 0,
    equity: 0,
    income: 0,
    expense: 0,
  };
  for (const a of accounts) counts[chartClassOf(a.account_type)] += 1;
  return counts;
}

/** The first day of the fiscal year that contains `asOf`. */
export function fiscalYearStartFor(asOf: string, fiscalStartMonth: number): string {
  const year = fiscalYearForDate(asOf, fiscalStartMonth);
  return `${String(year).padStart(4, "0")}-${String(fiscalStartMonth).padStart(2, "0")}-01`;
}

/** Balance sheet accounts run from the start of the books; profit and loss from the fiscal year start. */
export function chartRange(
  statement: ChartStatement,
  asOf: string,
  fiscalStartMonth: number,
): { from: string | null; to: string } {
  return statement === "balance_sheet"
    ? { from: null, to: asOf }
    : { from: fiscalYearStartFor(asOf, fiscalStartMonth), to: asOf };
}

/** The balance on the account's own normal side; a negative figure is the wrong way round. */
export function naturalBalanceMinor(debitBase: number, creditBase: number, normal: NormalBalance): number {
  return normal === "debit" ? debitBase - creditBase : creditBase - debitBase;
}

interface LedgerSide {
  accountId: string;
  debitBase: number;
  creditBase: number;
}

/** Each account's figure, from the ledger that matches its statement; absent from it is 0. */
export function chartFigures(
  accounts: readonly { id: string; account_type: AccountType; is_contra: boolean }[],
  balanceSheetLedger: readonly LedgerSide[],
  profitAndLossLedger: readonly LedgerSide[],
): Record<string, number> {
  const index = (rows: readonly LedgerSide[]) => new Map(rows.map((r) => [r.accountId, r]));
  const sheet = index(balanceSheetLedger);
  const pnl = index(profitAndLossLedger);
  const figures: Record<string, number> = {};
  for (const a of accounts) {
    const row = (statementOf(a.account_type) === "balance_sheet" ? sheet : pnl).get(a.id);
    figures[a.id] = row
      ? naturalBalanceMinor(row.debitBase, row.creditBase, accountNormalBalance(a.account_type, a.is_contra))
      : 0;
  }
  return figures;
}

/** What clicking an account's figure opens. */
export function chartZoomSpec(
  account: { id: string; account_code: string; name: string },
  range: { from: string | null; to: string },
  figure: number,
): ZoomSpec {
  return {
    title: `${account.account_code} ${account.name}`,
    accountIds: [account.id],
    from: range.from,
    to: range.to,
    figure,
  };
}

/** "45 accounts, 28 carrying a balance at Oct 10, 2026." */
export function chartLede(total: number, withBalance: number, asOf: string): string {
  return `${total} ${total === 1 ? "account" : "accounts"}, ${withBalance} carrying a balance at ${shortDate(asOf)}.`;
}

/** "Year to date, from Jan 1, 2026" */
export function groupRangeLabel(fiscalYearStart: string): string {
  return `Year to date, from ${shortDate(fiscalYearStart)}`;
}
