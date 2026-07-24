"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin } from "@/lib/auth";
import { closePeriodSchema, reopenPeriodSchema } from "@/lib/domain/schemas";
import { generatePeriods, closePeriod, reopenPeriod, listPeriods, PeriodsError } from "@/lib/services/periods";
import type { AccountingPeriodRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
async function adminGuard(): Promise<string | null> {
  const role = await getUserRole();
  return isAdmin(role) ? null : "Only an admin can manage accounting periods";
}
function msg(e: unknown): string { return e instanceof PeriodsError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function generatePeriodsAction(fiscalYear: number): Promise<ActionResult<{ created: number }>> {
  const denied = await adminGuard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); const created = await generatePeriods(sb, fiscalYear); revalidatePath("/settings/periods"); return { ok: true, data: { created } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function closePeriodAction(id: string, raw: unknown): Promise<ActionResult> {
  const denied = await adminGuard(); if (denied) return { ok: false, error: denied };
  const parsed = closePeriodSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); await closePeriod(sb, id, parsed.data.reason); revalidatePath("/settings/periods"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function reopenPeriodAction(id: string, raw: unknown): Promise<ActionResult> {
  const denied = await adminGuard(); if (denied) return { ok: false, error: denied };
  const parsed = reopenPeriodSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); await reopenPeriod(sb, id, parsed.data.reason); revalidatePath("/settings/periods"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function listPeriodsAction(fiscalYear: number): Promise<ActionResult<AccountingPeriodRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listPeriods(sb, fiscalYear) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
