import { describe, expect, it } from "vitest";
import { longDate, presetRange, rangeText, shortDate, PERIOD_PRESETS, type PresetContext } from "@/lib/domain/report-presets";

const ctx = (over: Partial<PresetContext> = {}): PresetContext => ({
  today: "2026-09-26",
  fiscalStartMonth: 1,
  firstEntryDate: "2022-12-31",
  lastEntryDate: "2026-09-20",
  ...over,
});

describe("PERIOD_PRESETS", () => {
  it("offers the prototype's seven choices, in its order", () => {
    expect(PERIOD_PRESETS.map((p) => p.label)).toEqual([
      "This month",
      "This quarter",
      "This year",
      "Last 3 years",
      "Last 5 years",
      "All dates",
      "Custom",
    ]);
  });
});

describe("presetRange", () => {
  it("runs this month from its first day to today", () => {
    expect(presetRange("month", ctx())).toEqual({ from: "2026-09-01", to: "2026-09-26" });
  });

  it("runs this quarter from the quarter's first day to today", () => {
    expect(presetRange("quarter", ctx())).toEqual({ from: "2026-07-01", to: "2026-09-26" });
    expect(presetRange("quarter", ctx({ today: "2026-02-10" }))).toEqual({ from: "2026-01-01", to: "2026-02-10" });
  });

  it("reads this year as the fiscal year to date", () => {
    expect(presetRange("year", ctx())).toEqual({ from: "2026-01-01", to: "2026-09-26" });
    // A July year: on September 26 the year began July 1.
    expect(presetRange("year", ctx({ fiscalStartMonth: 7 }))).toEqual({ from: "2026-07-01", to: "2026-09-26" });
    // And in March, it began the July before.
    expect(presetRange("year", ctx({ today: "2026-03-15", fiscalStartMonth: 7 }))).toEqual({
      from: "2025-07-01",
      to: "2026-03-15",
    });
  });

  it("anchors the multi-year presets on the latest year with entries", () => {
    // A book whose last entry is in 2024: the last three years are its last three.
    expect(presetRange("last3", ctx({ lastEntryDate: "2024-05-31" }))).toEqual({
      from: "2022-01-01",
      to: "2024-12-31",
    });
    expect(presetRange("last5", ctx({ lastEntryDate: "2024-05-31" }))).toEqual({
      from: "2020-01-01",
      to: "2024-12-31",
    });
  });

  it("stops the multi-year presets at today when the anchor year is this one", () => {
    expect(presetRange("last3", ctx())).toEqual({ from: "2024-01-01", to: "2026-09-26" });
  });

  it("follows a fiscal year that does not start in January", () => {
    expect(presetRange("last3", ctx({ fiscalStartMonth: 7, lastEntryDate: "2024-05-31" }))).toEqual({
      from: "2021-07-01",
      to: "2024-06-30",
    });
  });

  it("ignores an entry dated in the future when anchoring", () => {
    expect(presetRange("last3", ctx({ lastEntryDate: "2027-02-01" }))).toEqual({
      from: "2024-01-01",
      to: "2026-09-26",
    });
  });

  it("covers the whole book for all dates", () => {
    expect(presetRange("all", ctx())).toEqual({ from: "2022-12-31", to: "2026-09-20" });
  });

  it("gives an empty book a one-day range rather than none", () => {
    expect(presetRange("all", ctx({ firstEntryDate: null, lastEntryDate: null }))).toEqual({
      from: "2026-09-26",
      to: "2026-09-26",
    });
  });

  it("ends all dates at today when the book has entries after it", () => {
    expect(presetRange("all", ctx({ lastEntryDate: "2027-01-01" }))).toEqual({ from: "2022-12-31", to: "2026-09-26" });
  });

  it("gets February's last day right, in a leap year and out of one", () => {
    expect(presetRange("month", ctx({ today: "2028-02-29" })).to).toBe("2028-02-29");
    expect(presetRange("quarter", ctx({ today: "2027-03-31" }))).toEqual({ from: "2027-01-01", to: "2027-03-31" });
  });
});

describe("dates at the head of a report", () => {
  it("writes a long date the way the prototype does", () => {
    expect(longDate("2026-01-01")).toBe("January 1, 2026");
    expect(longDate("2026-09-26")).toBe("September 26, 2026");
  });

  it("writes a short date for a table cell", () => {
    expect(shortDate("2026-02-02")).toBe("Feb 2, 2026");
  });

  it("writes a range, or an as-of date when there is no start", () => {
    expect(rangeText("2026-01-01", "2026-09-26")).toBe("January 1, 2026 – September 26, 2026");
    expect(rangeText(null, "2026-09-26")).toBe("As of September 26, 2026");
  });
});
