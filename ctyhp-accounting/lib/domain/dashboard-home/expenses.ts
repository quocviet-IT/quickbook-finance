/**
 * Where the money went in a period, by account: the largest expense accounts
 * across cost of goods sold, operating and other expenses, then "Everything
 * else". Pure, from the Profit and Loss the reports build, so the widget and
 * the report agree on every line.
 */
import type { ProfitAndLoss } from "@/lib/domain/reports";
import type { HomeExpenseLine } from "./types";

export const EVERYTHING_ELSE = "Everything else";

/** Cost of goods sold, operating expenses and other expenses: the period's total expenses. */
export function totalExpenses(pnl: ProfitAndLoss): number {
  return pnl.costOfGoodsSold.total + pnl.operatingExpenses.total + pnl.otherExpenses.total;
}

/**
 * The `limit` largest expense accounts, largest first (ties by account code),
 * then "Everything else" for whatever is left, when anything is. A line of
 * zero or below (a contra account such as Purchase Discounts) never makes the
 * top list; it reduces "Everything else", which can therefore be negative.
 * The lines always add up to the period's total expenses.
 */
export function topExpenses(pnl: ProfitAndLoss, limit = 4): HomeExpenseLine[] {
  const lines = [...pnl.costOfGoodsSold.lines, ...pnl.operatingExpenses.lines, ...pnl.otherExpenses.lines];
  const top = lines
    .filter((line) => line.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.accountCode.localeCompare(b.accountCode))
    .slice(0, limit)
    .map((line) => ({ accountId: line.accountId, name: line.name, amountMinor: line.amount }));
  const rest = totalExpenses(pnl) - top.reduce((sum, line) => sum + line.amountMinor, 0);
  return rest === 0 ? top : [...top, { accountId: null, name: EVERYTHING_ELSE, amountMinor: rest }];
}
