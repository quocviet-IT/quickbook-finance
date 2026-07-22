"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import {
  createDraftBill,
  postBill,
  voidBill,
  getBillLines,
  PayablesError,
} from "@/lib/services/payables";
import type { BillLineRow } from "@/lib/db/types";
import { billCreateSchema } from "@/lib/domain/schemas";

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

export async function createBillAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = billCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const bill = await createDraftBill(sb, parsed.data);
    revalidatePath("/bills");
    return { ok: true, data: { id: bill.id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function getBillLinesAction(id: string): Promise<ActionResult<BillLineRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getBillLines(sb, id) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function postBillAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await postBill(sb, id);
    revalidatePath("/bills");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function voidBillAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await voidBill(sb, id);
    revalidatePath("/bills");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
