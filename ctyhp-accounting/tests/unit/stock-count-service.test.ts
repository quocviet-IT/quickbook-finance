import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createStockCount,
  getBookValue,
  getPostingContext,
  getStockCount,
  listStockCounts,
  listStockCountSummaries,
  markStockCountPending,
  postStockCount,
  saveStockCount,
  StockCountError,
} from "@/lib/services/stock-count";

type Row = Record<string, unknown>;
type Reply = { data: unknown; error: { message: string } | null; count?: number | null };

interface Call {
  table?: string;
  rpc?: string;
  args?: unknown;
  orders: { column: string; ascending: boolean }[];
  filters: [string, unknown][];
  range?: [number, number];
}

/**
 * A stub client. `tables` and `rpcs` give each answer; a function answer is
 * handed the call, so a test can serve pages by range.
 */
function stub(config: {
  tables?: Record<string, Reply | ((c: Call) => Reply)>;
  rpcs?: Record<string, Reply | ((c: Call) => Reply)>;
}): { sb: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const answer = (source: Reply | ((c: Call) => Reply) | undefined, call: Call): Reply =>
    source === undefined ? { data: [], error: null } : typeof source === "function" ? source(call) : source;

  const source = (call: Call) => (call.rpc ? config.rpcs?.[call.rpc] : config.tables?.[call.table ?? ""]);

  const builder = (call: Call) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (c: string, v: unknown) => (call.filters.push([c, v]), chain),
      order: (column: string, opts?: { ascending?: boolean }) => (
        call.orders.push({ column, ascending: opts?.ascending ?? true }), chain
      ),
      range: (a: number, b: number) => ((call.range = [a, b]), chain),
      maybeSingle: () => Promise.resolve(answer(source(call), call)),
      then: (resolve: (r: Reply) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(answer(source(call), call)).then(resolve, reject),
    };
    return chain;
  };

  const sb = {
    from: (table: string) => {
      const call: Call = { table, orders: [], filters: [] };
      calls.push(call);
      return builder(call);
    },
    rpc: (fn: string, args?: unknown) => {
      const call: Call = { rpc: fn, args, orders: [], filters: [] };
      calls.push(call);
      return builder(call);
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

const headerRow = (over: Row = {}): Row => ({
  id: "c1",
  count_number: "SC-000001",
  as_of: "2026-06-30",
  status: "draft",
  memo: null,
  counted_minor: null,
  book_minor: null,
  difference_minor: null,
  ...over,
});

describe("listStockCounts", () => {
  it("pages past 1,000 rows, newest first, with the unique id last in the order", async () => {
    const all = Array.from({ length: 1200 }, (_, i) => headerRow({ id: `c${i}`, count_number: `SC-${i}` }));
    const { sb, calls } = stub({
      tables: {
        acc_stock_count: (c) => ({ data: all.slice(c.range![0], c.range![1] + 1), error: null }),
      },
    });
    const rows = await listStockCounts(sb);
    expect(rows).toHaveLength(1200);
    expect(calls).toHaveLength(2);
    expect(calls[0].orders).toEqual([
      { column: "as_of", ascending: false },
      { column: "count_number", ascending: false },
      { column: "id", ascending: false },
    ]);
  });

  it("turns bigint columns that arrive as strings into numbers", async () => {
    const { sb } = stub({
      tables: {
        acc_stock_count: {
          data: [headerRow({ status: "posted", counted_minor: "120000", book_minor: "100000", difference_minor: "20000" })],
          error: null,
        },
      },
    });
    const [row] = await listStockCounts(sb);
    expect([row.counted_minor, row.book_minor, row.difference_minor]).toEqual([120000, 100000, 20000]);
  });

  it("throws a StockCountError with the database's message", async () => {
    const { sb } = stub({ tables: { acc_stock_count: { data: null, error: { message: "boom" } } } });
    await expect(listStockCounts(sb)).rejects.toThrow(new StockCountError("boom"));
  });
});

describe("getStockCount", () => {
  it("returns the header with its lines ordered by line_order, then id", async () => {
    const { sb, calls } = stub({
      tables: {
        acc_stock_count: { data: headerRow(), error: null },
        acc_stock_count_line: {
          data: [
            { id: "l1", stock_count_id: "c1", line_order: 1, name: "Bolt", sku: null, quantity: "10.5", unit_cost_minor: "250", sells_for_minor: null },
          ],
          error: null,
        },
      },
    });
    const found = await getStockCount(sb, "c1");
    expect(found?.count.count_number).toBe("SC-000001");
    expect(found?.lines[0]).toMatchObject({ quantity: 10.5, unit_cost_minor: 250, sells_for_minor: null });
    const lineCall = calls.find((c) => c.table === "acc_stock_count_line")!;
    expect(lineCall.filters).toEqual([["stock_count_id", "c1"]]);
    expect(lineCall.orders.map((o) => o.column)).toEqual(["line_order", "id"]);
  });

  it("pages the lines of a long sheet", async () => {
    const lines = Array.from({ length: 1500 }, (_, i) => ({
      id: `l${i}`, stock_count_id: "c1", line_order: i + 1, name: "n", sku: null, quantity: 1, unit_cost_minor: 1, sells_for_minor: null,
    }));
    const { sb } = stub({
      tables: {
        acc_stock_count: { data: headerRow(), error: null },
        acc_stock_count_line: (c) => ({ data: lines.slice(c.range![0], c.range![1] + 1), error: null }),
      },
    });
    expect((await getStockCount(sb, "c1"))?.lines).toHaveLength(1500);
  });

  it("returns null for a count that does not exist", async () => {
    const { sb } = stub({ tables: { acc_stock_count: { data: null, error: null } } });
    expect(await getStockCount(sb, "nope")).toBeNull();
  });
});

describe("getBookValue", () => {
  const balance = (account_id: string, debit_base: number, credit_base: number) => ({
    account_id, account_code: account_id, name: account_id, account_type: "current_asset", debit_base, credit_base,
  });

  it("sums debit less credit over the accounts the database calls inventory, up to the date", async () => {
    const { sb, calls } = stub({
      rpcs: {
        acc_inventory_account_ids: { data: ["inv1", "inv2"], error: null },
        acc_ledger_balances: { data: [balance("inv1", 500_000, 120_000), balance("inv2", 10_000, 0), balance("cash", 9_000_000, 0)], error: null },
      },
    });
    expect(await getBookValue(sb, "2026-06-30")).toBe(390_000);
    const ledger = calls.find((c) => c.rpc === "acc_ledger_balances")!;
    expect(ledger.args).toEqual({ p_from: null, p_to: "2026-06-30" });
  });

  it("is zero when the company has no inventory accounts", async () => {
    const { sb } = stub({
      rpcs: { acc_inventory_account_ids: { data: [], error: null }, acc_ledger_balances: { data: [balance("cash", 5, 0)], error: null } },
    });
    expect(await getBookValue(sb, "2026-06-30")).toBe(0);
  });

  it("reads ids wrapped as objects as well as bare", async () => {
    const { sb } = stub({
      rpcs: {
        acc_inventory_account_ids: { data: [{ acc_inventory_account_ids: "inv1" }], error: null },
        acc_ledger_balances: { data: [balance("inv1", 100, 40)], error: null },
      },
    });
    expect(await getBookValue(sb, "2026-06-30")).toBe(60);
  });

  it("reports a failed id read", async () => {
    const { sb } = stub({ rpcs: { acc_inventory_account_ids: { data: null, error: { message: "denied" } } } });
    await expect(getBookValue(sb, "2026-06-30")).rejects.toThrow("denied");
  });
});

describe("getPostingContext", () => {
  const accounts = [
    { id: "inv", account_code: "1200", name: "Inventory", account_type: "current_asset" },
    { id: "cash", account_code: "1000", name: "Cash", account_type: "current_asset" },
    { id: "cogs", account_code: "5000", name: "Cost of Goods Sold", account_type: "cost_of_goods_sold" },
    { id: "adj", account_code: "5010", name: "Inventory Adjustment", account_type: "cost_of_goods_sold" },
  ];
  const base = (over: { items?: number; allowed?: boolean } = {}) =>
    stub({
      tables: {
        acc_account: { data: accounts, error: null },
        acc_item: { data: null, error: null, count: over.items ?? 0 },
      },
      rpcs: {
        acc_inventory_account_ids: { data: ["inv"], error: null },
        acc_stock_count_default_accounts: { data: [{ inventory_account_id: "inv", offset_account_id: "adj" }], error: null },
        acc_has_permission: { data: over.allowed ?? true, error: null },
      },
    });

  it("lists the inventory and cost-of-sales accounts, the defaults, and the person's right", async () => {
    const { sb, calls } = base();
    const ctx = await getPostingContext(sb);
    expect(ctx.inventoryAccounts).toEqual([{ id: "inv", code: "1200", name: "Inventory" }]);
    expect(ctx.offsetAccounts.map((a) => a.id)).toEqual(["cogs", "adj"]);
    expect(ctx.defaultInventoryAccountId).toBe("inv");
    expect(ctx.defaultOffsetAccountId).toBe("adj");
    expect(ctx.tracksItems).toBe(false);
    expect(ctx.canAdjust).toBe(true);
    expect(calls.find((c) => c.rpc === "acc_has_permission")!.args).toEqual({ p_key: "inventory.adjust" });
    const chart = calls.find((c) => c.table === "acc_account")!;
    expect(chart.orders.map((o) => o.column)).toEqual(["account_code", "id"]);
  });

  it("says when the company tracks items, and when the person may not adjust", async () => {
    const ctx = await getPostingContext(base({ items: 3, allowed: false }).sb);
    expect(ctx.tracksItems).toBe(true);
    expect(ctx.canAdjust).toBe(false);
  });

  it("has no defaults when the database finds none", async () => {
    const { sb } = stub({
      tables: { acc_account: { data: [], error: null }, acc_item: { data: null, error: null, count: 0 } },
      rpcs: {
        acc_inventory_account_ids: { data: [], error: null },
        acc_stock_count_default_accounts: { data: [{ inventory_account_id: null, offset_account_id: null }], error: null },
        acc_has_permission: { data: false, error: null },
      },
    });
    const ctx = await getPostingContext(sb);
    expect([ctx.defaultInventoryAccountId, ctx.defaultOffsetAccountId]).toEqual([null, null]);
  });
});

describe("create, save, post and mark pending", () => {
  it("creates a count by calling acc_create_stock_count with the date", async () => {
    const { sb, calls } = stub({ rpcs: { acc_create_stock_count: { data: "c9", error: null } } });
    expect(await createStockCount(sb, "2026-06-30")).toBe("c9");
    expect(calls[0]).toMatchObject({ rpc: "acc_create_stock_count", args: { p_as_of: "2026-06-30" } });
  });

  it("saves the whole sheet with the column names the database reads", async () => {
    const { sb, calls } = stub({ rpcs: { acc_save_stock_count: { data: 2, error: null } } });
    const saved = await saveStockCount(sb, {
      id: "c1",
      asOf: "2026-06-30",
      memo: null,
      lines: [
        { name: "Bolt", sku: "B-1", quantity: 10.5, unitCostMinor: 250, sellsForMinor: 400 },
        { name: "Nut", sku: null, quantity: 3, unitCostMinor: 99, sellsForMinor: null },
      ],
    });
    expect(saved).toBe(2);
    expect(calls[0].args).toEqual({
      p_id: "c1",
      p_as_of: "2026-06-30",
      p_memo: null,
      p_lines: [
        { name: "Bolt", sku: "B-1", quantity: 10.5, unit_cost_minor: 250, sells_for_minor: 400 },
        { name: "Nut", sku: null, quantity: 3, unit_cost_minor: 99, sells_for_minor: null },
      ],
    });
  });

  it("posts with both accounts and returns the entry id", async () => {
    const { sb, calls } = stub({ rpcs: { acc_post_stock_count: { data: "je1", error: null } } });
    expect(await postStockCount(sb, { id: "c1", inventoryAccountId: "inv", offsetAccountId: "adj" })).toBe("je1");
    expect(calls[0].args).toEqual({ p_id: "c1", p_inventory_account_id: "inv", p_offset_account_id: "adj" });
  });

  it("marks a count pending with its request", async () => {
    const { sb, calls } = stub({ rpcs: { acc_mark_stock_count_pending: { data: null, error: null } } });
    await markStockCountPending(sb, "c1", "r1");
    expect(calls[0].args).toEqual({ p_id: "c1", p_request_id: "r1" });
  });

  it("raises the database's message for each call", async () => {
    const err = { data: null, error: { message: "Accounting period for 2026-06-30 is closed" } };
    const { sb } = stub({
      rpcs: { acc_create_stock_count: err, acc_save_stock_count: err, acc_post_stock_count: err, acc_mark_stock_count_pending: err },
    });
    await expect(createStockCount(sb, "2026-06-30")).rejects.toThrow("is closed");
    await expect(saveStockCount(sb, { id: "c", asOf: "2026-06-30", memo: null, lines: [] })).rejects.toThrow("is closed");
    await expect(postStockCount(sb, { id: "c", inventoryAccountId: "a", offsetAccountId: "b" })).rejects.toThrow("is closed");
    await expect(markStockCountPending(sb, "c", "r")).rejects.toThrow("is closed");
  });
});

describe("listStockCountSummaries", () => {
  it("reads each count with the number of lines it holds", async () => {
    const { sb, calls } = stub({
      tables: {
        acc_stock_count: {
          data: [
            { id: "a", count_number: "SC-000002", as_of: "2026-06-30", status: "draft", counted_minor: null, lines: [{ count: 3 }] },
            { id: "b", count_number: "SC-000001", as_of: "2026-03-31", status: "posted", counted_minor: "500", lines: [] },
          ],
          error: null,
        },
      },
    });
    const rows = await listStockCountSummaries(sb);
    expect(rows.map((r) => r.lineCount)).toEqual([3, 0]);
    expect(rows[1].counted_minor).toBe(500);
    expect(calls[0].orders.map((o) => o.column)).toEqual(["as_of", "count_number", "id"]);
  });
});
