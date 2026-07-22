"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listOpenBillsForVendor, payBills, voidBillPayment, PayablesError } from "@/lib/services/payables";
import type { BillRow } from "@/lib/db/types";
import { billPaymentCreateSchema } from "@/lib/domain/schemas";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}

function msg(err: unknown): string {
  if (err instanceof PayablesError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function openBillsForVendorAction(vendorId: string): Promise<ActionResult<BillRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listOpenBillsForVendor(sb, vendorId) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function payBillsAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = billPaymentCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await payBills(sb, parsed.data);
    revalidatePath("/pay-bills");
    revalidatePath("/bills");
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function voidBillPaymentAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await voidBillPayment(sb, id);
    revalidatePath("/pay-bills");
    revalidatePath("/bills");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
