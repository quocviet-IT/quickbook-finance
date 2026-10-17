import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateInTimeZone,
  formatDateRange,
  formatDateTime,
  formatTime,
  plural,
  pluralWord,
  todayInTimeZone,
} from "@/lib/format";
import { pagerTotal, resolveTableData } from "@/components/ui/table-data";

describe("formatDate", () => {
  it("writes a calendar date the American way", () => {
    expect(formatDate("2026-10-16")).toBe("10/16/2026");
    expect(formatDate("2026-01-05")).toBe("01/05/2026");
  });

  it("never moves a date by a time zone", () => {
    // A date is a day in the books. Parsing it as a moment would read
    // 2026-01-01 as December 31 anywhere west of Greenwich.
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
  });

  it("reads an empty value as a dash and leaves anything else as it was", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate("not a date")).toBe("not a date");
  });
});

describe("formatDateRange", () => {
  it("writes both ends, or the end alone as an as-of", () => {
    expect(formatDateRange("2026-01-01", "2026-09-26")).toBe("01/01/2026 – 09/26/2026");
    expect(formatDateRange(null, "2026-09-26")).toBe("As of 09/26/2026");
  });
});

describe("the company's clock", () => {
  // 03:30 UTC on October 17 is still the evening of October 16 in New York.
  const lateEvening = "2026-10-17T03:30:00Z";

  it("names the company's today, not UTC's", () => {
    expect(todayInTimeZone("America/New_York", new Date(lateEvening))).toBe("2026-10-16");
    expect(todayInTimeZone("Asia/Ho_Chi_Minh", new Date(lateEvening))).toBe("2026-10-17");
  });

  it("shows a moment's date and 12-hour time in the company's zone", () => {
    expect(formatDateInTimeZone(lateEvening, "America/New_York")).toBe("10/16/2026");
    expect(formatTime(lateEvening, "America/New_York")).toBe("11:30 PM");
    expect(formatDateTime(lateEvening, "America/New_York")).toBe("10/16/2026 11:30 PM");
  });

  it("writes midnight and noon as 12, never 0 or 24", () => {
    expect(formatTime("2026-10-16T04:05:00Z", "America/New_York")).toBe("12:05 AM");
    expect(formatTime("2026-10-16T16:05:00Z", "America/New_York")).toBe("12:05 PM");
    expect(formatTime("2026-10-16T13:00:00Z", "America/New_York")).toBe("9:00 AM");
  });

  it("follows daylight saving time", () => {
    // January: UTC−5. July: UTC−4.
    expect(formatTime("2026-01-15T15:00:00Z", "America/New_York")).toBe("10:00 AM");
    expect(formatTime("2026-07-15T15:00:00Z", "America/New_York")).toBe("11:00 AM");
  });

  it("uses a plain space before AM and PM, the same on every ICU build", () => {
    expect(formatTime(lateEvening, "America/New_York")).not.toMatch(/[  ]/);
  });

  it("reads a missing moment as a dash", () => {
    expect(formatDateTime(null, "America/New_York")).toBe("—");
    expect(formatTime(undefined, "America/New_York")).toBe("—");
    expect(formatDateInTimeZone("", "America/New_York")).toBe("—");
  });
});

describe("the table pager", () => {
  it("says which rows are showing, never a second count in another noun", () => {
    // It said "1 records" under a filter bar that said "1 result".
    expect(pagerTotal(1, [1, 1])).toBe("1 of 1");
    expect(pagerTotal(25, [11, 20])).toBe("11–20 of 25");
    expect(pagerTotal(1204, [1001, 1050])).toBe("1,001–1,050 of 1,204");
    expect(pagerTotal(0, [0, 0])).toBe("0 results");
  });

  it("is the pager every DataTable gets", () => {
    const { pagination } = resolveTableData({ rows: [{ id: 1 }] });
    expect(pagination && pagination.showTotal).toBe(pagerTotal);
  });
});

describe("plural", () => {
  it("agrees the noun with the number", () => {
    expect(plural(0, "record")).toBe("0 records");
    expect(plural(1, "record")).toBe("1 record");
    expect(plural(2, "record")).toBe("2 records");
  });

  it("separates thousands", () => {
    expect(plural(1204, "row")).toBe("1,204 rows");
  });

  it("takes an irregular plural when given one", () => {
    expect(plural(1, "entry", "entries")).toBe("1 entry");
    expect(plural(3, "entry", "entries")).toBe("3 entries");
    expect(plural(2, "company", "companies")).toBe("2 companies");
  });

  it("gives the word alone, for a verb or a count shown elsewhere", () => {
    expect(pluralWord(1, "is", "are")).toBe("is");
    expect(pluralWord(4, "is", "are")).toBe("are");
    expect(pluralWord(1, "result")).toBe("result");
    expect(pluralWord(0, "result")).toBe("results");
  });
});
