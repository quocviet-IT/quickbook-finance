import { describe, expect, it } from "vitest";
import { calculateAssetDisposal } from "@/lib/domain/fixed-assets";

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
