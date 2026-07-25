"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { inventoryAdjustmentSchema } from "@/lib/domain/schemas";
import { adjustInventory, InventoryError, listItemMovements } from "@/lib/services/inventory";
import type { InventoryTxnRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

function msg(e: unknown): string {
  return e instanceof InventoryError || e instanceof Error ? e.message : "An unexpected error occurred";
}

export async function adjustInventoryAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to adjust inventory" };
  const parsed = inventoryAdjustmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await adjustInventory(sb, parsed.data);
    revalidatePath("/items");
    revalidatePath("/reports/inventory-valuation");
    return { ok: true, data: { id } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function listItemMovementsAction(itemId: string): Promise<ActionResult<InventoryTxnRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listItemMovements(sb, itemId) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
