import { describe, it, expect } from "vitest";
import {
  matchLedgerTransactions,
  scoreLedgerMatch,
  scoreMatch,
  matchTransactions,
  type BankTxnLite,
  type LedgerMatchCandidate,
  type PaymentLite,
} from "@/lib/domain/reconciliation";

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

const ledger = (over: Partial<LedgerMatchCandidate>): LedgerMatchCandidate => ({
  journalLineId: "line-1",
  journalEntryId: "journal-1",
  entryDate: "2026-07-15",
  amountMinor: -37888,
  entryNumber: "JE-000101",
  sourceType: "expense",
  sourceId: "expense-1",
  description: "Jewelers Mutual insurance",
  reference: "POL-2026",
  ...over,
});

describe("ledger-level bank matching", () => {
  it("matches both inflows and outflows when the signed bank-account amount agrees", () => {
    const result = scoreLedgerMatch(
      txn({ amountMinor: -37888, description: "JEWELERS MUTUAL POL-2026" }),
      ledger({}),
    );
    expect(result?.score).toBeGreaterThanOrEqual(0.9);
    expect(result?.rule).toContain("reference");
  });

  it("never suggests a different amount or a candidate outside the 30-day window", () => {
    expect(scoreLedgerMatch(txn({ amountMinor: -100 }), ledger({ amountMinor: -200 }))).toBeNull();
    expect(
      scoreLedgerMatch(
        txn({ txnDate: "2026-01-01", amountMinor: -37888 }),
        ledger({ entryDate: "2026-07-15" }),
      ),
    ).toBeNull();
  });

  it("uses each journal line and each bank line at most once", () => {
    const result = matchLedgerTransactions(
      [
        txn({ id: "bank-1", amountMinor: -37888 }),
        txn({ id: "bank-2", amountMinor: -37888 }),
      ],
      [ledger({ journalLineId: "line-1" })],
    );
    expect(result).toHaveLength(1);
    expect(result[0].journalLineId).toBe("line-1");
  });
});
