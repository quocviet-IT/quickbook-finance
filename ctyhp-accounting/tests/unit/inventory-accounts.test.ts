import { describe, expect, it } from "vitest";
import { pickInventoryAccounts, type InventoryAccountCandidate } from "@/lib/domain/inventory-accounts";
import { getInventoryAccounts } from "@/lib/services/inventory-accounts";

const account = (over: Partial<InventoryAccountCandidate> & { id: string }): InventoryAccountCandidate => ({
  name: "Something",
  accountType: "current_asset",
  cashFlowRole: null,
  ...over,
});

describe("pickInventoryAccounts", () => {
  it("takes the accounts inventory items post to", () => {
    const pick = pickInventoryAccounts({
      itemInventoryAccountIds: ["a2", "a2", null],
      accounts: [account({ id: "a1", name: "Stock room" }), account({ id: "a2", name: "Goods" })],
    });
    expect(pick).toEqual({ accountIds: ["a2"], basis: "items-or-role" });
  });

  it("adds accounts whose cash-flow role is operating_inventory", () => {
    const pick = pickInventoryAccounts({
      itemInventoryAccountIds: ["a3"],
      accounts: [account({ id: "a1", cashFlowRole: "operating_inventory" }), account({ id: "a3" })],
    });
    expect(pick).toEqual({ accountIds: ["a1", "a3"], basis: "items-or-role" });
  });

  it("uses the role alone when no item names an account", () => {
    const pick = pickInventoryAccounts({
      itemInventoryAccountIds: [],
      accounts: [account({ id: "a1", name: "Goods", cashFlowRole: "operating_inventory" })],
    });
    expect(pick.accountIds).toEqual(["a1"]);
  });

  it("falls back to current assets named inventory or stock only when both are empty", () => {
    const accounts = [
      account({ id: "a1", name: "Inventory" }),
      account({ id: "a2", name: "Raw STOCK" }),
      account({ id: "a3", name: "Stockholder loan", accountType: "current_liability" }),
      account({ id: "a4", name: "Prepaid rent" }),
    ];
    expect(pickInventoryAccounts({ itemInventoryAccountIds: [], accounts })).toEqual({
      accountIds: ["a1", "a2"],
      basis: "name",
    });
    // The fallback is not consulted once the first rule finds something.
    expect(pickInventoryAccounts({ itemInventoryAccountIds: ["a4"], accounts })).toEqual({
      accountIds: ["a4"],
      basis: "items-or-role",
    });
  });

  it("finds nothing in a chart with no stock", () => {
    expect(pickInventoryAccounts({ itemInventoryAccountIds: [null], accounts: [account({ id: "a1", name: "Cash drawer", accountType: "bank" })] })).toEqual({
      accountIds: [],
      basis: "none",
    });
  });
});

/** A client whose tables answer with fixed rows and honour only the page range. */
function fakeClient(tables: Record<string, Record<string, unknown>[]>, seen: string[] = []) {
  return {
    from(table: string) {
      seen.push(table);
      const state = { range: [0, 999] as [number, number], filters: [] as string[] };
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.order = self;
      chain.eq = (column: string, value: unknown) => {
        state.filters.push(`${column}=${String(value)}`);
        return chain;
      };
      chain.not = (column: string) => {
        state.filters.push(`${column} not null`);
        return chain;
      };
      chain.range = (from: number, to: number) => {
        state.range = [from, to];
        return chain;
      };
      chain.then = (resolve: (v: unknown) => unknown) => {
        let rows = tables[table] ?? [];
        if (state.filters.includes("is_inventory=true")) rows = rows.filter((r) => r.is_inventory === true);
        if (state.filters.includes("inventory_account_id not null")) rows = rows.filter((r) => r.inventory_account_id !== null);
        return resolve({ data: rows.slice(state.range[0], state.range[1] + 1), error: null });
      };
      return chain;
    },
  };
}

describe("getInventoryAccounts", () => {
  it("reads items and the chart and applies the rule", async () => {
    const sb = fakeClient({
      acc_item: [
        { id: "i1", is_inventory: true, inventory_account_id: "a2" },
        { id: "i2", is_inventory: false, inventory_account_id: "a1" },
        { id: "i3", is_inventory: true, inventory_account_id: null },
      ],
      acc_account: [
        { id: "a1", name: "Inventory", account_type: "current_asset", cash_flow_role: null },
        { id: "a2", name: "Goods", account_type: "current_asset", cash_flow_role: null },
        { id: "a3", name: "Gold", account_type: "current_asset", cash_flow_role: "operating_inventory" },
      ],
    });
    const pick = await getInventoryAccounts(sb as never);
    expect(pick).toEqual({ accountIds: ["a2", "a3"], basis: "items-or-role" });
  });

  it("pages past 1,000 rows", async () => {
    const accounts = Array.from({ length: 2_300 }, (_, n) => ({
      id: `a${String(n).padStart(5, "0")}`,
      name: n === 2_250 ? "Inventory" : "Other",
      account_type: "current_asset",
      cash_flow_role: null,
    }));
    const pick = await getInventoryAccounts(fakeClient({ acc_item: [], acc_account: accounts }) as never);
    expect(pick).toEqual({ accountIds: ["a02250"], basis: "name" });
  });
});
