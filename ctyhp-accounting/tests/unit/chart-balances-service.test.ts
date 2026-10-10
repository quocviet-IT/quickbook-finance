import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getChartBalances } from "@/lib/services/chart-balances";

const ledgerRow = (id: string, debit: number, credit: number) => ({
  account_id: id,
  account_code: id,
  name: id,
  account_type: "bank",
  debit_base: debit,
  credit_base: credit,
});

/** A client whose tables hold the given rows and whose ledger answers by the range asked for. */
function fakeClient(opts: {
  startMonth: number | null;
  accounts: { id: string; name?: string; account_type: string; is_contra: boolean; cash_flow_role?: string | null }[];
  ledger: (from: string | null) => Record<string, unknown>[];
}) {
  const rpc = vi.fn((name: string, args: { p_from: string | null; p_to: string }) => ({
    range: async () => ({ data: name === "acc_ledger_balances" ? opts.ledger(args.p_from) : [], error: null }),
  }));
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "order", "limit"]) builder[m] = () => builder;
    builder.range = async () => ({ data: table === "acc_account" ? opts.accounts : [], error: null });
    builder.maybeSingle = async () => ({
      data: opts.startMonth === null ? null : { fiscal_year_start_month: opts.startMonth, time_zone: "UTC" },
      error: null,
    });
    return builder;
  });
  return { sb: { from, rpc } as unknown as SupabaseClient, rpc };
}

const accounts = [
  { id: "bank", account_type: "bank", is_contra: false },
  { id: "sales", account_type: "income", is_contra: false },
  { id: "rent", account_type: "expense", is_contra: false },
  { id: "stock", name: "Inventory", account_type: "current_asset", is_contra: false },
];

describe("getChartBalances", () => {
  it("reads balance sheet accounts from the full history and profit and loss from the fiscal year start", async () => {
    const { sb, rpc } = fakeClient({
      startMonth: 4,
      accounts,
      ledger: (from) =>
        from === null
          ? [ledgerRow("bank", 900_00, 400_00), ledgerRow("sales", 0, 9_000_00), ledgerRow("stock", 70_00, 0)]
          : [ledgerRow("sales", 0, 600_00), ledgerRow("rent", 80_00, 20_00), ledgerRow("bank", 5_00, 0)],
    });

    const out = await getChartBalances(sb, "2026-10-10");

    expect(rpc).toHaveBeenCalledWith("acc_ledger_balances", { p_from: null, p_to: "2026-10-10" });
    expect(rpc).toHaveBeenCalledWith("acc_ledger_balances", { p_from: "2026-04-01", p_to: "2026-10-10" });
    expect(out.asOf).toBe("2026-10-10");
    expect(out.fiscalYearStart).toBe("2026-04-01");
    expect(out.figures).toEqual({ bank: 500_00, sales: 600_00, rent: 60_00, stock: 70_00 });
  });

  it("uses the earlier calendar year when the date falls before the fiscal start month", async () => {
    const { sb, rpc } = fakeClient({ startMonth: 7, accounts, ledger: () => [] });
    const out = await getChartBalances(sb, "2026-02-01");
    expect(out.fiscalYearStart).toBe("2025-07-01");
    expect(rpc).toHaveBeenCalledWith("acc_ledger_balances", { p_from: "2025-07-01", p_to: "2026-02-01" });
  });

  it("starts the fiscal year in January when the company has no settings", async () => {
    const { sb } = fakeClient({ startMonth: null, accounts, ledger: () => [] });
    const out = await getChartBalances(sb, "2026-10-10");
    expect(out.fiscalYearStart).toBe("2026-01-01");
    expect(out.figures).toEqual({ bank: 0, sales: 0, rent: 0, stock: 0 });
  });

  it("returns the inventory accounts the shared rule picks", async () => {
    const { sb } = fakeClient({ startMonth: 1, accounts, ledger: () => [] });
    const out = await getChartBalances(sb, "2026-10-10");
    expect(out.inventoryAccountIds).toEqual(["stock"]);
  });
});
