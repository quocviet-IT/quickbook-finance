import { describe, it, expect } from "vitest";
import {
  assembleCashFlow,
  assembleIndirectCashFlow,
  cashFlowCategoryOf,
  defaultCashFlowRole,
} from "@/lib/domain/cashflow";
import { cashFlowDetailSchema } from "@/lib/domain/schemas";

describe("cashFlowCategoryOf", () => {
  it("classifies by account type", () => {
    expect(cashFlowCategoryOf("fixed_asset")).toBe("investing");
    expect(cashFlowCategoryOf("equity")).toBe("financing");
    expect(cashFlowCategoryOf("credit_card")).toBe("financing");
    for (const t of ["income", "other_income", "expense", "cost_of_goods_sold", "other_expense", "accounts_receivable", "accounts_payable", "current_asset", "current_liability"] as const) {
      expect(cashFlowCategoryOf(t)).toBe("operating");
    }
  });
});

describe("assembleCashFlow", () => {
  it("sums categories and ties out when totals match the cash change", () => {
    const r = assembleCashFlow(
      [{ category: "operating", amountMinor: 300_00 }, { category: "investing", amountMinor: -100_00 }, { category: "financing", amountMinor: 50_00 }],
      1000_00, // opening
      1250_00, // closing => netChange 250_00 == 300-100+50
    );
    expect(r.operating).toBe(300_00);
    expect(r.investing).toBe(-100_00);
    expect(r.financing).toBe(50_00);
    expect(r.netChange).toBe(250_00);
    expect(r.tiesOut).toBe(true);
  });
  it("flags a mismatch", () => {
    const r = assembleCashFlow([{ category: "operating", amountMinor: 100_00 }], 0, 90_00);
    expect(r.netChange).toBe(90_00);
    expect(r.tiesOut).toBe(false); // operating 100 != netChange 90
  });
});

describe("defaultCashFlowRole", () => {
  it("defaults ambiguous balance-sheet accounts to unclassified", () => {
    expect(defaultCashFlowRole("bank")).toBe("cash");
    expect(defaultCashFlowRole("accounts_receivable")).toBe("operating_receivable");
    expect(defaultCashFlowRole("accounts_payable")).toBe("operating_payable");
    expect(defaultCashFlowRole("fixed_asset")).toBe("investing");
    expect(defaultCashFlowRole("equity")).toBe("financing");
    expect(defaultCashFlowRole("current_asset")).toBe("unclassified");
    expect(defaultCashFlowRole("current_liability")).toBe("unclassified");
  });
});

describe("assembleIndirectCashFlow", () => {
  it("assembles the signed opening-to-closing cash equation", () => {
    const report = assembleIndirectCashFlow(
      [
        { section: "operating", lineCode: "net_income", label: "Net income", amountMinor: 500_00, detailCount: 2 },
        { section: "operating", lineCode: "depreciation", label: "Depreciation", amountMinor: 50_00, detailCount: 1 },
        { section: "operating", lineCode: "change_accounts_receivable", label: "Change in accounts receivable", amountMinor: -100_00, detailCount: 1 },
        { section: "investing", lineCode: "capital_purchases", label: "Capital purchases", amountMinor: -200_00, detailCount: 1 },
        { section: "financing", lineCode: "loan_proceeds", label: "Loan proceeds", amountMinor: 300_00, detailCount: 1 },
      ],
      1_000_00,
      1_550_00,
    );

    expect(report.operating).toBe(450_00);
    expect(report.investing).toBe(-200_00);
    expect(report.financing).toBe(300_00);
    expect(report.netChange).toBe(550_00);
    expect(report.endingCashStatementMinor).toBe(1_550_00);
    expect(report.balanceSheetCashMinor).toBe(1_550_00);
    expect(report.differenceMinor).toBe(0);
    expect(report.classificationComplete).toBe(true);
    expect(report.tiesOut).toBe(true);
  });

  it("does not report a clean tie-out while a cash flow is unclassified", () => {
    const report = assembleIndirectCashFlow(
      [
        { section: "operating", lineCode: "net_income", label: "Net income", amountMinor: 100_00, detailCount: 1 },
        { section: "unclassified", lineCode: "unclassified", label: "Unclassified cash flow", amountMinor: 25_00, detailCount: 1 },
      ],
      1_000_00,
      1_125_00,
    );

    expect(report.unclassifiedMinor).toBe(25_00);
    expect(report.unclassifiedCount).toBe(1);
    expect(report.differenceMinor).toBe(25_00);
    expect(report.classificationComplete).toBe(false);
    expect(report.tiesOut).toBe(false);
  });
});

describe("cash-flow detail input", () => {
  it("accepts a known-shaped line code and rejects unsafe values", () => {
    expect(
      cashFlowDetailSchema.safeParse({
        from: "2026-07-01",
        to: "2026-07-31",
        lineCode: "asset_sale_proceeds",
      }).success,
    ).toBe(true);
    expect(
      cashFlowDetailSchema.safeParse({
        from: "2026-07-01",
        to: "2026-07-31",
        lineCode: "asset_sale_proceeds; drop table acc_account",
      }).success,
    ).toBe(false);
  });
});
