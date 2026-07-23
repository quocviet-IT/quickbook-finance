"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { vendorCreditCreateSchema, creditAllocationSchema } from "@/lib/domain/schemas";
import {
  createVendorCredit, applyVendorCredit, voidVendorCredit, listVendorCredits, listOpenBills, CreditsError,
} from "@/lib/services/credits";
import type { VendorCreditRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof CreditsError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function createVendorCreditAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = vendorCreditCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const id = await createVendorCredit(sb, parsed.data); revalidatePath("/vendor-credits"); return { ok: true, data: { id } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function applyVendorCreditAction(id: string, rawAllocs: unknown): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = z.array(creditAllocationSchema).safeParse(rawAllocs);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid allocations" };
  try { const sb = await createSupabaseServerClient(); await applyVendorCredit(sb, id, parsed.data); revalidatePath("/vendor-credits"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function voidVendorCreditAction(id: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await voidVendorCredit(sb, id); revalidatePath("/vendor-credits"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function listVendorCreditsAction(): Promise<ActionResult<VendorCreditRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listVendorCredits(sb) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function listOpenBillsAction(vendorId: string, currency: string): Promise<ActionResult<{ id: string; bill_number: string; balance_due_minor: number }[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listOpenBills(sb, vendorId, currency) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
