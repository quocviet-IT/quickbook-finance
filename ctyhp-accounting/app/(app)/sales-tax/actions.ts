"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import {
  getSalesTaxLiability,
  recordTaxPayment,
  voidTaxPayment,
  createTaxCode,
  updateTaxCode,
  setTaxCodeActive,
  SalesTaxError,
} from "@/lib/services/salestax";
import type { SalesTaxLiability } from "@/lib/domain/salestax";
import { taxCodeCreateSchema, taxCodeUpdateSchema, taxPaymentCreateSchema } from "@/lib/domain/schemas";

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
  if (err instanceof SalesTaxError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function liabilityAction(from: string, to: string): Promise<ActionResult<SalesTaxLiability>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getSalesTaxLiability(sb, from, to) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function recordTaxPaymentAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = taxPaymentCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await recordTaxPayment(sb, parsed.data);
    revalidatePath("/sales-tax");
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function voidTaxPaymentAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await voidTaxPayment(sb, id);
    revalidatePath("/sales-tax");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function createTaxCodeAction(raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = taxCodeCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await createTaxCode(sb, parsed.data);
    revalidatePath("/sales-tax");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function updateTaxCodeAction(id: string, raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = taxCodeUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await updateTaxCode(sb, id, parsed.data);
    revalidatePath("/sales-tax");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function setTaxCodeActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await setTaxCodeActive(sb, id, active);
    revalidatePath("/sales-tax");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
