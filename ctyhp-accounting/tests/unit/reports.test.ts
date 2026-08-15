import { describe, it, expect } from "vitest";
import {
  buildTrialBalance,
  buildProfitAndLoss,
  buildBalanceSheet,
  buildBudgetVsActual,
  buildStatementOfEquity,
  compareReportLines,
  nextShowPercentOfIncome,
  percentOfIncome,
  pnlTrendColumns,
  pnlTrendExportRows,
  pnlTrendRows,
  previousMonthEnd,
  previousPeriodRange,
  sumProfitAndLoss,
  type LedgerBalance,
  type ProfitAndLoss,
} from "@/lib/domain/reports";

// Cumulative balances after: issue $378.88 invoice (sub 350, tax 28.88) and
// receive full payment. Amounts in minor units (USD cents).
const rows: LedgerBalance[] = [
  { accountId: "1010", accountCode: "1010", name: "Operating Bank Account", accountType: "bank", debitBase: 37888, creditBase: 0 },
  { accountId: "1100", accountCode: "1100", name: "Accounts Receivable", accountType: "accounts_receivable", debitBase: 37888, creditBase: 37888 },
  { accountId: "2100", accountCode: "2100", name: "Sales Tax Payable", accountType: "current_liability", debitBase: 0, creditBase: 2888 },
  { accountId: "4000", accountCode: "4000", name: "Sales Revenue", accountType: "income", debitBase: 0, creditBase: 35000 },
];

describe("trial balance", () => {
  it("nets each account and balances", () => {
    const tb = buildTrialBalance(rows);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(37888);
    expect(tb.totalCredit).toBe(37888);
    // AR nets to zero -> omitted.
    expect(tb.lines.find((l) => l.accountCode === "1100")).toBeUndefined();
    expect(tb.lines.find((l) => l.accountCode === "1010")!.debit).toBe(37888);
    expect(tb.lines.find((l) => l.accountCode === "4000")!.credit).toBe(35000);
  });
});

describe("profit and loss", () => {
  it("computes income and net income", () => {
    const pnl = buildProfitAndLoss(rows);
    expect(pnl.income.total).toBe(35000);
    expect(pnl.costOfGoodsSold.total).toBe(0);
    expect(pnl.grossProfit).toBe(35000);
    expect(pnl.netIncome).toBe(35000);
  });
});

describe("balance sheet", () => {
  it("balances with current earnings", () => {
    const bs = buildBalanceSheet(rows);
    expect(bs.totalAssets).toBe(37888);
    expect(bs.totalLiabilities).toBe(2888);
    // equity booked 0 + current earnings 35000
    expect(bs.totalEquity).toBe(35000);
    expect(bs.balanced).toBe(true);
    expect(bs.equity.lines.find((l) => l.name === "Current earnings")!.amount).toBe(35000);
  });
});

