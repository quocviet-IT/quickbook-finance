import { describe, expect, it } from "vitest";
import { paymentVoidSchema } from "@/lib/domain/schemas";
import { paymentReplacementDraft } from "@/lib/domain/payment-void";

const id = "11111111-1111-4111-8111-111111111111";

describe("paymentVoidSchema", () => {
  it("trims and accepts an attributable void reason", () => {
    expect(paymentVoidSchema.parse({ payment_id: id, reason: "  Demo entered twice  " })).toEqual({
      payment_id: id,
      reason: "Demo entered twice",
    });
  });

  it("rejects an invalid id, a blank reason, and more than 500 characters", () => {
    expect(paymentVoidSchema.safeParse({ payment_id: "bad", reason: "duplicate" }).success).toBe(
      false,
    );
    expect(paymentVoidSchema.safeParse({ payment_id: id, reason: "   " }).success).toBe(false);
    expect(paymentVoidSchema.safeParse({ payment_id: id, reason: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(paymentVoidSchema.safeParse({ payment_id: id, reason: "x".repeat(500) }).success).toBe(
      true,
    );
  });
});

describe("paymentReplacementDraft", () => {
  it("prefills source facts in major units without carrying allocations", () => {
    expect(
      paymentReplacementDraft(
        {
          customer_id: "22222222-2222-4222-8222-222222222222",
          payment_date: "2026-08-04",
          currency_code: "USD",
          amount_minor: 12550,
          deposit_account_id: "33333333-3333-4333-8333-333333333333",
          method: "check",
          reference: "CHK-104",
          memo: "Replacement source",
        },
        2,
      ),
    ).toEqual({
      customer_id: "22222222-2222-4222-8222-222222222222",
      payment_date: "2026-08-04",
      currency_code: "USD",
      amount: 125.5,
      deposit_account_id: "33333333-3333-4333-8333-333333333333",
      method: "check",
      reference: "CHK-104",
      memo: "Replacement source",
    });
  });

  it("respects a currency that has no minor unit", () => {
    const draft = paymentReplacementDraft(
      {
        customer_id: "22222222-2222-4222-8222-222222222222",
        payment_date: "2026-08-04",
        currency_code: "JPY",
        amount_minor: 12550,
        deposit_account_id: "33333333-3333-4333-8333-333333333333",
        method: null,
        reference: null,
        memo: null,
      },
      0,
    );
    expect(draft.amount).toBe(12550);
    expect(draft.method).toBeNull();
  });
});
