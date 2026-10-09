/**
 * Budget vs Actual, the parts that are plain arithmetic: % of Budget, the
 * month-by-month results, and everything the full-year budget grid does with
 * its numbers (spreading a year, starting from actuals, finding the months
 * that changed, saving them one at a time).
 *
 * Pure. Amounts are base-currency minor units, as OneBook stores a budget:
 * positive for income and for spending alike.
 */

import { roundHalfAwayFromZero } from "@/lib/domain/money";
import { buildProfitAndLoss, type BudgetAccountAmount, type LedgerBalance } from "@/lib/domain/reports";
import type { AccountType } from "@/lib/domain/accounts";

/* -------------------------------------------------------- % of Budget */

/** A line with no budget has nothing to be a percentage of. The save drops zero lines, so 0 is "not budgeted". */
export const hasBudget = (budgetMinor: number): boolean => budgetMinor !== 0;

/** Actual ÷ budget × 100 to one decimal place; null when there is no budget. */
export function percentOfBudget(actualMinor: number, budgetMinor: number): number | null {
  if (!hasBudget(budgetMinor)) return null;
  return Math.round((actualMinor / budgetMinor) * 1000) / 10;
}

/* ------------------------------------------------------ Month by month */

export interface MonthSlot {
  /** First day of the month, YYYY-MM-DD. */
  start: string;
  label: string;
}

export interface MonthResult extends MonthSlot {
  /** Income less expenses actually posted in the month. */
  actual: number;
  /** Income less expenses budgeted for the month. */
  budget: number;
  /** Actual less budget. */
  variance: number;
}

/** The `YYYY-MM` key `acc_monthly_ledger_balances` gives a month. */
export const monthKeyOf = (start: string): string => start.slice(0, 7);

