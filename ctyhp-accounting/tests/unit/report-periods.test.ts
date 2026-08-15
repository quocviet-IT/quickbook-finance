import { describe, expect, it } from "vitest";
import {
  COMPARISON_BASES,
  comparisonBasisLabel,
  comparisonDate,
  MAX_TREND_COLUMNS,
  monthEnd,
  monthlyColumns,
  priorMonthEnd,
  priorQuarterEnd,
  priorYearEnd,
  quarterlyColumns,
  sameDayLastYear,
  trailingMonthEnds,
  trailingYearEnds,
  trendColumnLimitMessage,
} from "@/lib/domain/report-periods";
import { balanceTrendRows, type BalanceSheet } from "@/lib/domain/reports";

describe("monthEnd", () => {
  it("knows how long each month is, February included", () => {
    expect(monthEnd(2026, 1)).toBe("2026-01-31");
    expect(monthEnd(2026, 2)).toBe("2026-02-28");
    expect(monthEnd(2024, 2)).toBe("2024-02-29");
    expect(monthEnd(2026, 6)).toBe("2026-06-30");
    expect(monthEnd(2026, 12)).toBe("2026-12-31");
  });
});

describe("priorMonthEnd", () => {
  it("steps back one month, whatever day the report is run on", () => {
    expect(priorMonthEnd("2026-06-30")).toBe("2026-05-31");
    expect(priorMonthEnd("2026-03-15")).toBe("2026-02-28");
  });

  it("crosses the year boundary", () => {
    expect(priorMonthEnd("2026-01-31")).toBe("2025-12-31");
  });
});

describe("priorQuarterEnd", () => {
  it("ends the quarter before the one the date falls in", () => {
    expect(priorQuarterEnd("2026-06-30")).toBe("2026-03-31"); // Q2 → end of Q1
    expect(priorQuarterEnd("2026-05-15")).toBe("2026-03-31");
    expect(priorQuarterEnd("2026-08-01")).toBe("2026-06-30"); // Q3 → end of Q2
    expect(priorQuarterEnd("2026-12-31")).toBe("2026-09-30"); // Q4 → end of Q3
  });

  it("goes back to December for a first-quarter date", () => {
    expect(priorQuarterEnd("2026-02-10")).toBe("2025-12-31");
  });
});

describe("priorYearEnd", () => {
  it("is always 31 December of the year before", () => {
    expect(priorYearEnd("2026-06-30")).toBe("2025-12-31");
    expect(priorYearEnd("2026-01-01")).toBe("2025-12-31");
  });
});

describe("sameDayLastYear", () => {
  it("takes the same day a year earlier", () => {
    expect(sameDayLastYear("2026-06-30")).toBe("2025-06-30");
  });

  it("clamps 29 February to 28 February rather than sliding into March", () => {
    expect(sameDayLastYear("2024-02-29")).toBe("2023-02-28");
  });
});

describe("comparisonDate", () => {
  it("resolves every basis the report offers", () => {
    expect(COMPARISON_BASES).toHaveLength(4);
    expect(comparisonDate("2026-06-30", "prior_month")).toBe("2026-05-31");
    expect(comparisonDate("2026-06-30", "prior_quarter")).toBe("2026-03-31");
    expect(comparisonDate("2026-06-30", "prior_year_end")).toBe("2025-12-31");
    expect(comparisonDate("2026-06-30", "same_month_last_year")).toBe("2025-06-30");
  });

  it("labels each basis the way the picker reads", () => {
    expect(comparisonBasisLabel("prior_year_end")).toBe("Prior year end");
  });
});

describe("trailingMonthEnds", () => {
  it("gives twelve month-end columns, oldest first, ending on the as-of date", () => {
    const columns = trailingMonthEnds("2026-06-30", 12);
    expect(columns).toHaveLength(12);
    expect(columns[0]).toEqual({ date: "2025-07-31", label: "Jul 2025" });
    expect(columns[11]).toEqual({ date: "2026-06-30", label: "Jun 2026" });
  });

  it("keeps the as-of date itself for a report run mid-month", () => {
    const columns = trailingMonthEnds("2026-06-15", 3);
    expect(columns.map((column) => column.date)).toEqual([
      "2026-04-30",
      "2026-05-31",
      "2026-06-15",
    ]);
  });

  it("walks back across a year boundary correctly", () => {
    const columns = trailingMonthEnds("2026-02-28", 4);
    expect(columns.map((column) => column.label)).toEqual([
      "Nov 2025",
      "Dec 2025",
      "Jan 2026",
      "Feb 2026",
    ]);
  });
});

