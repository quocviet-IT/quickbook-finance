import { describe, it, expect } from "vitest";
import { computePeriods, periodLabelOf } from "@/lib/domain/periods";

describe("computePeriods", () => {
  it("January fiscal start → Jan..Dec of the same calendar year", () => {
    const p = computePeriods(1, 2026);
    expect(p).toHaveLength(12);
    expect(p[0]).toEqual({ fiscalYear: 2026, periodMonth: 1, periodStart: "2026-01-01", periodEnd: "2026-01-31", label: "2026-01" });
    expect(p[1].periodEnd).toBe("2026-02-28"); // 2026 not a leap year
    expect(p[11]).toEqual({ fiscalYear: 2026, periodMonth: 12, periodStart: "2026-12-01", periodEnd: "2026-12-31", label: "2026-12" });
  });
  it("July fiscal start → Jul 2026 .. Jun 2027", () => {
    const p = computePeriods(7, 2026);
    expect(p[0]).toEqual({ fiscalYear: 2026, periodMonth: 1, periodStart: "2026-07-01", periodEnd: "2026-07-31", label: "2026-07" });
    expect(p[6]).toEqual({ fiscalYear: 2026, periodMonth: 7, periodStart: "2027-01-01", periodEnd: "2027-01-31", label: "2027-01" });
    expect(p[11]).toEqual({ fiscalYear: 2026, periodMonth: 12, periodStart: "2027-06-01", periodEnd: "2027-06-30", label: "2027-06" });
  });
});

describe("periodLabelOf", () => {
  it("returns the calendar-month label a date falls in", () => {
    expect(periodLabelOf("2027-01-15", 7)).toBe("2027-01");
    expect(periodLabelOf("2026-07-01", 7)).toBe("2026-07");
  });
});
