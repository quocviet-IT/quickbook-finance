import { describe, expect, it } from "vitest";
import {
  RATIOS,
  RATIO_GROUPS,
  arrowText,
  buildFinancialRatios,
  buildRatioWorkings,
  daysInPeriod,
  financialRatiosSheet,
  formatRatio,
  ratioArrow,
  shiftBackOneYear,
  workingsRows,
  yearEarlierRange,
  type RatioWorkings,
} from "@/lib/domain/financial-ratios";
import type { LedgerBalance } from "@/lib/domain/reports";

const bal = (accountId: string, accountType: LedgerBalance["accountType"], debitBase: number, creditBase: number, name = accountId): LedgerBalance => ({
  accountId,
  accountCode: accountId,
  name,
  accountType,
  debitBase,
  creditBase,
});

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

/** Round numbers so each formula can be checked by hand. 100-day period. */
const W: RatioWorkings = {
  cashMinor: 20_000,
  receivablesMinor: 30_000,
  inventoryMinor: 10_000,
  currentAssetsMinor: 60_000,
  totalAssetsMinor: 100_000,
  currentLiabilitiesMinor: 30_000,
  totalLiabilitiesMinor: 50_000,
  accountsPayableMinor: 15_000,
  equityMinor: 50_000,
  incomeMinor: 200_000,
  costOfGoodsSoldMinor: 80_000,
  runningCostsMinor: 60_000,
  otherExpensesMinor: 10_000,
  grossProfitMinor: 120_000,
  operatingIncomeMinor: 60_000,
  netIncomeMinor: 50_000,
  interestMinor: 20_000,
  days: 100,
};

const ratio = (id: string, w: RatioWorkings = W) => RATIOS.find((r) => r.id === id)!.compute(w);

describe("buildRatioWorkings", () => {
  const balances = [
    bal("bank", "bank", 50_000, 10_000),
    bal("ar", "accounts_receivable", 30_000, 0),
    bal("inv", "current_asset", 12_000, 2_000),
    bal("prepaid", "current_asset", 3_000, 0),
    bal("fixed", "fixed_asset", 40_000, 0),
    bal("ap", "accounts_payable", 0, 20_000),
    bal("card", "credit_card", 0, 5_000),
    bal("tax", "current_liability", 0, 4_000),
    bal("loan", "long_term_liability", 0, 30_000),
    bal("cap", "equity", 0, 28_500),
    bal("sales", "income", 0, 90_000),
    bal("cogs", "cost_of_goods_sold", 30_000, 0),
    bal("rent", "expense", 20_000, 0),
    bal("interest", "expense", 5_000, 0, "Loan Interest"),
    bal("bankint", "other_expense", 1_000, 0, "Bank interest paid"),
    bal("bankfee", "other_expense", 500, 0, "Bank fees"),
    bal("gain", "other_income", 0, 2_000),
  ];
  // Total equity with current earnings: capital 28,500 + net income.
  const flow = balances.filter((r) => ["income", "cost_of_goods_sold", "expense", "other_expense", "other_income"].includes(r.accountType));
  const w = buildRatioWorkings({ balances, flow, inventoryAccountIds: new Set(["inv"]), from: "2026-01-01", to: "2026-03-31" });

  it("sorts balances into the workings by account type", () => {
    expect(w.cashMinor).toBe(40_000);
    expect(w.receivablesMinor).toBe(30_000);
    expect(w.inventoryMinor).toBe(10_000);
    expect(w.currentAssetsMinor).toBe(40_000 + 30_000 + 10_000 + 3_000);
    expect(w.totalAssetsMinor).toBe(w.currentAssetsMinor + 40_000);
    expect(w.accountsPayableMinor).toBe(20_000);
    expect(w.currentLiabilitiesMinor).toBe(29_000);
    expect(w.totalLiabilitiesMinor).toBe(59_000);
  });

  it("takes flow figures from the profit and loss, and interest by name from both expense kinds", () => {
    expect(w.incomeMinor).toBe(90_000);
    expect(w.costOfGoodsSoldMinor).toBe(30_000);
    expect(w.runningCostsMinor).toBe(25_000);
    expect(w.otherExpensesMinor).toBe(1_500);
    expect(w.grossProfitMinor).toBe(60_000);
    expect(w.operatingIncomeMinor).toBe(35_000);
    expect(w.netIncomeMinor).toBe(35_000 + 2_000 - 1_500);
    expect(w.interestMinor).toBe(6_000);
    expect(w.days).toBe(90);
  });

  it("includes profit to date in equity, so the sheet balances", () => {
    expect(w.equityMinor).toBe(28_500 + w.netIncomeMinor);
    expect(w.totalAssetsMinor).toBe(w.totalLiabilitiesMinor + w.equityMinor);
  });
});

