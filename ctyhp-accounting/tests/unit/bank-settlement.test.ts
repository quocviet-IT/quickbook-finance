import { describe, expect, it } from "vitest";
import {
  allocationFits,
  rankSettlementCandidates,
  settlementDirection,
  type SettlementCandidate,
} from "@/lib/domain/bank-settlement";

const doc = (over: Partial<SettlementCandidate> = {}): SettlementCandidate => ({
  documentId: "d1",
  documentNumber: "INV-0001",
  documentDate: "2026-07-10",
  balanceDueMinor: 50_000,
  currencyCode: "USD",
  ...over,
});

describe("settlementDirection", () => {
  it("reads money in as a customer receipt", () => {
    expect(settlementDirection(25_000)).toBe("receivable");
  });

  it("reads money out as a bill payment", () => {
    expect(settlementDirection(-25_000)).toBe("payable");
  });

  it("refuses a zero line, which settles nothing", () => {
    expect(settlementDirection(0)).toBeNull();
  });
});

describe("rankSettlementCandidates", () => {
  it("puts an exact balance match first", () => {
    const ranked = rankSettlementCandidates(50_000, "2026-07-12", "USD", [
      doc({ documentId: "near", balanceDueMinor: 49_000 }),
      doc({ documentId: "exact", balanceDueMinor: 50_000 }),
    ]);
    expect(ranked[0].candidate.documentId).toBe("exact");
    expect(ranked[0].exactAmount).toBe(true);
  });

  it("prefers the nearer date when two balances match exactly", () => {
    const ranked = rankSettlementCandidates(50_000, "2026-07-12", "USD", [
      doc({ documentId: "far", documentDate: "2026-01-01" }),
      doc({ documentId: "near", documentDate: "2026-07-10" }),
    ]);
    expect(ranked.map((r) => r.candidate.documentId)).toEqual(["near", "far"]);
  });

  it("compares the bank amount by size, so money out still matches a bill", () => {
    const ranked = rankSettlementCandidates(-50_000, "2026-07-12", "USD", [doc({ documentId: "bill" })]);
    expect(ranked[0].exactAmount).toBe(true);
  });

  it("drops a document in another currency rather than converting it", () => {
    // Settling across currencies needs a rate, and a bank matcher is the wrong
    // place to invent one.
    expect(rankSettlementCandidates(50_000, "2026-07-12", "USD", [doc({ currencyCode: "EUR" })])).toEqual([]);
  });

  it("drops a document with nothing left owing", () => {
    expect(rankSettlementCandidates(50_000, "2026-07-12", "USD", [doc({ balanceDueMinor: 0 })])).toEqual([]);
  });

  it("still offers documents that do not match the amount, ranked lower", () => {
    // A bank line often pays several invoices at once, so a non-exact balance
    // is a normal choice rather than a wrong one.
    const ranked = rankSettlementCandidates(50_000, "2026-07-12", "USD", [doc({ balanceDueMinor: 12_345 })]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].exactAmount).toBe(false);
  });
});

describe("allocationFits", () => {
  it("accepts allocations that use the whole bank amount", () => {
    expect(allocationFits(50_000, [30_000, 20_000])).toBe(true);
  });

  it("accepts allocating less, which leaves the rest unapplied", () => {
    expect(allocationFits(50_000, [30_000])).toBe(true);
  });

  it("refuses allocating more than the bank actually moved", () => {
    // The bank is the authority on how much money moved; allocations cannot
    // conjure the difference.
    expect(allocationFits(50_000, [30_000, 30_000])).toBe(false);
  });

  it("compares against the size of the line, so money out behaves the same", () => {
    expect(allocationFits(-50_000, [50_000])).toBe(true);
    expect(allocationFits(-50_000, [50_001])).toBe(false);
  });

  it("refuses an empty allocation, which would settle nothing", () => {
    expect(allocationFits(50_000, [])).toBe(false);
  });

  it("refuses a zero or negative allocation on a line", () => {
    expect(allocationFits(50_000, [30_000, 0])).toBe(false);
    expect(allocationFits(50_000, [-1])).toBe(false);
  });
});
