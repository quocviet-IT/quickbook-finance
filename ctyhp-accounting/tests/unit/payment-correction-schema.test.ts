import { describe, expect, it } from "vitest";
import { paymentCorrectionSchema, paymentDetailsSchema } from "@/lib/domain/schemas";

const id = "11111111-1111-4111-8111-111111111111";
const customer = "22222222-2222-4222-8222-222222222222";
const account = "33333333-3333-4333-8333-333333333333";

describe("paymentDetailsSchema", () => {
  it("trims the three description fields and keeps empty ones null", () => {
    expect(
      paymentDetailsSchema.parse({
        payment_id: id,
        method: "  check  ",
        reference: "",
        memo: "  Deposited Monday  ",
      }),
    ).toEqual({ payment_id: id, method: "check", reference: null, memo: "Deposited Monday" });
  });

  it("accepts an explicit null and rejects over-long values", () => {
    expect(
      paymentDetailsSchema.parse({ payment_id: id, method: null, reference: null, memo: null }),
    ).toEqual({ payment_id: id, method: null, reference: null, memo: null });
    expect(paymentDetailsSchema.safeParse({ payment_id: id, method: "x".repeat(61) }).success).toBe(
      false,
    );
    expect(
      paymentDetailsSchema.safeParse({ payment_id: id, reference: "x".repeat(81) }).success,
    ).toBe(false);
    expect(paymentDetailsSchema.safeParse({ payment_id: id, memo: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(paymentDetailsSchema.safeParse({ payment_id: "bad" }).success).toBe(false);
  });
});

describe("paymentCorrectionSchema", () => {
  const base = {
    payment_id: id,
    reason: "  Wrong customer  ",
    customer_id: customer,
    currency_code: "USD",
    amount_minor: 12550,
    deposit_account_id: account,
    allocations: [],
  };

  it("carries every receipt field plus the payment being corrected", () => {
    const parsed = paymentCorrectionSchema.parse(base);
    expect(parsed.payment_id).toBe(id);
    expect(parsed.reason).toBe("Wrong customer");
    expect(parsed.amount_minor).toBe(12550);
    expect(parsed.allocations).toEqual([]);
  });

  it("requires a reason the same way voiding does", () => {
    expect(paymentCorrectionSchema.safeParse({ ...base, reason: "   " }).success).toBe(false);
    expect(paymentCorrectionSchema.safeParse({ ...base, reason: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(paymentCorrectionSchema.safeParse({ ...base, amount_minor: 0 }).success).toBe(false);
  });
});
