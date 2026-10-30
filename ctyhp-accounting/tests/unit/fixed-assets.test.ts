import { describe, expect, it } from "vitest";
import {
  calculateAssetDisposal,
  decliningBalancePreview,
  decliningBalanceSchedule,
  DEPRECIATION_METHOD_OPTIONS,
  depreciates,
} from "@/lib/domain/fixed-assets";

describe("calculateAssetDisposal", () => {
  it("calculates a gain from net proceeds above net book value", () => {
    expect(calculateAssetDisposal(100_000, 70_000, 40_000, 2_000)).toEqual({
      netBookValueMinor: 30_000,
      netProceedsMinor: 38_000,
      gainLossMinor: 8_000,
    });
  });

  it("calculates a loss from net proceeds below net book value", () => {
    expect(calculateAssetDisposal(100_000, 25_000, 50_000, 5_000)).toEqual({
      netBookValueMinor: 75_000,
      netProceedsMinor: 45_000,
      gainLossMinor: -30_000,
    });
  });

  it("supports retirement with no proceeds", () => {
    expect(calculateAssetDisposal(25_000, 25_000, 0, 0)).toEqual({
      netBookValueMinor: 0,
      netProceedsMinor: 0,
      gainLossMinor: 0,
    });
  });
});

describe("declining balance (2.85)", () => {
  it("charges twice the straight-line rate on what is left, then switches to straight-line, and ends at salvage", () => {
    // $10,000.00 over 60 months, $1,000.00 salvage.
    const charges = decliningBalanceSchedule(1_000_000, 100_000, 60);
    expect(charges).toHaveLength(60);
    expect(charges[0]).toBe(33_333); // 2/60 of $10,000.00
    expect(charges.reduce((sum, c) => sum + c, 0)).toBe(900_000);
    // Never rising, and straight-line at the end: the last months are level.
    for (let i = 1; i < charges.length; i++) expect(charges[i]).toBeLessThanOrEqual(charges[i - 1] + 1);
    // By hand: 2/60 of what is left falls below the straight line over the months left in month 44.
    const tail = charges.slice(43);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThanOrEqual(1);
    expect(charges[42]).toBeGreaterThan(charges[43] + 1);
  });

  it("is front-loaded: the first year charges more than straight-line would", () => {
    const firstYear = decliningBalanceSchedule(1_000_000, 0, 60).slice(0, 12).reduce((sum, c) => sum + c, 0);
    expect(firstYear).toBeGreaterThan(240_000);
  });

  it("stops at salvage early rather than planning months that charge nothing", () => {
    // Salvage 95% of cost over 12 months: 2/12 of the cost is more than the 5% left to charge.
    expect(decliningBalanceSchedule(100_000, 95_000, 12)).toEqual([5_000]);
  });

  it("previews the schedule in the form, and nothing when it cannot be worked out", () => {
    const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;
    // By hand: 1/30 a month, so after 12 months $10,000.00 × (29/30)^12 ≈ $6,657 is left: about $3,343 charged.
    expect(decliningBalancePreview(1_000_000, 100_000, 60, money)).toBe(
      "First month $333.33, first 12 months $3342.34; the last charge, in month 60, leaves the salvage value of $1000.00.",
    );
    expect(decliningBalancePreview(100_000, 100_000, 12, money)).toBeNull();
    expect(decliningBalancePreview(100_000, 0, 0, money)).toBeNull();
  });

  it("is offered beside straight-line, and both depreciate", () => {
    expect(DEPRECIATION_METHOD_OPTIONS.map((o) => o.value)).toEqual(["straight_line", "declining_balance", "none"]);
    expect(["straight_line", "declining_balance", "none", undefined].map(depreciates)).toEqual([true, true, false, false]);
  });
});
