"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getArAgeing, AgeingError, type AgeingReport } from "@/lib/services/ageing";
export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
export async function arAgeingAction(asOf: string): Promise<ActionResult<AgeingReport>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getArAgeing(sb, asOf) }; }
  catch (e) { return { ok: false, error: e instanceof AgeingError || e instanceof Error ? e.message : "An unexpected error occurred" }; }
}
