import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMPTY_WORK_POLICY,
  type WorkPolicy,
} from "@/lib/domain/work-policy";

export class WorkPolicyError extends Error {}

/**
 * The policy in force, or the empty one when a company has never set it.
 *
 * A read failure returns the empty policy rather than throwing: the rules that
 * need a policy then stay asleep, which is the same visible outcome as never
 * having set one, and losing the whole dashboard over a settings read would be
 * out of all proportion.
 */
export async function getWorkPolicy(sb: SupabaseClient): Promise<WorkPolicy> {
  const { data, error } = await sb.rpc("acc_current_work_policy");
  if (error) {
    console.error("reading the work policy failed:", error.message);
    return EMPTY_WORK_POLICY;
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return EMPTY_WORK_POLICY;
  const num = (value: unknown): number | null =>
    value === null || value === undefined ? null : Number(value);
  return {
    materialityMinor: num(row.materiality_minor),
    approvalSlaDays: num(row.approval_sla_days),
    unmatchedBankAgeDays: num(row.unmatched_bank_age_days),
    closeWindowDays: num(row.close_window_days),
  };
}

export interface SaveWorkPolicyInput extends WorkPolicy {
  note: string | null;
}

export async function saveWorkPolicy(
  sb: SupabaseClient,
  input: SaveWorkPolicyInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_save_work_policy", {
    p_materiality_minor: input.materialityMinor,
    p_approval_sla_days: input.approvalSlaDays,
    p_unmatched_bank_age_days: input.unmatchedBankAgeDays,
    p_close_window_days: input.closeWindowDays,
    p_note: input.note,
  });
  if (error) throw new WorkPolicyError(error.message);
  return String(data);
}
