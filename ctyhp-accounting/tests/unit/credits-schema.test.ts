import { describe, it, expect } from "vitest";
import { creditMemoCreateSchema, customerRefundSchema, writeOffSchema } from "@/lib/domain/schemas";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("creditMemoCreateSchema", () => {
  it("accepts a one-line memo", () => {
    expect(creditMemoCreateSchema.safeParse({
      customer_id: uuid, currency_code: "USD",
      lines: [{ description: "x", quantity: 1, unit_price_minor: 1000, income_account_id: uuid }],
    }).success).toBe(true);
  });
  it("rejects zero lines", () => {
    expect(creditMemoCreateSchema.safeParse({ customer_id: uuid, currency_code: "USD", lines: [] }).success).toBe(false);
  });
});

describe("customerRefundSchema", () => {
  it("requires exactly one source", () => {
    const base = { customer_id: uuid, currency_code: "USD", amount_minor: 100, bank_account_id: uuid };
    expect(customerRefundSchema.safeParse({ ...base, source_type: "payment", payment_id: uuid }).success).toBe(true);
    expect(customerRefundSchema.safeParse({ ...base, source_type: "payment" }).success).toBe(false);
    expect(customerRefundSchema.safeParse({ ...base, source_type: "credit_memo", payment_id: uuid, credit_memo_id: uuid }).success).toBe(false);
  });
});

describe("writeOffSchema", () => {
  it("requires a reason and a target matching the side", () => {
    const base = { offset_account_id: uuid, amount_minor: 100, reason: "bad debt" };
    expect(writeOffSchema.safeParse({ ...base, side: "ar", invoice_id: uuid }).success).toBe(true);
    expect(writeOffSchema.safeParse({ ...base, side: "ar" }).success).toBe(false);
    expect(writeOffSchema.safeParse({ side: "ar", invoice_id: uuid, offset_account_id: uuid, amount_minor: 100, reason: "" }).success).toBe(false);
  });
});
