"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getArAging, AgingError, type AgingReport } from "@/lib/services/aging";
export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
export async function arAgingAction(asOf: string): Promise<ActionResult<AgingReport>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getArAging(sb, asOf) }; }
  catch (e) { return { ok: false, error: e instanceof AgingError || e instanceof Error ? e.message : "An unexpected error occurred" }; }
}
