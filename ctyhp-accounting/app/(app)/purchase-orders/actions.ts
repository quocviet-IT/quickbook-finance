"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import {
  billFromPoSchema,
  goodsReceiptSchema,
  purchaseOrderReasonSchema,
  purchaseOrderSaveSchema,
} from "@/lib/domain/schemas";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createBillFromPo,
  PurchasingError,
  receivePurchaseOrder,
  savePurchaseOrder,
  voidGoodsReceipt,
} from "@/lib/services/purchasing";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string {
  return e instanceof PurchasingError || e instanceof Error ? e.message : "An unexpected error occurred";
}
function revalidate(id?: string): void {
  revalidatePath("/purchase-orders");
  revalidatePath("/purchase-orders/received-not-billed");
  if (id) revalidatePath(`/purchase-orders/${id}`);
}

export async function savePurchaseOrderAction(
  id: string | null,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = purchaseOrderSaveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const poId = await savePurchaseOrder(sb, id, parsed.data);
    revalidate(poId);
    return { ok: true, data: { id: poId } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function approvePurchaseOrderAction(id: string): Promise<ActionResult<{ po_number: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const number = await approvePurchaseOrder(sb, id);
    revalidate(id);
    return { ok: true, data: { po_number: number } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function cancelPurchaseOrderAction(id: string, raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = purchaseOrderReasonSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await cancelPurchaseOrder(sb, id, parsed.data.reason);
    revalidate(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function closePurchaseOrderAction(id: string, raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = purchaseOrderReasonSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await closePurchaseOrder(sb, id, parsed.data.reason);
    revalidate(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function receivePurchaseOrderAction(
  id: string,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = goodsReceiptSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const receiptId = await receivePurchaseOrder(sb, id, parsed.data);
    revalidate(id);
    return { ok: true, data: { id: receiptId } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function voidGoodsReceiptAction(
  receiptId: string,
  poId: string,
  raw: unknown,
): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = purchaseOrderReasonSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await voidGoodsReceipt(sb, receiptId, parsed.data.reason);
    revalidate(poId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function createBillFromPoAction(
  id: string,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = billFromPoSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const billId = await createBillFromPo(sb, id, parsed.data);
    revalidate(id);
    revalidatePath("/bills");
    return { ok: true, data: { id: billId } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
