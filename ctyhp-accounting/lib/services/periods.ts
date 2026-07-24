import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountingPeriodRow } from "@/lib/db/types";

export class PeriodsError extends Error {}

export async function generatePeriods(sb: SupabaseClient, fiscalYear: number): Promise<number> {
  const { data, error } = await sb.rpc("acc_generate_periods", { p_fiscal_year: fiscalYear });
  if (error) throw new PeriodsError(error.message);
  return Number(data ?? 0);
}
export async function closePeriod(sb: SupabaseClient, id: string, reason: string): Promise<void> {
  const { error } = await sb.rpc("acc_close_period", { p_period_id: id, p_reason: reason });
  if (error) throw new PeriodsError(error.message);
}
export async function reopenPeriod(sb: SupabaseClient, id: string, reason: string): Promise<void> {
  const { error } = await sb.rpc("acc_reopen_period", { p_period_id: id, p_reason: reason });
  if (error) throw new PeriodsError(error.message);
}
export async function listPeriods(sb: SupabaseClient, fiscalYear: number): Promise<AccountingPeriodRow[]> {
  const { data, error } = await sb.from("acc_accounting_period")
    .select("id,fiscal_year,period_month,period_start,period_end,label,status,close_reason,reopen_reason")
    .eq("fiscal_year", fiscalYear)
    .order("period_month");
  if (error) throw new PeriodsError(error.message);
  return (data ?? []) as unknown as AccountingPeriodRow[];
}
