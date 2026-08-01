"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import {
  getInventoryReview,
  writeDownInventory,
  InventoryReviewError,
} from "@/lib/services/inventory-review";
import type { InventoryReview } from "@/lib/domain/inventory-review";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function msg(err: unknown): string {
  return err instanceof InventoryReviewError || err instanceof Error
    ? err.message
    : "An unexpected error occurred";
}

export async function inventoryReviewAction(
  asOf: string,
  windowDays: number,
): Promise<ActionResult<InventoryReview>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getInventoryReview(sb, asOf, windowDays) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * Take a write-down. Guarded here by role and again in the database, where the
 * rule that inventory is never written back up actually lives.
 */
export async function writeDownInventoryAction(input: {
  itemId: string;
  date: string;
  nrvMinor: number;
  reason: string;
}): Promise<ActionResult> {
  const role = await getUserRole();
  if (!canWrite(role)) {
    return { ok: false, error: "You do not have permission to write down inventory" };
  }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: "Explain the write-down in at least ten characters" };
  }
  try {
    const sb = await createSupabaseServerClient();
    await writeDownInventory(sb, input);
    revalidatePath("/reports/inventory-review");
    revalidatePath("/reports/inventory-valuation");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
