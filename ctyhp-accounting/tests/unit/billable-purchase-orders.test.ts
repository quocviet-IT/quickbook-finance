import { describe, expect, it } from "vitest";
import { billablePurchaseOrders } from "@/lib/domain/purchasing";

// The full shapes the callers actually hand over: acc_received_not_billed rows
// and purchase order rows. The domain function reads only part of each, and
// these fixtures carry the rest so the test exercises what production passes.
interface RnbFixture {
  purchase_order_id: string;
  purchase_order_line_id: string;
  po_number: string | null;
  vendor_name: string;
  order_date: string;
  description: string;
  qty_outstanding: number;
  unit_cost_minor: number;
  value_minor: number;
  currency_code: string;
}
interface PoFixture {
  id: string;
  vendor_id: string;
  po_number: string | null;
  currency_code: string;
}

const rnb = (over: Partial<RnbFixture> = {}): RnbFixture => ({
  purchase_order_id: "po-1",
  purchase_order_line_id: "line-1",
  po_number: "PO-0001",
  vendor_name: "Pacific Stone Supply",
  order_date: "2026-07-01",
  description: "Slate slab",
  qty_outstanding: 2,
  unit_cost_minor: 25_000,
  value_minor: 50_000,
  currency_code: "USD",
  ...over,
});

const po = (over: Partial<PoFixture> = {}): PoFixture => ({
  id: "po-1",
  vendor_id: "v-1",
  po_number: "PO-0001",
  currency_code: "USD",
  ...over,
});

describe("billablePurchaseOrders", () => {
  it("attaches the vendor the received-not-billed row does not carry", () => {
    // acc_received_not_billed reports vendor_name only, and a name is not an
    // identity — two vendors may share one. The purchase order is what ties a
    // billable line to a vendor id.
    const [row] = billablePurchaseOrders([rnb({})], [po({})]);
    expect(row.vendorId).toBe("v-1");
    expect(row.purchaseOrderId).toBe("po-1");
    expect(row.poNumber).toBe("PO-0001");
  });

  it("rolls every outstanding line of one order into a single choice", () => {
    const rows = billablePurchaseOrders(
      [
        rnb({ purchase_order_line_id: "line-1", value_minor: 50_000 }),
        rnb({ purchase_order_line_id: "line-2", value_minor: 30_000 }),
      ],
      [po({})],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lineCount).toBe(2);
    expect(rows[0].valueMinor).toBe(80_000);
  });

  it("keeps orders apart even when they belong to the same vendor", () => {
    const rows = billablePurchaseOrders(
      [rnb({ purchase_order_id: "po-1" }), rnb({ purchase_order_id: "po-2", po_number: "PO-0002" })],
      [po({}), po({ id: "po-2", po_number: "PO-0002" })],
    );
    expect(rows.map((r) => r.purchaseOrderId)).toEqual(["po-1", "po-2"]);
  });

  it("drops a billable line whose order it cannot identify", () => {
    // Better to omit a choice than to offer one that opens the wrong document.
    expect(billablePurchaseOrders([rnb({ purchase_order_id: "po-ghost" })], [po({})])).toEqual([]);
  });

  it("orders the newest first, so the order just received is at the top", () => {
    const rows = billablePurchaseOrders(
      [
        rnb({ purchase_order_id: "po-1", order_date: "2026-07-01" }),
        rnb({ purchase_order_id: "po-2", order_date: "2026-07-20", po_number: "PO-0002" }),
      ],
      [po({}), po({ id: "po-2", po_number: "PO-0002" })],
    );
    expect(rows.map((r) => r.poNumber)).toEqual(["PO-0002", "PO-0001"]);
  });

  it("is empty when nothing has been received against an order", () => {
    expect(billablePurchaseOrders([], [po({})])).toEqual([]);
  });
});