describe("period comparison", () => {
  it("compares a whole month, quarter or year with the same period before it", () => {
    // A reader comparing a quarter means the quarter before, not the 91 days
    // before. Counting days is what this used to do, and it put the start of
    // every comparison a day or two inside the period before the one intended.
    expect(previousPeriodRange("2026-04-01", "2026-06-30")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
    expect(previousPeriodRange("2024-02-01", "2024-02-29")).toEqual({
      from: "2024-01-01",
      to: "2024-01-31",
    });
    expect(previousMonthEnd("2026-07-25")).toBe("2026-06-30");
  });

  it("compares a year with the year before, even across a leap year", () => {
    // The case a user reported. 2024 has 366 days, so counting days reached
    // back to 2022-12-31 — a comparison spanning two financial years, with an
    // extra day of 2022 folded into it.
    expect(previousPeriodRange("2024-01-01", "2024-12-31")).toEqual({
      from: "2023-01-01",
      to: "2023-12-31",
    });
    // And the other direction: 2025 has 365 days, so counting days started the
    // comparison on 2 January and dropped New Year's Day out of the prior year
    // altogether. Anything posted that day was missing from the column and
    // nothing said so.
    expect(previousPeriodRange("2025-01-01", "2025-12-31")).toEqual({
      from: "2024-01-01",
      to: "2024-12-31",
    });
  });

  it("still counts days for a range that is not whole months", () => {
    // A hand-picked range has no calendar period to step back through, so the
    // old rule is the only one available and stays.
    expect(previousPeriodRange("2026-03-15", "2026-04-20")).toEqual({
      from: "2026-02-06",
      to: "2026-03-14",
    });
  });

  it("aligns account lines and calculates variance", () => {
    const compared = compareReportLines(
      [{ accountId: "4000", accountCode: "4000", name: "Sales", amount: 12000 }],
      [{ accountId: "4000", accountCode: "4000", name: "Sales", amount: 10000 }],
    );
    expect(compared[0]).toMatchObject({
      current: 12000,
      prior: 10000,
      variance: 2000,
      variancePercent: 20,
    });
  });
});

describe("Budget vs Actual", () => {
  const actual: LedgerBalance[] = [
    { accountId: "income", accountCode: "4000", name: "Sales", accountType: "income", debitBase: 0, creditBase: 120000 },
    { accountId: "expense", accountCode: "6000", name: "Operating Expense", accountType: "expense", debitBase: 70000, creditBase: 0 },
  ];

  it("uses natural balances and assesses favorable variance by account type", () => {
    const report = buildBudgetVsActual(actual, [
      { accountId: "income", accountCode: "4000", name: "Sales", accountType: "income", amountMinor: 100000 },
      { accountId: "expense", accountCode: "6000", name: "Operating Expense", accountType: "expense", amountMinor: 60000 },
    ]);
    expect(report.actual.netIncome).toBe(50000);
    expect(report.budget.netIncome).toBe(40000);
    expect(report.lines.find((line) => line.accountId === "income")).toMatchObject({
      variance: 20000,
      favorable: true,
    });
    expect(report.lines.find((line) => line.accountId === "expense")).toMatchObject({
      variance: 10000,
      favorable: false,
    });
  });
});

describe("percentOfIncome", () => {
  it("expresses a figure as a percentage of that column's income", () => {
    expect(percentOfIncome(25000, 100000)).toBe(25);
  });

  it("is null rather than Infinity or NaN when there is no income to divide by", () => {
    expect(percentOfIncome(5000, 0)).toBeNull();
    expect(percentOfIncome(0, 0)).toBeNull();
    expect(percentOfIncome(-5000, 0)).toBeNull();
  });

  it("still divides cleanly when the column's income is negative", () => {
    // A period where refunds or write-offs outran sales. The formula needs no
    // special case for this: the sign is simply part of what happened.
    expect(percentOfIncome(20000, -50000)).toBe(-40);
  });

  it("reports 100% for an income line that is the whole of income", () => {
    expect(percentOfIncome(100000, 100000)).toBe(100);
  });
});

describe("multi-period profit and loss", () => {
  const jan: LedgerBalance[] = [
    { accountId: "4000", accountCode: "4000", name: "Sales", accountType: "income", debitBase: 0, creditBase: 10000 },
    { accountId: "6000", accountCode: "6000", name: "Rent", accountType: "expense", debitBase: 4000, creditBase: 0 },
  ];
  const feb: LedgerBalance[] = [
    { accountId: "4000", accountCode: "4000", name: "Sales", accountType: "income", debitBase: 0, creditBase: 15000 },
    { accountId: "6000", accountCode: "6000", name: "Rent", accountType: "expense", debitBase: 4000, creditBase: 0 },
    { accountId: "6100", accountCode: "6100", name: "Advertising", accountType: "expense", debitBase: 2000, creditBase: 0 },
  ];
  const periods: ProfitAndLoss[] = [buildProfitAndLoss(jan), buildProfitAndLoss(feb)];

  describe("pnlTrendRows", () => {
    it("lays income, expenses, gross profit and net income out as one column per period", () => {
      const rows = pnlTrendRows(periods);
      const sales = rows.find((r) => r.label.startsWith("4000"))!;
      expect(sales.amounts).toEqual([10000, 15000]);
      const rent = rows.find((r) => r.label.startsWith("6000"))!;
      expect(rent.amounts).toEqual([4000, 4000]);
      const netIncome = rows.find((r) => r.key === "net-income")!;
      expect(netIncome.amounts).toEqual([6000, 9000]);
    });

    it("keeps an expense that only appears in one period, as zero in the other", () => {
      const advertising = pnlTrendRows(periods).find((r) => r.label.startsWith("6100"))!;
      expect(advertising.amounts, "an expense that started in February must not vanish from January").toEqual([0, 2000]);
    });

    it("has nothing to lay out for no periods", () => {
      expect(pnlTrendRows([])).toEqual([]);
    });
  });

  describe("sumProfitAndLoss", () => {
    it("adds accounts across periods to build the Total column", () => {
      const total = sumProfitAndLoss(periods);
      expect(total.income.total).toBe(25000);
      expect(total.operatingExpenses.total).toBe(10000);
      expect(total.netIncome).toBe(15000);
      expect(total.operatingExpenses.lines.find((l) => l.accountCode === "6100")!.amount).toBe(2000);
    });

    it("gives the same totals a single query across the whole range would give", () => {
      // A P&L account carries no opening balance, so summing two disjoint
      // months' activity has to equal one query spanning both months — this
      // is the fact that lets the Total column skip an extra query entirely.
      const wholeRange = buildProfitAndLoss([...jan, ...feb]);
      const summed = sumProfitAndLoss(periods);
      expect(summed.netIncome).toBe(wholeRange.netIncome);
      expect(summed.income.total).toBe(wholeRange.income.total);
      expect(summed.operatingExpenses.total).toBe(wholeRange.operatingExpenses.total);
    });

    it("is all zero for no periods", () => {
      const empty = sumProfitAndLoss([]);
      expect(empty.income.total).toBe(0);
      expect(empty.netIncome).toBe(0);
      expect(empty.income.lines).toEqual([]);
    });
  });

  describe("pnlTrendColumns", () => {
    it("does not append a Total column for a single period", () => {
      // The bug the review caught: a one-period range must not render a
      // second, duplicate column that just repeats the same figures.
      const single = pnlTrendColumns([periods[0]], ["Jan 2026"]);
      expect(single.hasTotal).toBe(false);
      expect(single.columnLabels).toEqual(["Jan 2026"]);
      expect(single.incomeTotals).toEqual([10000]);
      expect(single.rows.find((r) => r.key === "net-income")!.amounts).toEqual([6000]);
    });

    it("appends a Total column, and only a Total column, once there is more than one period", () => {
      const trend = pnlTrendColumns(periods, ["Jan 2026", "Feb 2026"]);
      expect(trend.hasTotal).toBe(true);
      expect(trend.columnLabels).toEqual(["Jan 2026", "Feb 2026", "Total"]);
      expect(trend.incomeTotals).toEqual([10000, 15000, 25000]);
      expect(trend.rows.find((r) => r.key === "net-income")!.amounts).toEqual([6000, 9000, 15000]);
    });

    it("has nothing to lay out, and no Total, for no periods", () => {
      const empty = pnlTrendColumns([], []);
      expect(empty.hasTotal).toBe(false);
      expect(empty.columnLabels).toEqual([]);
      expect(empty.rows).toEqual([]);
    });
  });

  describe("pnlTrendExportRows", () => {
    // MinorAmountRow-shaped fixtures, independent of buildProfitAndLoss, so
    // the export-row conversion is exercised directly rather than through a
    // whole P&L. Income totals are deliberately not equal to the row
    // amounts, so a percent cell computed against the wrong divisor (or not
    // computed at all) would not coincidentally look right.
    const exportRows = [
      { key: "income-4000", label: "4000 — Sales", kind: "line" as const, amounts: [10000, 15000, 25000] },
      { key: "income", label: "Income", kind: "section" as const, amounts: [] },
    ];
    const incomeTotals = [40000, 30000, 50000];

    it("converts each column's minor-unit amount to major units", () => {
      // This is the seam this branch's review found bypassed: PnlTrendView
      // used to call fromMinor inline, right beside a percent entry that
      // must not be converted the same way — easy to drop by accident. This
      // test fails if that conversion is ever skipped again.
      const exported = pnlTrendExportRows(exportRows, 3, 2, incomeTotals, false);
      expect(exported[0]).toEqual({
        label: "4000 — Sales",
        "amount-0": 100,
        "amount-1": 150,
        "amount-2": 250,
      });
      // A section row carries no amounts at all — blank cells, not $0.00.
      expect(exported[1]).toEqual({
        label: "Income",
        "amount-0": null,
        "amount-1": null,
        "amount-2": null,
      });
    });

    it("does not divide by 100 for a currency with zero decimal places", () => {
      // Exactly what exportRowsFromMinorAmounts exists to prevent: a fixed
      // "divide by 100" would silently shrink every figure two orders of
      // magnitude for a currency like VND.
      const exported = pnlTrendExportRows(exportRows, 3, 0, incomeTotals, false);
      expect(exported[0]).toEqual({
        label: "4000 — Sales",
        "amount-0": 10000,
        "amount-1": 15000,
        "amount-2": 25000,
      });
    });

    it("leaves the percent columns out entirely when % of Income is off", () => {
      const exported = pnlTrendExportRows(exportRows, 3, 2, incomeTotals, false);
      expect(Object.keys(exported[0])).toEqual(["label", "amount-0", "amount-1", "amount-2"]);
    });

    it("adds a percent cell beside the money cell, against the income total, without converting it the same way", () => {
      const exported = pnlTrendExportRows(exportRows, 3, 2, incomeTotals, true);
      expect(exported[0]).toEqual({
        label: "4000 — Sales",
        "amount-0": 100,
        "amount-1": 150,
        "amount-2": 250,
        "percent-0": 25,
        "percent-1": 50,
        "percent-2": 50,
      });
    });
  });
});

describe("nextShowPercentOfIncome", () => {
  it("applies the new mode's default when the reader has not touched the switch", () => {
    expect(nextShowPercentOfIncome("month", true, false)).toBe(false);
    expect(nextShowPercentOfIncome("quarter", false, false)).toBe(false);
    expect(nextShowPercentOfIncome("comparison", false, false)).toBe(true);
    expect(nextShowPercentOfIncome("single", false, false)).toBe(true);
  });

  it("keeps the reader's own choice once they have touched the switch, whatever mode they switch to", () => {
    // The scenario the review caught: turn % of Income on in "By month",
    // then ask for "By quarter" from the limit notice — the reader's "on"
    // must survive, not fall back to the trend mode's off default.
    expect(nextShowPercentOfIncome("quarter", true, true)).toBe(true);
    expect(nextShowPercentOfIncome("single", false, true)).toBe(false);
  });
});

describe("Statement of Equity", () => {
  it("reconciles beginning equity, direct activity, earnings, and ending equity", () => {
    const opening: LedgerBalance[] = [
      { accountId: "equity", accountCode: "3000", name: "Owner Equity", accountType: "equity", debitBase: 0, creditBase: 50000 },
      { accountId: "prior-income", accountCode: "4000", name: "Sales", accountType: "income", debitBase: 0, creditBase: 30000 },
    ];
    const activity: LedgerBalance[] = [
      { accountId: "equity", accountCode: "3000", name: "Owner Equity", accountType: "equity", debitBase: 0, creditBase: 20000 },
      { accountId: "income", accountCode: "4000", name: "Sales", accountType: "income", debitBase: 0, creditBase: 40000 },
      { accountId: "expense", accountCode: "6000", name: "Expense", accountType: "expense", debitBase: 10000, creditBase: 0 },
    ];
    expect(buildStatementOfEquity(opening, activity)).toMatchObject({
      openingEquity: 80000,
      equityActivity: 20000,
      netIncome: 30000,
      closingEquity: 130000,
    });
  });
});