describe("trailingYearEnds", () => {
  it("gives year-end columns with the current position last", () => {
    const columns = trailingYearEnds("2026-06-30", 3);
    expect(columns.map((column) => column.date)).toEqual([
      "2024-12-31",
      "2025-12-31",
      "2026-06-30",
    ]);
    expect(columns.map((column) => column.label)).toEqual(["2024", "2025", "2026-06-30"]);
  });
});

describe("monthlyColumns", () => {
  it("gives one column per calendar month for a whole year", () => {
    const columns = monthlyColumns("2026-01-01", "2026-12-31");
    expect(columns).toHaveLength(12);
    expect(columns[0]).toEqual({ from: "2026-01-01", to: "2026-01-31", label: "Jan 2026" });
    expect(columns[11]).toEqual({ from: "2026-12-01", to: "2026-12-31", label: "Dec 2026" });
  });

  it("clips only the first and last column when the range is not whole months", () => {
    // A reader who picks 15 Jan to 10 Apr by hand still gets one column per
    // month in between; only the two ends are short, and they say so by
    // falling back to their literal dates rather than claiming a month they
    // do not fully cover.
    const columns = monthlyColumns("2026-01-15", "2026-04-10");
    expect(columns).toEqual([
      { from: "2026-01-15", to: "2026-01-31", label: "2026-01-15 – 2026-01-31" },
      { from: "2026-02-01", to: "2026-02-28", label: "Feb 2026" },
      { from: "2026-03-01", to: "2026-03-31", label: "Mar 2026" },
      { from: "2026-04-01", to: "2026-04-10", label: "2026-04-01 – 2026-04-10" },
    ]);
  });

  it("gives a single column for a range inside one month", () => {
    expect(monthlyColumns("2026-06-05", "2026-06-20")).toEqual([
      { from: "2026-06-05", to: "2026-06-20", label: "2026-06-05 – 2026-06-20" },
    ]);
  });

  it("crosses a year boundary without losing a day", () => {
    const columns = monthlyColumns("2025-12-01", "2026-02-28");
    expect(columns.map((c) => c.label)).toEqual(["Dec 2025", "Jan 2026", "Feb 2026"]);
  });

  it("rejects a range that ends before it starts", () => {
    expect(() => monthlyColumns("2026-03-01", "2026-01-01")).toThrow(
      "Report end date must not be before its start date",
    );
  });
});

describe("quarterlyColumns", () => {
  it("gives one column per calendar quarter for a whole year", () => {
    const columns = quarterlyColumns("2026-01-01", "2026-12-31");
    expect(columns).toEqual([
      { from: "2026-01-01", to: "2026-03-31", label: "Q1 2026" },
      { from: "2026-04-01", to: "2026-06-30", label: "Q2 2026" },
      { from: "2026-07-01", to: "2026-09-30", label: "Q3 2026" },
      { from: "2026-10-01", to: "2026-12-31", label: "Q4 2026" },
    ]);
  });

  it("snaps to calendar quarters rather than counting three months from the start", () => {
    // Starting mid-quarter must not invent a "Q1" that is missing January: the
    // first column is Feb-Mar only, and says so instead of overclaiming.
    const columns = quarterlyColumns("2026-02-01", "2026-11-30");
    expect(columns).toEqual([
      { from: "2026-02-01", to: "2026-03-31", label: "Feb–Mar 2026" },
      { from: "2026-04-01", to: "2026-06-30", label: "Q2 2026" },
      { from: "2026-07-01", to: "2026-09-30", label: "Q3 2026" },
      { from: "2026-10-01", to: "2026-11-30", label: "Oct–Nov 2026" },
    ]);
  });

  it("rejects a range that ends before it starts", () => {
    expect(() => quarterlyColumns("2026-06-30", "2026-01-01")).toThrow(
      "Report end date must not be before its start date",
    );
  });
});

