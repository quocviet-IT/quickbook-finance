import { describe, it, expect } from "vitest";
import { itemCreateSchema } from "@/lib/domain/schemas";

const ok = {
  name: "Consulting",
  is_sold: true,
  sales_price_minor: 15000,
  income_account_id: "11111111-1111-1111-8111-111111111111",
  is_purchased: false,
};

describe("itemCreateSchema", () => {
  it("accepts a valid sales-only item", () => {
    expect(itemCreateSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects an item with neither side enabled", () => {
    const r = itemCreateSchema.safeParse({ ...ok, is_sold: false, is_purchased: false });
    expect(r.success).toBe(false);
  });

  it("requires an income account when sold", () => {
    const r = itemCreateSchema.safeParse({ ...ok, income_account_id: undefined });
    expect(r.success).toBe(false);
  });

  it("requires an expense account when purchased", () => {
    const r = itemCreateSchema.safeParse({
      ...ok,
      is_purchased: true,
      purchase_cost_minor: 9000,
      expense_account_id: undefined,
    });
    expect(r.success).toBe(false);
  });
});
