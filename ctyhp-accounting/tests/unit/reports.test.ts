import { describe, it, expect } from "vitest";
import {
  buildTrialBalance,
  buildProfitAndLoss,
  buildBalanceSheet,
  buildBudgetVsActual,
  buildStatementOfEquity,
  compareReportLines,
  previousMonthEnd,
  previousPeriodRange,
  type LedgerBalance,
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