describe("trendColumnLimitMessage", () => {
  it("is null when the range fits comfortably inside the limit", () => {
    expect(trendColumnLimitMessage("month", "2026-01-01", "2026-12-31")).toBeNull();
    expect(MAX_TREND_COLUMNS).toBeGreaterThanOrEqual(12);
  });

  it("is null exactly at the limit, not just under it", () => {
    // MAX_TREND_COLUMNS whole months starting January land the boundary case
    // on a real calendar rather than a round number that happens to work.
    const to = monthEnd(2026 + Math.floor((MAX_TREND_COLUMNS - 1) / 12), ((MAX_TREND_COLUMNS - 1) % 12) + 1);
    expect(trendColumnLimitMessage("month", "2026-01-01", to)).toBeNull();
  });

  it("names the fix, with a computed quarter count, when months would overflow", () => {
    // 2026-01-01 to 2030-12-31 is 60 monthly columns, 20 quarterly ones.
    const message = trendColumnLimitMessage("month", "2026-01-01", "2030-12-31");
    expect(message).toBe("That range is 60 monthly columns. Narrow the range, or show it by quarter (20 columns).");
  });

  it("drops the quarter suggestion when quarters would also overflow", () => {
    // A century of months is also well over a century of quarters — quarterly
    // is not a real way out, so the message must not pretend it is.
    const message = trendColumnLimitMessage("month", "1926-01-01", "2030-12-31");
    expect(message).toBe("That range is 1260 monthly columns. Narrow the range.");
  });

  it("never suggests coarsening quarters further, since there is nothing coarser on offer", () => {
    const message = trendColumnLimitMessage("quarter", "1926-01-01", "2030-12-31");
    expect(message).toBe("That range is 420 quarterly columns. Narrow the range.");
  });
});

describe("balanceTrendRows", () => {
  const sheet = (
    assets: { code: string; name: string; amount: number }[],
    liabilities: { code: string; name: string; amount: number }[] = [],
  ): BalanceSheet => {
    const section = (key: string, title: string, lines: typeof assets) => ({
      key,
      title,
      lines: lines.map((line) => ({
        accountId: line.code,
        accountCode: line.code,
        name: line.name,
        amount: line.amount,
      })),
      total: lines.reduce((sum, line) => sum + line.amount, 0),
    });
    const assetSection = section("assets", "Assets", assets);
    const liabilitySection = section("liabilities", "Liabilities", liabilities);
    const equitySection = section("equity", "Equity", []);
    return {
      assets: assetSection,
      liabilities: liabilitySection,
      equity: equitySection,
      totalAssets: assetSection.total,
      totalLiabilities: liabilitySection.total,
      totalEquity: equitySection.total,
      balanced: assetSection.total === liabilitySection.total + equitySection.total,
    };
  };

  it("lays every period out as a column, oldest first", () => {
    const rows = balanceTrendRows([
      sheet([{ code: "1010", name: "Operating Bank Account", amount: 100 }]),
      sheet([{ code: "1010", name: "Operating Bank Account", amount: 250 }]),
    ]);
    const bank = rows.find((row) => row.label.startsWith("1010"))!;
    expect(bank.amounts).toEqual([100, 250]);
  });

  it("keeps an account that only existed in one period, as zero in the others", () => {
    const rows = balanceTrendRows([
      sheet([{ code: "1010", name: "Bank", amount: 100 }]),
      sheet([
        { code: "1010", name: "Bank", amount: 100 },
        { code: "1100", name: "Accounts Receivable", amount: 40 },
      ]),
      sheet([{ code: "1010", name: "Bank", amount: 140 }]),
    ]);
    const receivable = rows.find((row) => row.label.startsWith("1100"))!;
    expect(receivable.amounts, "an account that cleared must not vanish").toEqual([0, 40, 0]);
  });

  it("carries a total row per section and one for liabilities plus equity", () => {
    const rows = balanceTrendRows([
      sheet([{ code: "1010", name: "Bank", amount: 100 }], [{ code: "2000", name: "AP", amount: 30 }]),
    ]);
    expect(rows.find((row) => row.key === "assets-total")!.amounts).toEqual([100]);
    expect(rows.find((row) => row.key === "liabilities-total")!.amounts).toEqual([30]);
    expect(rows.find((row) => row.key === "liabilities-equity")!.amounts).toEqual([30]);
  });

  it("has nothing to lay out for no periods", () => {
    expect(balanceTrendRows([])).toEqual([]);
  });
});