describe("daysInPeriod", () => {
  it("counts both ends and never goes below 1", () => {
    expect(daysInPeriod("2026-01-01", "2026-01-31")).toBe(31);
    expect(daysInPeriod("2026-03-05", "2026-03-05")).toBe(1);
    expect(daysInPeriod("2024-01-01", "2024-12-31")).toBe(366);
  });
});

describe("the fifteen ratios", () => {
  it("has the spec's fifteen, four groups, in order", () => {
    expect(RATIOS).toHaveLength(15);
    expect(RATIO_GROUPS.map((g) => g.label)).toEqual([
      "Can it pay its bills",
      "Does it make money",
      "How fast money moves",
      "How much is borrowed",
    ]);
    expect(RATIOS.map((r) => r.name)).toEqual([
      "Current ratio",
      "Quick ratio",
      "Working capital",
      "Months of cash",
      "Gross margin",
      "Operating margin",
      "Net margin",
      "Return on assets, a year",
      "Return on equity, a year",
      "Days to get paid",
      "Days to pay suppliers",
      "Days of stock",
      "Debt to equity",
      "Debt ratio",
      "Interest cover",
    ]);
  });

  it("works each formula out", () => {
    expect(ratio("current-ratio")).toBe(2);
    expect(ratio("quick-ratio")).toBeCloseTo(50_000 / 30_000);
    expect(ratio("working-capital")).toBe(30_000);
    // spend 150,000 over 100 days = 150,000 / (100 / 30.44) a month
    expect(ratio("months-of-cash")).toBeCloseTo(20_000 / (150_000 / (100 / 30.44)));
    expect(ratio("gross-margin")).toBeCloseTo(0.6);
    expect(ratio("operating-margin")).toBeCloseTo(0.3);
    expect(ratio("net-margin")).toBeCloseTo(0.25);
    expect(ratio("return-on-assets")).toBeCloseTo((50_000 * 3.65) / 100_000);
    expect(ratio("return-on-equity")).toBeCloseTo((50_000 * 3.65) / 50_000);
    expect(ratio("days-to-get-paid")).toBeCloseTo(30_000 / (200_000 / 100));
    expect(ratio("days-to-pay-suppliers")).toBeCloseTo(15_000 / (140_000 / 100));
    expect(ratio("days-of-stock")).toBeCloseTo(10_000 / (80_000 / 100));
    expect(ratio("debt-to-equity")).toBe(1);
    expect(ratio("debt-ratio")).toBe(0.5);
    expect(ratio("interest-cover")).toBe(3);
  });

  it("is blank where there is nothing to divide by", () => {
    const empty: RatioWorkings = {
      ...W,
      currentLiabilitiesMinor: 0,
      incomeMinor: 0,
      costOfGoodsSoldMinor: 0,
      runningCostsMinor: 0,
      otherExpensesMinor: 0,
      totalAssetsMinor: 0,
    };
    for (const id of ["current-ratio", "quick-ratio", "months-of-cash", "gross-margin", "operating-margin", "net-margin", "return-on-assets", "days-to-get-paid", "days-to-pay-suppliers", "days-of-stock", "debt-ratio"]) {
      expect(ratio(id, empty), id).toBeNull();
    }
    // Working capital is a difference, so it always has a value.
    expect(ratio("working-capital", empty)).toBe(60_000);
  });

  it("blanks the equity ratios when equity is zero or negative", () => {
    for (const equityMinor of [0, -5_000]) {
      const w = { ...W, equityMinor };
      expect(ratio("return-on-equity", w)).toBeNull();
      expect(ratio("debt-to-equity", w)).toBeNull();
    }
  });

  it("blanks interest cover when there is no interest", () => {
    expect(ratio("interest-cover", { ...W, interestMinor: 0 })).toBeNull();
  });

  it("scales the yearly returns by the length of the period", () => {
    expect(ratio("return-on-assets", { ...W, days: 365 })).toBeCloseTo(0.5);
  });
});

