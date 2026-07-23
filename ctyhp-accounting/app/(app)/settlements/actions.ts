"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { customerRefundSchema, writeOffSchema } from "@/lib/domain/schemas";
import { recordCustomerRefund, voidCustomerRefund, writeOff, voidWriteOff, CreditsError } from "@/lib/services/credits";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof CreditsError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function recordRefundAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = customerRefundSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const id = await recordCustomerRefund(sb, parsed.data); revalidatePath("/payments"); return { ok: true, data: { id } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function voidRefundAction(id: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await voidCustomerRefund(sb, id); revalidatePath("/payments"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function writeOffAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = writeOffSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await writeOff(sb, parsed.data);
    revalidatePath(parsed.data.side === "ar" ? "/invoices" : "/bills");
    return { ok: true, data: { id } };
  } catch (e) { return { ok: false, error: msg(e) }; }
}
export async function voidWriteOffAction(id: string, side: "ar" | "ap"): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await voidWriteOff(sb, id); revalidatePath(side === "ar" ? "/invoices" : "/bills"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
