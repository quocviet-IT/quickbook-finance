"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import { reconciliationCreateSchema, reconciliationAdjustmentSchema, reconciliationReopenSchema } from "@/lib/domain/schemas";
import {
  createReconciliation, setCleared, recordAdjustment, completeReconciliation, reopenReconciliation,
  listReconciliations, getReconciliationLines, getReconciliationDetail, getDiscrepancies,
  BankRecError, type ReconLineView, type ReconDetail, type DiscrepancyRow,
} from "@/lib/services/bankrec";
import type { StatementReconciliationRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof BankRecError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function createReconciliationAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = reconciliationCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const id = await createReconciliation(sb, parsed.data); revalidatePath("/banking/reconcile"); return { ok: true, data: { id } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function setClearedAction(reconciliationId: string, journalLineId: string, cleared: boolean): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await setCleared(sb, reconciliationId, journalLineId, cleared); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function recordAdjustmentAction(reconciliationId: string, raw: unknown): Promise<ActionResult<{ entryId: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = reconciliationAdjustmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const entryId = await recordAdjustment(sb, reconciliationId, parsed.data); return { ok: true, data: { entryId } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function completeReconciliationAction(id: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await completeReconciliation(sb, id); revalidatePath("/banking/reconcile"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function reopenReconciliationAction(id: string, raw: unknown): Promise<ActionResult> {
  const role = await getUserRole();
  if (!isAdmin(role)) return { ok: false, error: "Only an admin can reopen a reconciliation" };
  const parsed = reconciliationReopenSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); await reopenReconciliation(sb, id, parsed.data); revalidatePath("/banking/reconcile"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function listReconciliationsAction(bankAccountId: string): Promise<ActionResult<StatementReconciliationRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listReconciliations(sb, bankAccountId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function reconciliationLinesAction(id: string): Promise<ActionResult<ReconLineView[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getReconciliationLines(sb, id) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function reconciliationDetailAction(id: string): Promise<ActionResult<ReconDetail>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getReconciliationDetail(sb, id) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function discrepanciesAction(bankAccountId: string): Promise<ActionResult<DiscrepancyRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getDiscrepancies(sb, bankAccountId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
