import { describe, it, expect } from "vitest";
import { scoreMatch, matchTransactions, type BankTxnLite, type PaymentLite } from "@/lib/domain/reconciliation";

const txn = (over: Partial<BankTxnLite>): BankTxnLite => ({
  id: "t1", txnDate: "2026-07-15", amountMinor: 37888, description: "", reference: null, ...over,
});
const pay = (over: Partial<PaymentLite>): PaymentLite => ({
  id: "p1", paymentDate: "2026-07-15", amountMinor: 37888, number: "PMT-000001", customerName: "Acme", ...over,
});

describe("scoreMatch", () => {
  it("returns null when amounts differ", () => {
    expect(scoreMatch(txn({ amountMinor: 100 }), pay({ amountMinor: 200 }))).toBeNull();
  });

  it("returns null for outgoing money", () => {
    expect(scoreMatch(txn({ amountMinor: -37888 }), pay({}))).toBeNull();
  });

  it("scores higher with reference and close date", () => {
    const withRef = scoreMatch(txn({ description: "Wire PMT-000001" }), pay({}))!;
    const withoutRef = scoreMatch(txn({ description: "Wire transfer" }), pay({ customerName: "Zzz" }))!;
    expect(withRef.score).toBeGreaterThan(withoutRef.score);
    expect(withRef.score).toBeGreaterThanOrEqual(0.9);
  });

  it("returns null when dates are far apart", () => {
    expect(scoreMatch(txn({ txnDate: "2026-01-01" }), pay({ paymentDate: "2026-07-15" }))).toBeNull();
  });

  it("credits a customer-name match in the description", () => {
    const m = scoreMatch(txn({ description: "Deposit from Acme Corp", reference: null }), pay({ number: "X", customerName: "Acme" }))!;
    expect(m.rule).toContain("customer");
  });
});

describe("matchTransactions", () => {
  it("assigns each payment at most once (greedy)", () => {
    const txns = [txn({ id: "t1", description: "PMT-000001" }), txn({ id: "t2", description: "PMT-000001" })];
    const payments = [pay({ id: "p1", number: "PMT-000001" })];
    const res = matchTransactions(txns, payments);
    expect(res).toHaveLength(1);
    expect(res[0].paymentId).toBe("p1");
  });

  it("matches two distinct pairs", () => {
    const txns = [
      txn({ id: "t1", amountMinor: 100, description: "PMT-000001" }),
      txn({ id: "t2", amountMinor: 200, description: "PMT-000002" }),
    ];
    const payments = [
      pay({ id: "p1", amountMinor: 100, number: "PMT-000001" }),
      pay({ id: "p2", amountMinor: 200, number: "PMT-000002" }),
    ];
    const res = matchTransactions(txns, payments);
    expect(res).toHaveLength(2);
  });
});
