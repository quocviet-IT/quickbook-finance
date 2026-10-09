"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole } from "@/lib/auth";
import { getLedgerBalances } from "@/lib/services/reports";
import {
  getBudgetGrid,
  getBudgetVsActual,
  saveBudgetMonth,
  BudgetError,
  type BudgetGridData,
  type BudgetVsActualReport,
} from "@/lib/services/budgets";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { dayBefore } from "@/lib/domain/fiscal";
import { BUDGET_RANGE_PROBLEM, budgetRangeIsValid } from "@/lib/domain/budget-grid";
import {
  buildStatementOfEquity,
  type LedgerBalance,
  type StatementOfEquity,
} from "@/lib/domain/reports";
import {
  budgetMonthSaveSchema,
  cashFlowRangeSchema,
  type BudgetMonthSaveInput,
} from "@/lib/domain/schemas";
import type { ZoomSpec } from "@/lib/domain/statement";
import { zoomSpecProblem, type ZoomResult } from "@/lib/domain/zoom";
import { getZoom } from "@/lib/services/zoom";

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
): Promise<ActionResult<BudgetVsActualReport>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  try {
    cashFlowRangeSchema.parse({ from, to });
    if (!from.endsWith("-01")) return { ok: false, error: "A budget report starts on the first day of a month" };
    if (from > to) return { ok: false, error: "Report end date must not be before its start date" };
    const parsed = budgetMonthSaveSchema.pick({ fiscal_year: true }).safeParse({ fiscal_year: fiscalYear });
    if (!parsed.success) return { ok: false, error: BUDGET_RANGE_PROBLEM };
    const sb = await createSupabaseServerClient();
    const settings = await getCurrentCompanySettings(sb);
    if (!budgetRangeIsValid(parsed.data.fiscal_year, settings?.fiscal_year_start_month ?? 1, from, to)) {
      return { ok: false, error: BUDGET_RANGE_PROBLEM };
    }
    return { ok: true, data: await getBudgetVsActual(sb, parsed.data.fiscal_year, from, to) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load Budget vs Actual" };
  }
}

/** The full-year budget grid's starting data: the accounts, the budget, and two years of actuals. Reads only. */
export async function getBudgetGridAction(fiscalYear: number): Promise<ActionResult<BudgetGridData>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  try {
    const parsed = budgetMonthSaveSchema.pick({ fiscal_year: true }).parse({ fiscal_year: fiscalYear });
    const sb = await createSupabaseServerClient();
    const settings = await getCurrentCompanySettings(sb);
    const data = await getBudgetGrid(sb, parsed.fiscal_year, settings?.fiscal_year_start_month ?? 1);
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

/** The posted lines behind one figure of a statement. Reads only. */
export async function zoomAction(spec: ZoomSpec): Promise<ActionResult<ZoomResult>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  const problem = zoomSpecProblem(spec);
  if (problem) return { ok: false, error: problem };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getZoom(sb, spec) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The entries could not be read." };
  }
}
