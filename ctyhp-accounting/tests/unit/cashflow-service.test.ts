import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getCashFlow, getCashFlowDetails } from "@/lib/services/cashflow";

describe("getCashFlow", () => {
  it("maps the indirect RPC contract into a reconciled statement", async () => {
    const summary = [
      { section: "meta", line_code: "opening_cash", label: "Beginning cash", amount_minor: 1000_00, detail_count: 0, sort_order: 0 },
      { section: "operating", line_code: "net_income", label: "Net income", amount_minor: 500_00, detail_count: 2, sort_order: 10 },
      { section: "operating", line_code: "depreciation", label: "Depreciation and amortization", amount_minor: 50_00, detail_count: 1, sort_order: 20 },
      { section: "operating", line_code: "change_accounts_receivable", label: "Change in accounts receivable", amount_minor: -100_00, detail_count: 1, sort_order: 40 },
      { section: "investing", line_code: "capital_purchases", label: "Capital purchases", amount_minor: -200_00, detail_count: 1, sort_order: 110 },
      { section: "financing", line_code: "loan_proceeds", label: "Loan proceeds", amount_minor: 300_00, detail_count: 1, sort_order: 210 },
      { section: "unclassified", line_code: "unclassified", label: "Unclassified cash flow", amount_minor: 0, detail_count: 0, sort_order: 900 },
      { section: "meta", line_code: "closing_cash", label: "Balance Sheet cash", amount_minor: 1550_00, detail_count: 0, sort_order: 1000 },
    ];
    const rpc = vi.fn(async (name: string) => {
      if (name === "acc_cash_flow_indirect") return { data: summary, error: null };
      if (name === "acc_ledger_balances") return { data: [], error: null };
      return { data: summary, error: null };
    });

    const report = await getCashFlow({ rpc } as unknown as SupabaseClient, "2026-07-01", "2026-07-31");

    expect(rpc).toHaveBeenCalledWith("acc_cash_flow_indirect", {
      p_from: "2026-07-01",
      p_to: "2026-07-31",
    });
    expect(report.method).toBe("indirect");
    expect(report.operating).toBe(450_00);
    expect(report.investing).toBe(-200_00);
    expect(report.financing).toBe(300_00);
    expect(report.endingCashStatementMinor).toBe(1550_00);
    expect(report.balanceSheetCashMinor).toBe(1550_00);
    expect(report.differenceMinor).toBe(0);
    expect(report.classificationComplete).toBe(true);
    expect(report.tiesOut).toBe(true);
  });

  it("requests only the selected statement line's journal evidence", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          section: "investing",
          line_code: "asset_sale_proceeds",
          label: "Asset sales and other investing proceeds",
          journal_entry_id: "11111111-1111-4111-8111-111111111111",
          entry_number: "JE-000123",
          entry_date: "2026-07-15",
          description: "Dispose FA-0001",
          source_type: "asset_disposal",
          source_id: "22222222-2222-4222-8222-222222222222",
          account_id: "33333333-3333-4333-8333-333333333333",
          account_code: "1010",
          account_name: "Checking",
          amount_minor: 500_00,
          classification_basis: "journal_source:asset_disposal",
        },
      ],
      error: null,
    }));

    const details = await getCashFlowDetails(
      { rpc } as unknown as SupabaseClient,
      "2026-07-01",
      "2026-07-31",
      "asset_sale_proceeds",
    );

    expect(rpc).toHaveBeenCalledWith("acc_cash_flow_indirect_detail", {
      p_from: "2026-07-01",
      p_to: "2026-07-31",
      p_line_code: "asset_sale_proceeds",
    });
    expect(details).toEqual([
      expect.objectContaining({
        lineCode: "asset_sale_proceeds",
        entryNumber: "JE-000123",
        amountMinor: 500_00,
        classificationBasis: "journal_source:asset_disposal",
      }),
    ]);
  });
});
