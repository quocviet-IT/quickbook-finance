import { describe, expect, it } from "vitest";
import {
  applyMovement,
  costOfSaleMinor,
  inventoryTiesOut,
  weightedAverageCostMinor,
} from "@/lib/domain/inventory";
import { itemCreateSchema } from "@/lib/domain/schemas";

describe("weightedAverageCostMinor", () => {
  it("is zero when nothing is on hand", () => {
    expect(weightedAverageCostMinor(0, 0)).toBe(0);
  });

  it("averages a whole cost", () => {
    expect(weightedAverageCostMinor(10, 12500)).toBe(1250); // 10 @ $12.50
  });

  it("averages two receipts at different costs", () => {
    // 10 @ 12.50 = 125.00 then 10 @ 15.00 = 150.00 -> 20 units, 275.00
    expect(weightedAverageCostMinor(20, 27500)).toBe(1375);
  });

  it("rounds the average half away from zero", () => {
    expect(weightedAverageCostMinor(3, 1000)).toBe(333); // 333.33 -> 333
    expect(weightedAverageCostMinor(3, 1001)).toBe(334); // 333.67 -> 334
  });

  it("handles a fractional quantity", () => {
    expect(weightedAverageCostMinor(2.5, 1000)).toBe(400);
  });
});

describe("costOfSaleMinor", () => {
  it("costs a partial sale at the average", () => {
    expect(costOfSaleMinor(20, 27500, 4)).toBe(5500); // 4 @ 13.75
  });

  it("relieves the entire remaining value when the sale empties the stock", () => {
    // 3 units at 10.00 total: WAC 333, but 3 x 333 = 999 != 1000.
    expect(costOfSaleMinor(3, 1000, 3)).toBe(1000);
  });

  it("is zero when the stock has no value", () => {
    expect(costOfSaleMinor(5, 0, 2)).toBe(0);
  });

  it("refuses to sell more than is on hand", () => {
    expect(() => costOfSaleMinor(5, 5000, 6)).toThrow(/Insufficient inventory/);
  });

  it("allows selling exactly what is on hand", () => {
    expect(costOfSaleMinor(5, 5000, 5)).toBe(5000);
  });

  it("rejects a non-positive sale quantity", () => {
    expect(() => costOfSaleMinor(5, 5000, 0)).toThrow();
  });
});

describe("applyMovement", () => {
  it("accumulates a receipt", () => {
    expect(applyMovement({ qty: 0, valueMinor: 0 }, { qtyDelta: 10, costDeltaMinor: 12500 })).toEqual({
      qty: 10,
      valueMinor: 12500,
    });
  });

  it("applies a bill price variance as value only", () => {
    expect(applyMovement({ qty: 10, valueMinor: 12500 }, { qtyDelta: 0, costDeltaMinor: 500 })).toEqual({
      qty: 10,
      valueMinor: 13000,
    });
  });

  it("applies a sale", () => {
    expect(applyMovement({ qty: 10, valueMinor: 13000 }, { qtyDelta: -4, costDeltaMinor: -5200 })).toEqual({
      qty: 6,
      valueMinor: 7800,
    });
  });

  it("leaves zero value when the last unit leaves", () => {
    expect(applyMovement({ qty: 6, valueMinor: 7800 }, { qtyDelta: -6, costDeltaMinor: -7800 })).toEqual({
      qty: 0,
      valueMinor: 0,
    });
  });

  it("refuses a movement that would make the quantity negative", () => {
    expect(() =>
      applyMovement({ qty: 2, valueMinor: 2600 }, { qtyDelta: -3, costDeltaMinor: -3900 }),
    ).toThrow(/Insufficient inventory/);
  });
});

describe("inventoryTiesOut", () => {
  it("ties when the subledger equals the control account", () => {
    expect(inventoryTiesOut(13000, 13000)).toBe(true);
  });

  it("does not tie on any difference", () => {
    expect(inventoryTiesOut(13000, 12999)).toBe(false);
  });
});

describe("itemCreateSchema inventory rules", () => {
  const base = {
    name: "Gold ring",
    description: "",
    is_sold: true,
    sales_price_minor: 50000,
    income_account_id: "11111111-1111-4111-8111-111111111111",
    is_purchased: true,
    purchase_cost_minor: 30000,
    expense_account_id: "22222222-2222-4222-8222-222222222222",
  };

  it("accepts an inventory item with both accounts", () => {
    const r = itemCreateSchema.safeParse({
      ...base,
      is_inventory: true,
      inventory_account_id: "33333333-3333-4333-8333-333333333333",
      cogs_account_id: "44444444-4444-4444-8444-444444444444",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an inventory item with no inventory account", () => {
    const r = itemCreateSchema.safeParse({
      ...base,
      is_inventory: true,
      cogs_account_id: "44444444-4444-4444-8444-444444444444",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an inventory item with no COGS account", () => {
    const r = itemCreateSchema.safeParse({
      ...base,
      is_inventory: true,
      inventory_account_id: "33333333-3333-4333-8333-333333333333",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an inventory item that is not purchased", () => {
    const r = itemCreateSchema.safeParse({
      ...base,
      is_purchased: false,
      expense_account_id: null,
      is_inventory: true,
      inventory_account_id: "33333333-3333-4333-8333-333333333333",
      cogs_account_id: "44444444-4444-4444-8444-444444444444",
    });
    expect(r.success).toBe(false);
  });

  it("still accepts a plain non-inventory item", () => {
    expect(itemCreateSchema.safeParse(base).success).toBe(true);
  });
});
