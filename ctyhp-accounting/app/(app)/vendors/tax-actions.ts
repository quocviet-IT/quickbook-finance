"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { taxYearSchema, vendorTaxProfileSchema } from "@/lib/domain/schemas";
import {
  get1099Summary,
  listVendorTaxProfileVersions,
  saveVendorTaxProfile,
  VendorTaxError,
  type Report1099,
} from "@/lib/services/vendorTax";
import type { VendorTaxProfileRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

function msg(e: unknown): string {
  return e instanceof VendorTaxError || e instanceof Error ? e.message : "An unexpected error occurred";
}

/**
 * The elevated `vendor.tax_manage` permission is checked by the RPC — this guard
 * is only the coarse outer gate, so an accountant without the permission still
 * gets the RPC's precise message.
 */
export async function saveVendorTaxProfileAction(
  vendorId: string,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to change tax data" };
  const parsed = vendorTaxProfileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await saveVendorTaxProfile(sb, vendorId, parsed.data);
    revalidatePath("/vendors");
    revalidatePath("/reports/1099");
    return { ok: true, data: { id } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function listVendorTaxVersionsAction(
  vendorId: string,
): Promise<ActionResult<VendorTaxProfileRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listVendorTaxProfileVersions(sb, vendorId) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function report1099Action(raw: unknown): Promise<ActionResult<Report1099>> {
  const parsed = taxYearSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid tax year" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await get1099Summary(sb, parsed.data.year) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
