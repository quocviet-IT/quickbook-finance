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
import {
  executeOrSubmitForApproval,
  toControlledActionResponse,
  type ControlledActionResponse,
} from "@/lib/services/approval-flow";

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
): Promise<ActionResult<ControlledActionResponse>> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to change tax data" };
  const parsed = vendorTaxProfileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const vendorResult = await sb.from("acc_vendor").select("name").eq("id", vendorId).single();
    if (vendorResult.error) throw new VendorTaxError(vendorResult.error.message);
    const input = parsed.data;
    const outcome = await executeOrSubmitForApproval({
      sb,
      actionKey: "vendor_tax_profile",
      title: `Vendor tax profile — ${vendorResult.data.name}`,
      amountMinor: 0,
      reason: input.reason,
      payload: {
        vendor_id: vendorId,
        w9_status: input.w9_status,
        w9_received_date: input.w9_received_date || null,
        w9_expires_date: input.w9_expires_date || null,
        classification: input.classification || null,
        reporting_name: input.reporting_name || null,
        tin_ref: input.tin_ref || null,
        tin_type: input.tin_type || null,
        address_line1: input.address_line1 || null,
        address_line2: input.address_line2 || null,
        city: input.city || null,
        region: input.region || null,
        postal_code: input.postal_code || null,
        country: input.country || "US",
        is_1099_eligible: input.is_1099_eligible,
        box_code: input.box_code || null,
        eligibility_override: input.eligibility_override,
        override_reason: input.override_reason || null,
      },
      execute: () => saveVendorTaxProfile(sb, vendorId, input),
    });
    revalidatePath("/vendors");
    revalidatePath("/reports/1099");
    revalidatePath("/approvals");
    revalidatePath("/dashboard");
    return { ok: true, data: toControlledActionResponse(outcome, String) };
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
