import { describe, expect, it } from "vitest";
import { dayBefore, fiscalMonths, fiscalYearForDate } from "@/lib/domain/fiscal";

describe("fiscal calendar", () => {
  it("builds twelve periods across calendar years", () => {
    const months = fiscalMonths(2026, 7);
    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({ period: 1, start: "2026-07-01", end: "2026-07-31" });
    expect(months[11]).toMatchObject({ period: 12, start: "2027-06-01", end: "2027-06-30" });
  });

  it("assigns dates and computes the previous day at year boundaries", () => {
    expect(fiscalYearForDate("2027-05-15", 7)).toBe(2026);
    expect(fiscalYearForDate("2027-07-01", 7)).toBe(2027);
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
  });
});
