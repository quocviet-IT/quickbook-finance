import type { SupabaseClient } from "@supabase/supabase-js";
import type { BudgetMonthSaveInput } from "@/lib/domain/schemas";
import { budgetMonthSaveSchema } from "@/lib/domain/schemas";
import type { BudgetAccountAmount } from "@/lib/domain/reports";

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
