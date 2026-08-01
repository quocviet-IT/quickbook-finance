import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountingPeriodRow } from "@/lib/db/types";

export class PeriodsError extends Error {}

export async function generatePeriods(sb: SupabaseClient, fiscalYear: number): Promise<number> {
  const { data, error } = await sb.rpc("acc_generate_periods", { p_fiscal_year: fiscalYear });
  if (error) throw new PeriodsError(error.message);
  return Number(data ?? 0);
}
/**
 * What stands in the way of closing this period, or null if nothing does.
 *
 * The same sentence `acc_close_period` would refuse with, so the screen can
 * show it before anyone presses the button rather than after.
 */
export async function periodCloseBlockers(
  sb: SupabaseClient,
  id: string,
): Promise<string | null> {
  const { data, error } = await sb.rpc("acc_period_close_blockers", { p_period_id: id });
  if (error) throw new PeriodsError(error.message);
  return (data as string | null) ?? null;
}

/**
 * Close a period. The database refuses if a control account does not tie out at
 * the period end, unless `varianceNote` explains the difference — in which case
 * the explanation is stored on the period and audited.
 */
export async function closePeriod(
  sb: SupabaseClient,
  id: string,
  reason: string,
  varianceNote?: string | null,
): Promise<void> {
  const { error } = await sb.rpc("acc_close_period", {
    p_period_id: id,
    p_reason: reason,
    p_variance_note: varianceNote ?? null,
  });
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
