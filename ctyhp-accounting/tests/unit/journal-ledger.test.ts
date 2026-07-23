import { describe, it, expect } from "vitest";
import { computeRunningBalance } from "@/lib/domain/reports";

describe("computeRunningBalance", () => {
  it("accumulates for a debit-normal account (debits add)", () => {
    const rows = computeRunningBalance(100_00, [
      { debitMinor: 50_00, creditMinor: 0 },
      { debitMinor: 0, creditMinor: 20_00 },
    ], "debit");
    expect(rows.map((r) => r.runningMinor)).toEqual([150_00, 130_00]);
  });

  it("accumulates for a credit-normal account (credits add)", () => {
    const rows = computeRunningBalance(100_00, [
      { debitMinor: 0, creditMinor: 40_00 },
      { debitMinor: 10_00, creditMinor: 0 },
    ], "credit");
    expect(rows.map((r) => r.runningMinor)).toEqual([140_00, 130_00]);
  });
});
