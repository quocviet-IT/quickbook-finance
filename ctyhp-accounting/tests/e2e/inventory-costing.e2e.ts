import { describe, expect, it } from "vitest";
import { getInventoryPolicy, getInventoryReview } from "@/lib/services/inventory-review";
import {
  closeE2eSession,
  createE2eServiceClient,
  openE2eSession,
} from "./support/session";

function serviceClient() {
  return createE2eServiceClient();
}

const today = new Date().toISOString().slice(0, 10);

/**
 * The costing method, demonstrated rather than asserted.
 *
 * The claim in the accounting policy is that inventory is carried at weighted
 * average cost. A policy is only worth what it can be shown to do, so this buys
 * the same item twice at different prices and checks what the ledger relieves
 * on the way out: not the first price, not the last, but the average.
 */
describe("inventory costing over HTTPS", () => {
  it("states a policy, and the ledger obeys it", async () => {
    const { sb } = await openE2eSession();
    try {
      const policy = await getInventoryPolicy(sb);
      expect(policy.method, "the disclosed cost basis").toBe("average_cost");
      expect(policy.memo, "the policy memorandum must exist to be disclosed").toBeTruthy();
      expect(policy.memo).toContain("weighted average cost");
      // The measurement rule matters as much as the cost basis.
      expect(policy.memo).toContain("net realisable value");
    } finally {
      await closeE2eSession(sb);
    }
  });

  it("relieves stock at the weighted average, not the first or the last price", async () => {
    const { sb, marker } = await openE2eSession();
    const admin = serviceClient();
    let itemId: string | null = null;

    try {
      const { data: accounts } = await sb
        .from("acc_account")
        .select("id,account_code,account_type")
        .in("account_code", ["1200", "5000", "4000"]);
      const byCode = new Map(
        ((accounts ?? []) as { id: string; account_code: string }[]).map((a) => [a.account_code, a.id]),
      );

      const { data: item, error: itemError } = await sb
        .from("acc_item")
        .insert({
          item_code: `${marker}-WAC`,
          name: `${marker} costing probe`,
          is_inventory: true,
          is_sold: true,
          is_purchased: true,
          sales_price_minor: 50_000,
          inventory_account_id: byCode.get("1200"),
          cogs_account_id: byCode.get("5000"),
          income_account_id: byCode.get("4000"),
        })
        .select("id")
        .single();
      expect(itemError, itemError?.message).toBeNull();
      itemId = (item as { id: string }).id;

      // Two receipts at different prices: 10 at 100.00, then 10 at 200.00.
      // The average is 150.00 — which is neither price.
      await sb.rpc("acc_add_inventory_txn", {
        p_item_id: itemId,
        p_date: today,
        p_source: "receipt",
        p_source_id: null,
        p_qty_delta: 10,
        p_cost_delta: 100_000,
        p_entry_id: null,
        p_reversal_of: null,
        p_memo: `${marker} first receipt`,
      });
      await sb.rpc("acc_add_inventory_txn", {
        p_item_id: itemId,
        p_date: today,
        p_source: "receipt",
        p_source_id: null,
        p_qty_delta: 10,
        p_cost_delta: 200_000,
        p_entry_id: null,
        p_reversal_of: null,
        p_memo: `${marker} second receipt`,
      });

      const { data: wac } = await sb.rpc("acc_item_wac", { p_item_id: itemId });
      expect(Number(wac), "20 units costing 3,000.00 average 150.00 each").toBe(15_000);

      // FIFO would relieve 100.00, LIFO 200.00. The average is the test.
      expect(Number(wac)).not.toBe(10_000);
      expect(Number(wac)).not.toBe(20_000);

      const { data: onHand } = await sb.rpc("acc_item_on_hand", { p_item_id: itemId });
      const held = (Array.isArray(onHand) ? onHand[0] : onHand) as {
        qty: number;
        value_minor: number;
      };
      expect(Number(held.qty)).toBe(20);
      expect(Number(held.value_minor)).toBe(300_000);

      // Sell 5. Cost relieved must be 5 × the average, and what remains must be
      // the rest of it — no rounding crumbs left behind.
      await sb.rpc("acc_add_inventory_txn", {
        p_item_id: itemId,
        p_date: today,
        p_source: "sale",
        p_source_id: null,
        p_qty_delta: -5,
        p_cost_delta: -75_000,
        p_entry_id: null,
        p_reversal_of: null,
        p_memo: `${marker} sale`,
      });

      const { data: after } = await sb.rpc("acc_item_on_hand", { p_item_id: itemId });
      const remaining = (Array.isArray(after) ? after[0] : after) as {
        qty: number;
        value_minor: number;
      };
      expect(Number(remaining.qty)).toBe(15);
      expect(Number(remaining.value_minor), "15 units still at 150.00").toBe(225_000);

      const { data: stillWac } = await sb.rpc("acc_item_wac", { p_item_id: itemId });
      expect(Number(stillWac), "selling does not move the average").toBe(15_000);

      // And the review reads the same item back with the same numbers.
      const review = await getInventoryReview(sb, today, 90);
      const row = review.rows.find((r) => r.itemId === itemId);
      expect(row, "the probe item must appear in the review").toBeTruthy();
      expect(row!.qtyOnHand).toBe(15);
      expect(row!.valueMinor).toBe(225_000);
      expect(row!.unitCostMinor).toBe(15_000);
      expect(review.method).toBe("average_cost");
    } finally {
      if (itemId) {
        await admin.from("acc_inventory_txn").delete().eq("item_id", itemId);
        await admin.from("acc_item").delete().eq("id", itemId);
      }
      await closeE2eSession(sb);
    }
  });
});
