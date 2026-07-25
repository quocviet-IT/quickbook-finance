"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { inventoryAdjustmentSchema } from "@/lib/domain/schemas";
import {
  adjustInventory,
  inventoryAdjustmentApprovalAmount,
  InventoryError,
  listItemMovements,
} from "@/lib/services/inventory";
import {
  executeOrSubmitForApproval,
  toControlledActionResponse,
  type ControlledActionResponse,
} from "@/lib/services/approval-flow";
import type { InventoryTxnRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

function msg(e: unknown): string {
  return e instanceof InventoryError || e instanceof Error ? e.message : "An unexpected error occurred";
}

export async function adjustInventoryAction(raw: unknown): Promise<ActionResult<ControlledActionResponse>> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to adjust inventory" };
  const parsed = inventoryAdjustmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const amountMinor = await inventoryAdjustmentApprovalAmount(sb, parsed.data);
    const outcome = await executeOrSubmitForApproval({
      sb,
      actionKey: "inventory_adjustment",
      title: "Inventory adjustment",
      amountMinor,
      reason: parsed.data.reason,
      payload: {
        item_id: parsed.data.item_id,
        date: parsed.data.adjust_date,
        qty_delta: parsed.data.qty_delta,
        unit_cost_minor: parsed.data.unit_cost_minor,
        value_delta_minor: parsed.data.value_delta_minor,
        offset_account_id: parsed.data.offset_account_id,
      },
      execute: () => adjustInventory(sb, parsed.data),
    });
    revalidatePath("/items");
    revalidatePath("/reports/inventory-valuation");
    revalidatePath("/approvals");
    revalidatePath("/dashboard");
    return { ok: true, data: toControlledActionResponse(outcome, String) };
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
