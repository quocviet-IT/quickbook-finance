import { describe, it, expect } from "vitest";
import { summarizeSalesTaxLiability } from "@/lib/domain/salestax";

const collected = [
  { taxCodeId: "a", code: "TAX", name: "Sales Tax", ratePercent: 8.25, taxableMinor: 100_00, taxMinor: 8_25 },
  { taxCodeId: "b", code: "TAX2", name: "City Tax", ratePercent: 2, taxableMinor: 50_00, taxMinor: 1_00 },
];

describe("summarizeSalesTaxLiability", () => {
  it("sums tax collected across codes and passes through payments and net", () => {
    const r = summarizeSalesTaxLiability({ collected, paymentsMinor: 3_00, netBalanceMinor: 6_25 });
    expect(r.totalTaxCollectedMinor).toBe(9_25);
    expect(r.paymentsMinor).toBe(3_00);
    expect(r.netOwedMinor).toBe(6_25);
    expect(r.lines).toHaveLength(2);
  });

  it("handles an empty period", () => {
    const r = summarizeSalesTaxLiability({ collected: [], paymentsMinor: 0, netBalanceMinor: 0 });
    expect(r.totalTaxCollectedMinor).toBe(0);
    expect(r.netOwedMinor).toBe(0);
    expect(r.lines).toEqual([]);
  });
});
