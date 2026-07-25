"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { inventoryValuationSchema } from "@/lib/domain/schemas";
import { getInventoryValuation, InventoryError, type InventoryValuation } from "@/lib/services/inventory";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

export async function inventoryValuationAction(raw: unknown): Promise<ActionResult<InventoryValuation>> {
  const parsed = inventoryValuationSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getInventoryValuation(sb, parsed.data.as_of) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof InventoryError || e instanceof Error ? e.message : "An unexpected error occurred",
    };
  }
}
