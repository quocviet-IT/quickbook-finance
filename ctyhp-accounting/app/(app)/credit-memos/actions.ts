"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { creditMemoCreateSchema, creditAllocationSchema } from "@/lib/domain/schemas";
import { z } from "zod";
import {
  createCreditMemo, applyCreditMemo, voidCreditMemo, listCreditMemos, listOpenInvoices, CreditsError,
} from "@/lib/services/credits";
import type { CreditMemoRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof CreditsError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function createCreditMemoAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = creditMemoCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await createCreditMemo(sb, parsed.data);
    revalidatePath("/credit-memos");
    return { ok: true, data: { id } };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

export async function applyCreditMemoAction(id: string, rawAllocs: unknown): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = z.array(creditAllocationSchema).safeParse(rawAllocs);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid allocations" };
  try {
    const sb = await createSupabaseServerClient();
    await applyCreditMemo(sb, id, parsed.data);
    revalidatePath("/credit-memos");
    return { ok: true };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

export async function voidCreditMemoAction(id: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await voidCreditMemo(sb, id); revalidatePath("/credit-memos"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function listCreditMemosAction(): Promise<ActionResult<CreditMemoRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listCreditMemos(sb) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function listOpenInvoicesAction(customerId: string, currency: string): Promise<ActionResult<{ id: string; invoice_number: string; balance_due_minor: number }[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listOpenInvoices(sb, customerId, currency) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
