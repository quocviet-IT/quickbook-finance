"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getVendorStatement, AgingError, type StatementReport } from "@/lib/services/aging";
export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
export async function vendorStatementAction(vendorId: string, from: string, to: string): Promise<ActionResult<StatementReport>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getVendorStatement(sb, vendorId, from, to) }; }
  catch (e) { return { ok: false, error: e instanceof AgingError || e instanceof Error ? e.message : "An unexpected error occurred" }; }
}
