import type { SupabaseClient } from "@supabase/supabase-js";
import type { BudgetMonthSaveInput } from "@/lib/domain/schemas";
import { budgetMonthSaveSchema } from "@/lib/domain/schemas";
import {
  buildBudgetVsActual,
  type BudgetAccountAmount,
  type BudgetVsActual,
} from "@/lib/domain/reports";
import {
  buildMonthByMonth,
  groupBudgetByMonth,
  monthLabelOf,
  type BudgetLineRow,
  monthlyActualsByAccount,
  monthStartsBetween,
  type BudgetGridValues,
  type GridAccount,
  type MonthResult,
} from "@/lib/domain/budget-grid";
import { fiscalMonths } from "@/lib/domain/fiscal";
import { readAllPages } from "@/lib/services/paging";
import { getLedgerBalances, getMonthlyLedgerBalances } from "@/lib/services/reports";

export class BudgetError extends Error {}

export async function getBudgetAccountAmounts(
  sb: SupabaseClient,
  fiscalYear: number,
  from: string,
  to: string,
): Promise<BudgetAccountAmount[]> {
  const { data, error } = await sb.rpc("acc_budget_lines", {
    p_fiscal_year: fiscalYear,
    p_from: from,
    p_to: to,
  });
  if (error) throw new BudgetError(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    accountId: row.account_id as string,
    accountCode: row.account_code as string,
    name: row.name as string,
    accountType: row.account_type as BudgetAccountAmount["accountType"],
    amountMinor: Number(row.amount_minor ?? 0),
  }));
}

export async function saveBudgetMonth(
  sb: SupabaseClient,
  input: BudgetMonthSaveInput,
): Promise<string> {
  const parsed = budgetMonthSaveSchema.parse(input);
  const { data, error } = await sb.rpc("acc_save_budget_month", {
    p_fiscal_year: parsed.fiscal_year,
    p_period_start: parsed.period_start,
    p_lines: parsed.lines,
  });
  if (error) throw new BudgetError(error.message);
  return String(data);
}

const PL_TYPES = ["income", "cost_of_goods_sold", "expense", "other_income", "other_expense"];

/**
 * The requested months' budget for a fiscal year, from the tables directly:
 * the budget's id and the accounts together, then its lines, paged in a total
 * order. That is three requests however many months are asked for (one more
 * per further 1,000 rows). A month outside the fiscal year, or with no
 * budget, is all zeros.
 */
export async function getBudgetByMonth(
  sb: SupabaseClient,
  fiscalYear: number,
  starts: readonly string[],
): Promise<{ byMonth: Map<string, BudgetAccountAmount[]>; accounts: GridAccount[] }> {
  const fail = (message: string) => new BudgetError(message);
  const [header, accountRows] = await Promise.all([
    sb.from("acc_budget").select("id").eq("fiscal_year", fiscalYear).maybeSingle(),
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_account")
          .select("id,account_code,name,account_type")
          .eq("is_posting_account", true)
          .in("account_type", PL_TYPES)
          .order("account_code")
          .order("id")
          .range(from, to),
      fail,
    ),
  ]);
  if (header.error) throw new BudgetError(header.error.message);
  const accounts: GridAccount[] = accountRows.map((row) => ({
    accountId: row.id as string,
    accountCode: row.account_code as string,
    name: row.name as string,
    accountType: row.account_type as GridAccount["accountType"],
  }));
  const budgetId = (header.data as { id: string } | null)?.id;
  const lines = budgetId
    ? await readAllPages<BudgetLineRow>(
        (from, to) =>
          sb
            .from("acc_budget_line")
            .select("account_id,period_start,amount_minor")
            .eq("budget_id", budgetId)
            .order("period_start")
            .order("account_id")
            .order("id")
            .range(from, to),
        fail,
      )
    : [];
  return { byMonth: groupBudgetByMonth(lines, accounts, starts), accounts };
}

export interface BudgetVsActualReport extends BudgetVsActual {
  /** One row per month of the range; empty when the range is a single month. */
  monthly: MonthResult[];
}

/**
 * Budget vs Actual for whole fiscal months: the lines and sections, and, when
 * the range covers two months or more, the result of each month.
 * `from` is the first day of a month and `to` the last day of one.
 */
export async function getBudgetVsActual(
  sb: SupabaseClient,
  fiscalYear: number,
  from: string,
  to: string,
): Promise<BudgetVsActualReport> {
  const starts = monthStartsBetween(from, to);
  const [actual, budget] = await Promise.all([
    getLedgerBalances(sb, from, to),
    getBudgetAccountAmounts(sb, fiscalYear, from, to),
  ]);
  const report = buildBudgetVsActual(actual, budget);
  if (starts.length < 2) return { ...report, monthly: [] };
  const [actualByMonth, { byMonth: budgetByMonth }] = await Promise.all([
    getMonthlyLedgerBalances(sb, to, starts.length),
    getBudgetByMonth(sb, fiscalYear, starts),
  ]);
  const monthly = buildMonthByMonth(
    starts.map((start) => ({ start, label: monthLabelOf(start) })),
    actualByMonth,
    budgetByMonth,
  );
  return { ...report, monthly };
}

export interface BudgetGridData {
  /** Every posting income or expense account, in code order. */
  accounts: GridAccount[];
  /** What is budgeted, twelve months per account; only accounts with something budgeted. */
  budget: BudgetGridValues;
  /** What was posted in this fiscal year, by month, per account. */
  thisYear: BudgetGridValues;
  /** The same for the fiscal year before; empty when there is none to read. */
  lastYear: BudgetGridValues;
}

/** Everything the full-year budget grid opens with. Reads only. */
export async function getBudgetGrid(
  sb: SupabaseClient,
  fiscalYear: number,
  fiscalStartMonth: number,
): Promise<BudgetGridData> {
  const months = fiscalMonths(fiscalYear, fiscalStartMonth);
  const starts = months.map((m) => m.start);
  const { byMonth: budgetByMonth, accounts } = await getBudgetByMonth(sb, fiscalYear, starts);
  const budget: BudgetGridValues = {};
  starts.forEach((start, index) => {
    for (const row of budgetByMonth.get(start) ?? []) {
      if (row.amountMinor !== 0) (budget[row.accountId] ??= new Array<number>(starts.length).fill(0))[index] = row.amountMinor;
    }
  });
  const actualsFor = async (year: number): Promise<BudgetGridValues> => {
    if (year < 2000) return {};
    const yearMonths = fiscalMonths(year, fiscalStartMonth);
    const byMonth = await getMonthlyLedgerBalances(sb, yearMonths[11].end, 12);
    return monthlyActualsByAccount(
      yearMonths.map((m) => ({ start: m.start, label: m.label })),
      byMonth,
    );
  };
  const [thisYear, lastYear] = await Promise.all([actualsFor(fiscalYear), actualsFor(fiscalYear - 1)]);
  return { accounts, budget, thisYear, lastYear };
}
