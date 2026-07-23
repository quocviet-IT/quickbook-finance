"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getApAgeing, AgeingError, type AgeingReport } from "@/lib/services/ageing";
export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
export async function apAgeingAction(asOf: string): Promise<ActionResult<AgeingReport>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getApAgeing(sb, asOf) }; }
  catch (e) { return { ok: false, error: e instanceof AgeingError || e instanceof Error ? e.message : "An unexpected error occurred" }; }
}
