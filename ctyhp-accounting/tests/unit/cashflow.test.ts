import { describe, it, expect } from "vitest";
import { cashFlowCategoryOf, assembleCashFlow } from "@/lib/domain/cashflow";

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
