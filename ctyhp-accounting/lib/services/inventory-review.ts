import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildInventoryReview,
  type InventoryReview,
  type InventoryReviewRow,
} from "@/lib/domain/inventory-review";

export class InventoryReviewError extends Error {}

export interface InventoryPolicy {
  method: string;
  memo: string | null;
  effectiveFrom: string;
}

/**
 * The inventory accounting policy in force.
 *
 * Every report that states a cost has to be able to say which basis it is on,
 * so this is read alongside the numbers rather than assumed.
 */
export async function getInventoryPolicy(sb: SupabaseClient): Promise<InventoryPolicy> {
  const { data, error } = await sb.rpc("acc_inventory_policy");
  if (error) throw new InventoryReviewError(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  return {
    method: (row?.method as string) ?? "average_cost",
    memo: (row?.memo as string | null) ?? null,
    effectiveFrom: (row?.effective_from as string) ?? "",
  };
}

/**
 * Stock reviewed for obsolescence and slow movement, as of a date.
 *
 * The database reports the facts; what counts as slow, stale or carried above
 * value is decided in lib/domain/inventory-review.ts, where the tests are.
 */
export async function getInventoryReview(
  sb: SupabaseClient,
  asOf: string,
  windowDays = 90,
): Promise<InventoryReview> {
  const [{ data, error }, policy] = await Promise.all([
    sb.rpc("acc_inventory_review", { p_as_of: asOf, p_window_days: windowDays }),
    getInventoryPolicy(sb),
  ]);
  if (error) throw new InventoryReviewError(error.message);

  const rows: InventoryReviewRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    itemId: r.item_id as string,
    itemCode: (r.item_code as string | null) ?? null,
    name: r.name as string,
    qtyOnHand: Number(r.qty_on_hand),
    valueMinor: Number(r.value_minor),
    unitCostMinor: Number(r.unit_cost_minor),
    salesPriceMinor: r.sales_price_minor === null ? null : Number(r.sales_price_minor),
    lastMovementOn: (r.last_movement_on as string | null) ?? null,
    lastSaleOn: (r.last_sale_on as string | null) ?? null,
    qtySoldInWindow: Number(r.qty_sold_in_window ?? 0),
    writtenDownMinor: Number(r.written_down_minor ?? 0),
  }));

  return buildInventoryReview(rows, asOf, windowDays, policy.method);
}

/**
 * Write an item down to net realisable value.
 *
 * One-way by design: ASC 330-10-35-14 forbids writing inventory back up, and
 * the database refuses an attempt rather than trusting anyone to remember.
 */
export async function writeDownInventory(
  sb: SupabaseClient,
  input: { itemId: string; date: string; nrvMinor: number; reason: string },
): Promise<string> {
  const { data, error } = await sb.rpc("acc_write_down_inventory", {
    p_item_id: input.itemId,
    p_date: input.date,
    p_nrv_minor: input.nrvMinor,
    p_reason: input.reason,
  });
  if (error) throw new InventoryReviewError(error.message);
  return data as string;
}