/** The first day of every month from the one holding `from` through the one holding `to`. */
export function monthStartsBetween(from: string, to: string): string[] {
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const lastYear = Number(to.slice(0, 4));
  const lastMonth = Number(to.slice(5, 7));
  const out: string[] = [];
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    out.push(`${year}-${String(month).padStart(2, "0")}-01`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

/** "Jan 2026", the label of the month starting on `start`. */
export function monthLabelOf(start: string): string {
  return new Date(`${start}T00:00:00.000Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

const INCOME_TYPES: ReadonlySet<AccountType> = new Set<AccountType>(["income", "other_income"]);

/** Income less expenses for a set of budget lines. */
export function budgetResultOf(amounts: readonly BudgetAccountAmount[]): number {
  let result = 0;
  for (const row of amounts) result += INCOME_TYPES.has(row.accountType) ? row.amountMinor : -row.amountMinor;
  return result;
}

/**
 * One row per month: the actual result (by the one Profit and Loss rule), the
 * budgeted result, and the difference. A month with no postings or no budget is 0.
 */
export function buildMonthByMonth(
  months: readonly MonthSlot[],
  actualByMonth: ReadonlyMap<string, readonly LedgerBalance[]>,
  budgetByMonth: ReadonlyMap<string, readonly BudgetAccountAmount[]>,
): MonthResult[] {
  return months.map((month) => {
    const key = monthKeyOf(month.start);
    const actual = buildProfitAndLoss([...(actualByMonth.get(key) ?? [])]).netIncome;
    const budget = budgetResultOf(budgetByMonth.get(month.start) ?? []);
    return { ...month, actual, budget, variance: actual - budget };
  });
}

/* --------------------------------------------------------------- The grid */

/** Twelve month amounts per account id, in fiscal-month order. */
export type BudgetGridValues = Record<string, number[]>;

export const GRID_MONTHS = 12;

/**
 * Column widths of the budget grid, in px. They must fit the drawer at a
 * 1440px window with no sideways scroll: the drawer is min(1500, 96vw) =
 * 1382px, less 48px of padding and a 15px scrollbar = 1319px. A figure like
 * 1000000.00 is ten characters, about 70px at 12px tabular numerals.
 */
export const GRID_WIDTHS = {
  account: 200,
  month: 84,
  year: 96,
  /** Account + twelve months + Year. */
  total: 200 + 12 * 84 + 96,
} as const;

export interface GridAccount {
  accountId: string;
  accountCode: string;
  name: string;
  accountType: AccountType;
}

/**
 * What each Profit and Loss account actually posted in each of twelve months,
 * by the one Profit and Loss rule (the same natural, positive-for-both
 * amounts a budget is entered in). A month with no postings is 0.
 */
export function monthlyActualsByAccount(
  months: readonly MonthSlot[],
  actualByMonth: ReadonlyMap<string, readonly LedgerBalance[]>,
): BudgetGridValues {
  const out: BudgetGridValues = {};
  months.forEach((month, index) => {
    const pnl = buildProfitAndLoss([...(actualByMonth.get(monthKeyOf(month.start)) ?? [])]);
    for (const section of [pnl.income, pnl.costOfGoodsSold, pnl.operatingExpenses, pnl.otherIncome, pnl.otherExpenses]) {
      for (const line of section.lines) {
        if (!line.accountId) continue;
        (out[line.accountId] ??= new Array<number>(months.length).fill(0))[index] = line.amount;
      }
    }
  });
  return out;
}

/** An even split of a year over the months; the rounding remainder goes into the first month. */
export function spreadYear(yearMinor: number, months: number = GRID_MONTHS): number[] {
  const each = Math.trunc(yearMinor / months);
  const out = new Array<number>(months).fill(each);
  out[0] += yearMinor - each * months;
  return out;
}

export const yearTotal = (months: readonly number[]): number => months.reduce((sum, value) => sum + value, 0);

/**
 * A budget started from actuals: each month's amount raised by `upliftPercent`
 * and rounded to a minor unit. An account that was net-negative in a month
 * (a refund larger than its spending) starts at 0, since a budget is never negative.
 */
export function seedFromActuals(
  actualsByAccount: Readonly<Record<string, readonly number[]>>,
  upliftPercent: number,
): BudgetGridValues {
  const factor = 1 + upliftPercent / 100;
  const out: BudgetGridValues = {};
  for (const [accountId, months] of Object.entries(actualsByAccount)) {
    const seeded = Array.from({ length: GRID_MONTHS }, (_, i) =>
      Math.max(0, roundHalfAwayFromZero((months[i] ?? 0) * factor)),
    );
    if (seeded.some((value) => value !== 0)) out[accountId] = seeded;
  }
  return out;
}

/** The indices (0–11) of the months where the grid differs from what was loaded. A missing account counts as 0. */
export function dirtyMonths(baseline: Readonly<BudgetGridValues>, current: Readonly<BudgetGridValues>): number[] {
  const ids = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  const dirty: number[] = [];
  for (let i = 0; i < GRID_MONTHS; i += 1) {
    for (const id of ids) {
      if ((baseline[id]?.[i] ?? 0) !== (current[id]?.[i] ?? 0)) {
        dirty.push(i);
        break;
      }
    }
  }
  return dirty;
}

/** The non-zero lines of one month, as the save takes them. A month is replaced whole, so a zero line is simply left out. */
export function monthLines(
  current: Readonly<BudgetGridValues>,
  index: number,
): { account_id: string; amount_minor: number }[] {
  return Object.entries(current)
    .map(([accountId, months]) => ({ account_id: accountId, amount_minor: months[index] ?? 0 }))
    .filter((line) => line.amount_minor !== 0);
}

export interface PlannedSummary {
  income: number;
  spending: number;
  result: number;
}

/** Planned income, planned spending and the planned result over the whole grid. */
export function plannedSummary(
  accounts: readonly Pick<GridAccount, "accountId" | "accountType">[],
  current: Readonly<BudgetGridValues>,
): PlannedSummary {
  let income = 0;
  let spending = 0;
  for (const account of accounts) {
    const total = yearTotal(current[account.accountId] ?? []);
    if (INCOME_TYPES.has(account.accountType)) income += total;
    else spending += total;
  }
  return { income, spending, result: income - spending };
}

/* ------------------------------------------------------------------ Save */

export interface MonthToSave {
  index: number;
  label: string;
}

export interface SaveOutcome {
  /** Labels of the months written, in order. */
  saved: string[];
  /** The month that failed, and why; null when every month was saved. */
  failed: { label: string; error: string } | null;
  /** The failed month and every month after it, none of which was tried again. */
  notSaved: string[];
}

/**
 * Save the months one at a time, in order, and stop at the first failure.
 * Each save replaces its own month, so running this again is safe: months
 * already written are written again with the same figures.
 */
export async function runBudgetSave(
  months: readonly MonthToSave[],
  save: (month: MonthToSave) => Promise<{ ok: boolean; error?: string }>,
): Promise<SaveOutcome> {
  const saved: string[] = [];
  for (let i = 0; i < months.length; i += 1) {
    const month = months[i];
    let result: { ok: boolean; error?: string };
    try {
      result = await save(month);
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : "Failed to save budget" };
    }
    if (!result.ok) {
      return {
        saved,
        failed: { label: month.label, error: result.error ?? "Failed to save budget" },
        notSaved: months.slice(i).map((m) => m.label),
      };
    }
    saved.push(month.label);
  }
  return { saved, failed: null, notSaved: [] };
}

export interface BudgetLineRow {
  account_id: string;
  period_start: string;
  amount_minor: number;
}

/**
 * The budget table's rows grouped into months. Every requested month gets
 * every account (0 where nothing is budgeted), in code order. Rows for a month
 * that was not asked for, or for an account outside `accounts`, are ignored.
 */
export function groupBudgetByMonth(
  lines: readonly BudgetLineRow[],
  accounts: readonly GridAccount[],
  starts: readonly string[],
): Map<string, BudgetAccountAmount[]> {
  const wanted = new Set(starts);
  const sums = new Map<string, Map<string, number>>();
  for (const line of lines) {
    if (!wanted.has(line.period_start)) continue;
    const month = sums.get(line.period_start) ?? new Map<string, number>();
    month.set(line.account_id, (month.get(line.account_id) ?? 0) + Number(line.amount_minor));
    sums.set(line.period_start, month);
  }
  const ordered = [...accounts].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  return new Map(
    starts.map((start) => [
      start,
      ordered.map((a) => ({
        accountId: a.accountId,
        accountCode: a.accountCode,
        name: a.name,
        accountType: a.accountType,
        amountMinor: sums.get(start)?.get(a.accountId) ?? 0,
      })),
    ]),
  );
}

/** What to tell the person after a save. */
export function saveOutcomeMessage(outcome: SaveOutcome): string {
  if (!outcome.failed) {
    return outcome.saved.length === 0 ? "Nothing to save." : `Budget saved for ${outcome.saved.join(", ")}.`;
  }
  const savedText = outcome.saved.length > 0 ? outcome.saved.join(", ") : "none";
  return `Saving stopped at ${outcome.failed.label}: ${outcome.failed.error}. Saved: ${savedText}. Not saved: ${outcome.notSaved.join(", ")}. Press Save to try again.`;
}