describe("formatRatio", () => {
  it("formats each kind and dashes a blank", () => {
    expect(formatRatio("ratio", 1.5, money)).toBe("1.50");
    expect(formatRatio("money", 123_456, money)).toBe("$1234.56");
    expect(formatRatio("percent", 0.256, money)).toBe("25.6%");
    expect(formatRatio("months", 3.04, money)).toBe("3.0 months");
    expect(formatRatio("days", 41.6, money)).toBe("42 days");
    expect(formatRatio("ratio", null, money)).toBe("—");
  });

  it("never prints a negative zero", () => {
    expect(formatRatio("ratio", -0.0004, money)).toBe("0.00");
    expect(formatRatio("percent", -0.0004, money)).toBe("0.0%");
    expect(formatRatio("months", -0.0004, money)).toBe("0.0 months");
    expect(formatRatio("days", -0.0004, money)).toBe("0 days");
    expect(formatRatio("money", -0.0004, money)).toBe("$0.00");
  });
});

describe("ratioArrow", () => {
  it("is empty when either side is blank", () => {
    expect(ratioArrow(null, 1, "higher")).toBeNull();
    expect(ratioArrow(1, null, "higher")).toBeNull();
  });

  it("is steady under the larger of 0.005 and 1% of the earlier value", () => {
    // 1% of 2.00 = 0.02 beats 0.005.
    expect(ratioArrow(2.019, 2, "higher")).toEqual({ kind: "steady" });
    expect(ratioArrow(1.981, 2, "higher")).toEqual({ kind: "steady" });
    expect(ratioArrow(2.021, 2, "higher")).toEqual({ kind: "moved", up: true, verdict: "better" });
    // Near zero the 0.005 floor applies.
    expect(ratioArrow(0.004, 0, "higher")).toEqual({ kind: "steady" });
    expect(ratioArrow(0.006, 0, "higher")).toEqual({ kind: "moved", up: true, verdict: "better" });
    // 1% of a negative earlier value uses its size.
    expect(ratioArrow(-1.005, -1, "higher")).toEqual({ kind: "steady" });
  });

  it("judges better or worse by direction", () => {
    expect(ratioArrow(3, 2, "higher")).toEqual({ kind: "moved", up: true, verdict: "better" });
    expect(ratioArrow(1, 2, "higher")).toEqual({ kind: "moved", up: false, verdict: "worse" });
    expect(ratioArrow(30, 40, "lower")).toEqual({ kind: "moved", up: false, verdict: "better" });
    expect(ratioArrow(50, 40, "lower")).toEqual({ kind: "moved", up: true, verdict: "worse" });
  });

  it("calls a neutral ratio longer or shorter, never better or worse", () => {
    expect(ratioArrow(50, 40, "neutral")).toEqual({ kind: "moved", up: true, verdict: "longer" });
    expect(ratioArrow(30, 40, "neutral")).toEqual({ kind: "moved", up: false, verdict: "shorter" });
    expect(ratioArrow(40.1, 40, "neutral")).toEqual({ kind: "steady" });
  });

  it("words the arrow", () => {
    expect(arrowText(null)).toBe("");
    expect(arrowText({ kind: "steady" })).toBe("steady");
    expect(arrowText({ kind: "moved", up: true, verdict: "better" })).toBe("▲ better");
    expect(arrowText({ kind: "moved", up: false, verdict: "shorter" })).toBe("▼ shorter");
  });
});

