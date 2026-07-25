"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole } from "@/lib/auth";
import { getLedgerBalances } from "@/lib/services/reports";
import { getBudgetAccountAmounts, saveBudgetMonth, BudgetError } from "@/lib/services/budgets";
import { dayBefore } from "@/lib/domain/fiscal";
import {
  buildBudgetVsActual,
  buildStatementOfEquity,
  type BudgetAccountAmount,
  type BudgetVsActual,
  type LedgerBalance,
  type StatementOfEquity,
} from "@/lib/domain/reports";
import {
  budgetMonthSaveSchema,
  cashFlowRangeSchema,
  type BudgetMonthSaveInput,
} from "@/lib/domain/schemas";

export interface ActionResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

export async function getLedgerBalancesAction(
  from: string | null,
  to: string,
): Promise<ActionResult<LedgerBalance[]>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  try {
    const sb = await createSupabaseServerClient();
    const rows = await getLedgerBalances(sb, from, to);
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load report" };
  }
}

export async function getBudgetVsActualAction(
  fiscalYear: number,
  from: string,
  to: string,
): Promise<ActionResult<BudgetVsActual>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  try {
    cashFlowRangeSchema.parse({ from, to });
    const sb = await createSupabaseServerClient();
    const [actual, budget] = await Promise.all([
      getLedgerBalances(sb, from, to),
      getBudgetAccountAmounts(sb, fiscalYear, from, to),
    ]);
    return { ok: true, data: buildBudgetVsActual(actual, budget) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load Budget vs Actual" };
  }
}

export async function getBudgetMonthAction(
  fiscalYear: number,
  periodStart: string,
): Promise<ActionResult<BudgetAccountAmount[]>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  try {
    const parsed = budgetMonthSaveSchema.pick({
      fiscal_year: true,
      period_start: true,
    }).parse({ fiscal_year: fiscalYear, period_start: periodStart });
    const sb = await createSupabaseServerClient();
    const data = await getBudgetAccountAmounts(
      sb,
      parsed.fiscal_year,
      parsed.period_start,
      parsed.period_start,
    );
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load budget" };
  }
}

export async function saveBudgetMonthAction(
  input: BudgetMonthSaveInput,
): Promise<ActionResult<{ id: string }>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await saveBudgetMonth(sb, input);
    return { ok: true, data: { id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof BudgetError || err instanceof Error ? err.message : "Failed to save budget",
    };
  }
}

export async function getStatementOfEquityAction(
  from: string,
  to: string,
): Promise<ActionResult<StatementOfEquity>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  try {
    cashFlowRangeSchema.parse({ from, to });
    if (from > to) return { ok: false, error: "Report end date must not be before its start date" };
    const sb = await createSupabaseServerClient();
    const [opening, activity] = await Promise.all([
      getLedgerBalances(sb, null, dayBefore(from)),
      getLedgerBalances(sb, from, to),
    ]);
    return { ok: true, data: buildStatementOfEquity(opening, activity) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load Statement of Equity" };
  }
}
