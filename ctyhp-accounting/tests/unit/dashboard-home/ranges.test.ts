import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/access", () => ({ searchAudit: vi.fn() }));

import {
  booksBehind,
  comparablePriorMonth,
  homeMonthRanges,
  homePeriodRanges,
  monthYearLabel,
  monthsAfter,
} from "@/lib/domain/dashboard-home/ranges";
import { comparablePreviousMonthRange, trailingMonthRanges } from "@/lib/services/dashboard";

describe("homePeriodRanges", () => {
  it("speaks of the month to date, last month, the quarter and the fiscal year, each with its comparison", () => {
    expect(homePeriodRanges("2026-11-13", 1)).toEqual({
      month: {
        from: "2026-11-01",
        to: "2026-11-13",
        priorFrom: "2026-10-01",
        priorTo: "2026-10-13",
        label: "This month",
        compareLabel: "vs same days in Oct",
      },
      lastMonth: {
        from: "2026-10-01",
        to: "2026-10-31",
        priorFrom: "2026-09-01",
        priorTo: "2026-09-30",
        label: "Last month",
        compareLabel: "vs Sep 2026",
      },
      quarter: {
        from: "2026-10-01",
        to: "2026-11-13",
        // 43 days after October 1 is August 13.
        priorFrom: "2026-07-01",
        priorTo: "2026-08-13",
        label: "This quarter",
        compareLabel: "vs same days last quarter",
      },
      year: {
        from: "2026-01-01",
        to: "2026-11-13",
        priorFrom: "2025-01-01",
        priorTo: "2025-11-13",
        label: "This year",
        compareLabel: "vs same days last year",
      },
    });
  });

  it("holds the same days to the shorter month at a month end", () => {
    const ranges = homePeriodRanges("2026-03-31", 1);
    expect([ranges.month.priorFrom, ranges.month.priorTo]).toEqual(["2026-02-01", "2026-02-28"]);
    expect([ranges.lastMonth.from, ranges.lastMonth.to]).toEqual(["2026-02-01", "2026-02-28"]);
    expect([ranges.lastMonth.priorFrom, ranges.lastMonth.priorTo]).toEqual(["2026-01-01", "2026-01-31"]);
  });

  it("counts a leap day: February 29 compares with January 29, and a leap year's last day clamps last year", () => {
    const leap = homePeriodRanges("2028-02-29", 1);
    expect([leap.month.priorFrom, leap.month.priorTo]).toEqual(["2028-01-01", "2028-01-29"]);
    expect([leap.lastMonth.from, leap.lastMonth.to]).toEqual(["2028-01-01", "2028-01-31"]);
    // March 31 of a leap year: February has 29 days.
    expect(homePeriodRanges("2028-03-31", 1).month.priorTo).toBe("2028-02-29");
    // December 31, 2028 is day 366: the previous year has only 365, so it stops on its last day.
    const end = homePeriodRanges("2028-12-31", 1).year;
    expect([end.priorFrom, end.priorTo]).toEqual(["2027-01-01", "2027-12-31"]);
  });

  it("reaches back across the new year in January", () => {
    const ranges = homePeriodRanges("2027-01-20", 1);
    expect(ranges.month).toMatchObject({ priorFrom: "2026-12-01", priorTo: "2026-12-20", compareLabel: "vs same days in Dec" });
    expect(ranges.lastMonth).toMatchObject({ from: "2026-12-01", to: "2026-12-31", priorFrom: "2026-11-01", compareLabel: "vs Nov 2026" });
    expect(ranges.quarter).toMatchObject({ from: "2027-01-01", priorFrom: "2026-10-01", priorTo: "2026-10-20" });
    expect(ranges.year).toMatchObject({ from: "2027-01-01", priorFrom: "2026-01-01", priorTo: "2026-01-20" });
  });

  it("holds a long quarter's days to a shorter prior quarter", () => {
    // June 30 is day 91 of Q2 (April 1 + 90); Q1 2026 has only 90 days.
    const quarter = homePeriodRanges("2026-06-30", 1).quarter;
    expect(quarter).toMatchObject({ from: "2026-04-01", priorFrom: "2026-01-01", priorTo: "2026-03-31" });
  });

  it("runs the year from the fiscal year's first day when it starts in July", () => {
    const after = homePeriodRanges("2026-11-13", 7).year;
    expect(after).toMatchObject({ from: "2026-07-01", to: "2026-11-13", priorFrom: "2025-07-01", priorTo: "2025-11-13" });
    // Before July the fiscal year began the previous July.
    const before = homePeriodRanges("2026-03-10", 7).year;
    expect(before).toMatchObject({ from: "2025-07-01", priorFrom: "2024-07-01", priorTo: "2025-03-10" });
    // The quarter stays a calendar quarter whatever the fiscal year.
    expect(homePeriodRanges("2026-11-13", 7).quarter.from).toBe("2026-10-01");
  });
});

describe("the month the dashboard compares with", () => {
  it("agrees with comparablePreviousMonthRange, which the old dashboard and its tests use", () => {
    for (const asOf of ["2026-07-25", "2026-03-31", "2028-03-31", "2026-01-31", "2026-11-13", "2026-12-01", "2028-02-29"]) {
      const old = comparablePreviousMonthRange(asOf);
      expect(comparablePriorMonth(asOf)).toEqual({ from: old.from, to: old.to });
    }
  });
});

describe("homeMonthRanges", () => {
  it("gives the same months as trailingMonthRanges, with the year", () => {
    for (const asOf of ["2026-07-25", "2026-01-05", "2026-11-13"]) {
      const months = homeMonthRanges(asOf, 6);
      expect(months.map(({ key, label, from, to }) => ({ key, label, from, to }))).toEqual(trailingMonthRanges(asOf, 6));
    }
    expect(homeMonthRanges("2026-02-10", 3).map((m) => [m.key, m.year])).toEqual([
      ["2025-12", 2025],
      ["2026-01", 2026],
      ["2026-02", 2026],
    ]);
  });
});

describe("how far behind the books are", () => {
  it("is behind when the last posted day is before the first day of the previous month", () => {
    expect(booksBehind("2026-09-30", "2026-11-13")).toBe(true);
    expect(booksBehind("2026-10-01", "2026-11-13")).toBe(false);
    expect(booksBehind("2026-11-12", "2026-11-13")).toBe(false);
    expect(booksBehind(null, "2026-11-13")).toBe(false);
  });

  it("lists the months after the last posted one, through asOf's month", () => {
    expect(monthsAfter("2026-09-30", "2026-11-13")).toEqual(["2026-10", "2026-11"]);
    expect(monthsAfter("2026-11-02", "2026-11-13")).toEqual([]);
    expect(monthsAfter("2025-12-15", "2026-02-01")).toEqual(["2026-01", "2026-02"]);
    expect(monthsAfter(null, "2026-11-13")).toEqual([]);
  });

  it("names a month with its year from a date or a key", () => {
    expect(monthYearLabel("2026-09-30")).toBe("September 2026");
    expect(monthYearLabel("2027-01")).toBe("January 2027");
  });
});
