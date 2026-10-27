"use server";
import { createSupabaseServerClient } from "@/lib/db/server";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * The audit entry for someone turning their own second step off (2.68). The
 * factor is removed in the browser through the Auth API, which needs the
 * session that passed it; this records that it happened, in the open company.
 */
export async function recordTwoStepOffAction(removed: number): Promise<ActionResult> {
  try {
    const sb = await createSupabaseServerClient();
    const { error } = await sb.rpc("acc_record_two_step_off", { p_removed: Math.max(0, Math.trunc(removed)) });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "An unexpected error occurred" };
  }
}
