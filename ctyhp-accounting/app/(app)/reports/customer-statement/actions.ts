"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getCustomerStatement, AgingError, type StatementReport } from "@/lib/services/aging";
export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
export async function customerStatementAction(customerId: string, from: string, to: string): Promise<ActionResult<StatementReport>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getCustomerStatement(sb, customerId, from, to) }; }
  catch (e) { return { ok: false, error: e instanceof AgingError || e instanceof Error ? e.message : "An unexpected error occurred" }; }
}
