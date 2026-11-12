import { describe, expect, it } from "vitest";
import { formatDayHeading, formatRecentMoment, weekdayOf } from "@/lib/format";

/**
 * Days said the way a list of past conversations says them (Abacus, 3.0.20):
 * "Today", "Yesterday", then the weekday and the date. On the company's clock,
 * never the browser's or UTC's.
 */
const ZONE = "America/New_York";
const TODAY = "2026-11-11"; // a Wednesday

describe("weekdayOf", () => {
  it("names the weekday of a calendar date", () => {
    expect(weekdayOf("2026-11-06")).toBe("Friday");
    expect(weekdayOf("2026-11-11")).toBe("Wednesday");
    expect(weekdayOf("2026-11-08")).toBe("Sunday");
    expect(weekdayOf("1969-12-31")).toBe("Wednesday");
  });

  it("leaves anything that is not a date as it was", () => {
    expect(weekdayOf("not a date")).toBe("not a date");
  });
});

describe("formatDayHeading", () => {
  it("says Today and Yesterday, then the weekday with the date", () => {
    expect(formatDayHeading("2026-11-11T19:14:00Z", ZONE, TODAY)).toBe("Today");
    expect(formatDayHeading("2026-11-10T21:40:00Z", ZONE, TODAY)).toBe("Yesterday");
    expect(formatDayHeading("2026-11-06T20:27:00Z", ZONE, TODAY)).toBe("Friday, 11/06/2026");
  });

  it("reads the day on the company's clock, not UTC's", () => {
    // 02:30 UTC on November 11 is still the evening of November 10 in New York.
    expect(formatDayHeading("2026-11-11T02:30:00Z", ZONE, TODAY)).toBe("Yesterday");
    expect(formatDayHeading("2026-11-11T02:30:00Z", "Asia/Ho_Chi_Minh", TODAY)).toBe("Today");
  });

  it("counts across a month's end", () => {
    expect(formatDayHeading("2026-12-01T15:00:00Z", ZONE, "2026-12-02")).toBe("Yesterday");
    expect(formatDayHeading("2026-11-30T15:00:00Z", ZONE, "2026-12-02")).toBe("Monday, 11/30/2026");
  });
});

describe("formatRecentMoment", () => {
  it("gives the time today, Yesterday, the weekday this past week, and the date before that", () => {
    expect(formatRecentMoment("2026-11-11T19:14:00Z", ZONE, TODAY)).toBe("2:14 PM");
    expect(formatRecentMoment("2026-11-10T21:40:00Z", ZONE, TODAY)).toBe("Yesterday");
    expect(formatRecentMoment("2026-11-06T20:27:00Z", ZONE, TODAY)).toBe("Friday");
    expect(formatRecentMoment("2026-11-05T20:27:00Z", ZONE, TODAY)).toBe("Thursday");
    expect(formatRecentMoment("2026-11-04T20:27:00Z", ZONE, TODAY)).toBe("11/04/2026");
  });

  it("never names a weekday that could be read as next week's", () => {
    // Seven days back is the same weekday as today; it reads as a date.
    expect(formatRecentMoment("2026-11-04T15:00:00Z", ZONE, TODAY)).not.toBe("Wednesday");
  });
});
