import type { SupabaseClient } from "@supabase/supabase-js";
import { checklistRecord } from "@/lib/domain/close-record";
import { closePeriod, PeriodsError } from "@/lib/services/periods";
import { getAccountingContext, type AccountingPeriodRow } from "./context";
import { getCloseReadiness } from "./close-readiness";

/**
 * Close a month and keep the checklist as it stood (2.84, migration 0180).
 *
 * The checklist is worked out for the period being closed, by the same reader
 * the closing screen uses, and goes to `acc_close_period_with_checklist`,
 * which closes through `acc_close_period` and keeps the list on the close's
 * event in one transaction. When the checklist cannot be worked out at all,
 * the month is still closed, as before, and keeps none: a failed read must not
 * stop a close the database would allow.
 */
export async function closePeriodWithChecklist(
  sb: SupabaseClient,
  periodId: string,
  reason: string,
  varianceNote: string | null,
): Promise<{ checklistKept: boolean }> {
  const checklist = await checklistFor(sb, periodId).catch(() => null);
  if (!checklist || checklist.length === 0) {
    await closePeriod(sb, periodId, reason, varianceNote);
    return { checklistKept: false };
  }
  const { error } = await sb.rpc("acc_close_period_with_checklist", {
    p_period_id: periodId,
    p_reason: reason,
    p_variance_note: varianceNote,
    p_checklist: checklist,
  });
  if (error) throw new PeriodsError(error.message);
  return { checklistKept: true };
}

async function checklistFor(sb: SupabaseClient, periodId: string) {
  const context = await getAccountingContext(sb);
  const period = context.periods.find((p) => p.id === periodId) ?? (await readPeriod(sb, periodId));
  if (!period) return null;
  const readiness = await getCloseReadiness(sb, context, period);
  return readiness ? checklistRecord(readiness.steps) : null;
}

/** A period outside the current fiscal year, closed from Settings → Periods. */
async function readPeriod(sb: SupabaseClient, periodId: string): Promise<AccountingPeriodRow | null> {
  const { data, error } = await sb
    .from("acc_accounting_period")
    .select("id,label,period_start,period_end,status")
    .eq("id", periodId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; label: string; period_start: string; period_end: string; status: string };
  return { id: row.id, label: row.label, periodStart: row.period_start, periodEnd: row.period_end, status: row.status };
}