describe("the year-earlier range", () => {
  it("shifts back one year", () => {
    expect(shiftBackOneYear("2026-10-09")).toBe("2025-10-09");
    expect(shiftBackOneYear("2026-01-01")).toBe("2025-01-01");
  });

  it("clamps Feb 29 to Feb 28, and leaves a leap day that exists alone", () => {
    expect(shiftBackOneYear("2024-02-29")).toBe("2023-02-28");
    expect(shiftBackOneYear("2025-02-28")).toBe("2024-02-28");
    expect(shiftBackOneYear("2028-02-29")).toBe("2027-02-28");
    expect(yearEarlierRange("2024-01-01", "2024-02-29")).toEqual({ from: "2023-01-01", to: "2023-02-28" });
  });
});

describe("buildFinancialRatios", () => {
  const before: RatioWorkings = { ...W, currentAssetsMinor: 40_000, currentLiabilitiesMinor: 40_000 };

  it("pairs each ratio with its year-earlier value and arrow", () => {
    const report = buildFinancialRatios({ from: "2026-01-01", to: "2026-04-10", current: W, earlier: before });
    expect(report.earlierFrom).toBe("2025-01-01");
    expect(report.earlierTo).toBe("2025-04-10");
    const current = report.rows.find((r) => r.id === "current-ratio")!;
    expect(current.current).toBe(2);
    expect(current.earlier).toBe(1);
    expect(current.arrow).toEqual({ kind: "moved", up: true, verdict: "better" });
    expect(report.rows).toHaveLength(15);
  });

  it("leaves the earlier column blank when that period had neither assets nor income", () => {
    const nothing: RatioWorkings = { ...W, totalAssetsMinor: 0, incomeMinor: 0 };
    const report = buildFinancialRatios({ from: "2026-01-01", to: "2026-04-10", current: W, earlier: nothing });
    expect(report.earlier).toBeNull();
    expect(report.rows.every((r) => r.earlier === null && r.arrow === null)).toBe(true);
    // Assets alone, or income alone, still count as activity.
    expect(buildFinancialRatios({ from: "2026-01-01", to: "2026-04-10", current: W, earlier: { ...nothing, incomeMinor: 5 } }).earlier).not.toBeNull();
    expect(buildFinancialRatios({ from: "2026-01-01", to: "2026-04-10", current: W, earlier: { ...nothing, totalAssetsMinor: 5 } }).earlier).not.toBeNull();
  });
});

describe("the export sheet", () => {
  const report = buildFinancialRatios({ from: "2026-01-01", to: "2026-04-10", current: W, earlier: { ...W, currentAssetsMinor: 40_000, currentLiabilitiesMinor: 40_000 } });
  const sheet = financialRatiosSheet(report, { companyName: "Example Co", currencyCode: "USD", money });

  it("carries the fifteen ratios by group, then the sixteen workings", () => {
    expect(sheet.fileName).toBe("financial-ratios-2026-01-01-to-2026-04-10");
    expect(sheet.title).toBe("Financial Ratios");
    expect(sheet.rows).toHaveLength(15 + 16);
    expect(sheet.rows[0]).toMatchObject({ section: "Can it pay its bills", item: "Current ratio", current: "2.00", earlier: "1.00", change: "▲ better" });
    expect(sheet.rows[15]).toMatchObject({ section: "The figures behind them", item: "Cash and bank", current: "$200.00" });
    expect(sheet.rows.at(-1)).toMatchObject({ item: "Days in the period", current: "100", earlier: "100" });
  });

  it("leaves the earlier cells empty when that column is blank", () => {
    const blank = buildFinancialRatios({ from: "2026-01-01", to: "2026-04-10", current: W, earlier: { ...W, totalAssetsMinor: 0, incomeMinor: 0 } });
    const rows = financialRatiosSheet(blank, { companyName: "Example Co", currencyCode: "USD", money }).rows;
    expect(rows.every((r) => r.earlier === "—" || r.earlier === "")).toBe(true);
    expect(workingsRows(blank.current, blank.earlier).every((r) => r.earlier === null)).toBe(true);
  });
});
