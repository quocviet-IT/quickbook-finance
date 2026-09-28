import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPARE_OPTIONS,
  fiscalYearStartOf,
  pointColumns,
  rangeColumns,
  rangeLabel,
  type ColumnPlan,
} from "@/lib/domain/statement-columns";

const columnsOf = (plan: ColumnPlan) => {
  if (!plan.ok) throw new Error(plan.message);
  return plan.columns.map((c) => ({ label: c.label, from: c.from, to: c.to, isTotal: c.isTotal }));
};

describe("the Compare list", () => {
  it("is the prototype's, in its order", () => {
    expect(COMPARE_OPTIONS.map((o) => o.label)).toEqual([
      "No comparison",
      "Previous period",
      "Previous year",
      "Column per year",
      "Column per quarter",
      "Column per month",
    ]);
  });
});

describe("rangeColumns (Profit and Loss)", () => {
  it("is one column for no comparison, named by its dates", () => {
    expect(columnsOf(rangeColumns("none", "2026-01-01", "2026-12-31", 1))).toEqual([
      { label: "2026", from: "2026-01-01", to: "2026-12-31", isTotal: false },
    ]);
    expect(rangeColumns("none", "2026-01-01", "2026-09-28", 1)).toMatchObject({
      ok: true,
      change: false,
      columns: [{ label: "Jan 1, 2026 – Sep 28, 2026" }],
    });
  });

  it("puts the previous period beside it, with a change pair", () => {
    const plan = rangeColumns("prev", "2026-01-01", "2026-03-31", 1);
    expect(plan).toMatchObject({ ok: true, change: true });
    expect(columnsOf(plan)).toEqual([
      { label: "Q1 2026", from: "2026-01-01", to: "2026-03-31", isTotal: false },
      { label: "Q4 2025", from: "2025-10-01", to: "2025-12-31", isTotal: false },
    ]);
  });

  it("puts the same dates a year earlier beside it, February 29 included", () => {
    expect(columnsOf(rangeColumns("year", "2024-02-01", "2024-02-29", 1))).toEqual([
      { label: "Feb 2024", from: "2024-02-01", to: "2024-02-29", isTotal: false },
      { label: "Feb 2023", from: "2023-02-01", to: "2023-02-28", isTotal: false },
    ]);
  });

  it("gives a column per month, clipped to the range, then a Total", () => {
    expect(columnsOf(rangeColumns("month", "2026-01-15", "2026-03-10", 1))).toEqual([
      { label: "Jan 15, 2026 – Jan 31, 2026", from: "2026-01-15", to: "2026-01-31", isTotal: false },
      { label: "Feb 2026", from: "2026-02-01", to: "2026-02-28", isTotal: false },
      { label: "Mar 1, 2026 – Mar 10, 2026", from: "2026-03-01", to: "2026-03-10", isTotal: false },
      { label: "Total", from: "2026-01-15", to: "2026-03-10", isTotal: true },
    ]);
  });

  it("puts a column's dates under a heading that names a period, and nothing under one that is already dates", () => {
    const plan = rangeColumns("month", "2026-01-15", "2026-03-10", 1);
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.columns.map((c) => c.sub)).toEqual([
      "",
      "Feb 1, 2026 – Feb 28, 2026",
      "",
      "Jan 15, 2026 – Mar 10, 2026",
    ]);
  });

  it("has no Total when there is only one column", () => {
    expect(columnsOf(rangeColumns("month", "2026-03-01", "2026-03-31", 1))).toEqual([
      { label: "Mar 2026", from: "2026-03-01", to: "2026-03-31", isTotal: false },
    ]);
  });

  it("gives a column per fiscal year, for a year starting in July", () => {
    expect(columnsOf(rangeColumns("years", "2024-07-01", "2026-09-28", 7))).toEqual([
      { label: "FY 2024–25", from: "2024-07-01", to: "2025-06-30", isTotal: false },
      { label: "FY 2025–26", from: "2025-07-01", to: "2026-06-30", isTotal: false },
      { label: "FY 2026–27", from: "2026-07-01", to: "2026-09-28", isTotal: false },
      { label: "Total", from: "2024-07-01", to: "2026-09-28", isTotal: true },
    ]);
  });

  it("refuses more columns than a reader can scan, and says what to do", () => {
    const plan = rangeColumns("month", "2020-01-01", "2026-12-31", 1);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain("monthly columns");
  });

  it("refuses a range that ends before it starts", () => {
    expect(rangeColumns("none", "2026-05-01", "2026-04-30", 1)).toEqual({
      ok: false,
      message: "The start date is after the end date.",
    });
  });
});

describe("pointColumns (Balance Sheet, Trial Balance)", () => {
  it("is one date for no comparison", () => {
    expect(columnsOf(pointColumns("none", "2026-09-28", "2026-01-01", 1))).toEqual([
      { label: "Sep 28, 2026", from: null, to: "2026-09-28", isTotal: false },
    ]);
  });

  it("compares with the end of the month before, leap years included", () => {
    expect(columnsOf(pointColumns("prev", "2024-03-10", "2024-01-01", 1))[1]).toEqual({
      label: "Feb 29, 2024",
      from: null,
      to: "2024-02-29",
      isTotal: false,
    });
  });

  it("compares with the same day a year earlier", () => {
    expect(columnsOf(pointColumns("year", "2024-02-29", "2024-01-01", 1))[1].to).toBe("2023-02-28");
  });

  it("gives a date per month end from Columns from, the last one As of itself", () => {
    const plan = pointColumns("month", "2026-03-15", "2026-01-01", 1);
    expect(columnsOf(plan)).toEqual([
      { label: "Jan 2026", from: null, to: "2026-01-31", isTotal: false },
      { label: "Feb 2026", from: null, to: "2026-02-28", isTotal: false },
      { label: "Mar 2026", from: null, to: "2026-03-15", isTotal: false },
    ]);
    if (plan.ok) expect(plan.columns[2].sub).toBe("As of Mar 15, 2026");
  });

  it("gives a date per quarter end and per fiscal year end", () => {
    expect(columnsOf(pointColumns("quarter", "2026-03-15", "2025-11-01", 1)).map((c) => [c.label, c.to])).toEqual([
      ["Q4 2025", "2025-12-31"],
      ["Q1 2026", "2026-03-15"],
    ]);
    expect(columnsOf(pointColumns("years", "2026-09-28", "2024-01-01", 1)).map((c) => [c.label, c.to])).toEqual([
      ["2024", "2024-12-31"],
      ["2025", "2025-12-31"],
      ["2026", "2026-09-28"],
    ]);
  });
});

describe("helpers", () => {
  it("finds the first day of a fiscal year", () => {
    expect(fiscalYearStartOf("2026-03-10", 7)).toBe("2025-07-01");
    expect(fiscalYearStartOf("2026-09-28", 1)).toBe("2026-01-01");
  });

  it("names a range by its period when it is a whole one, and by its dates when not", () => {
    expect(rangeLabel("2026-04-01", "2026-06-30")).toBe("Q2 2026");
    expect(rangeLabel("2026-04-02", "2026-06-30")).toBe("Apr 2, 2026 – Jun 30, 2026");
  });

  it("imports nothing that could write to the books", () => {
    expect(readFileSync("lib/domain/statement-columns.ts", "utf8")).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
