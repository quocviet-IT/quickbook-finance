import { describe, it, expect } from "vitest";
import { computeAgeing, bucketOf } from "@/lib/domain/ageing";

describe("bucketOf", () => {
  it("classifies by days past due relative to as-of", () => {
    expect(bucketOf("2026-07-23", "2026-07-23")).toBe("current"); // due today
    expect(bucketOf("2026-07-24", "2026-07-23")).toBe("current"); // not yet due
    expect(bucketOf("2026-07-22", "2026-07-23")).toBe("d1_30");   // 1 day
    expect(bucketOf("2026-06-23", "2026-07-23")).toBe("d1_30");   // 30 days
    expect(bucketOf("2026-06-22", "2026-07-23")).toBe("d31_60");  // 31 days
    expect(bucketOf("2026-04-23", "2026-07-23")).toBe("d90_plus");// 91 days
  });
});

describe("computeAgeing", () => {
  it("sums balances into buckets and totals (credits are negative in current)", () => {
    const r = computeAgeing([
      { dueDate: "2026-07-23", balanceMinor: 100_00 },  // current
      { dueDate: "2026-06-01", balanceMinor: 50_00 },   // 31-60
      { dueDate: "2026-07-24", balanceMinor: -20_00 },  // current credit
    ], "2026-07-23");
    expect(r.buckets.current).toBe(80_00);
    expect(r.buckets.d31_60).toBe(50_00);
    expect(r.total).toBe(130_00);
  });
});
