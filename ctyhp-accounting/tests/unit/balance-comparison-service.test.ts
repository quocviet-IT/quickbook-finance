import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUserRole: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
// The balances come from the chart read, which asks the ledger; it has its own tests.
vi.mock("@/lib/services/chart-balances", () => ({
  getChartBalances: async () => ({ asOf: "2026-09-30", fiscalYearStart: "2026-01-01", figures: { a: 5 }, inventoryAccountIds: [] }),
}));
vi.mock("@/lib/auth", () => ({
  getUserRole: mocks.getUserRole,
  canWrite: (role: string | null) => role === "admin" || role === "accountant",
}));

import { saveBalanceComparisonAction } from "@/app/(app)/reports/balance-comparison/actions";
import {
  listComparisonAccounts,
  listComparisonDates,
  listComparisonLines,
  loadBalanceComparison,
  saveBalanceComparison,
} from "@/lib/services/balance-comparison";

/** A client whose tables answer with the rows given and which records how they were asked. */
function fakeClient(tables: Record<string, unknown[]>, rpcResult: { data?: unknown; error?: { message: string } | null } = {}) {
  const calls: { table: string; order: string[]; eq: [string, unknown][]; range: [number, number][] }[] = [];
  const from = vi.fn((table: string) => {
    const call = { table, order: [] as string[], eq: [] as [string, unknown][], range: [] as [number, number][] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.order = (column: string) => {
      call.order.push(column);
      return builder;
    };
    builder.eq = (column: string, value: unknown) => {
      call.eq.push([column, value]);
      return builder;
    };
    builder.range = async (a: number, b: number) => {
      call.range.push([a, b]);
      return { data: tables[table] ?? [], error: null };
    };
    builder.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
    return builder;
  });
  const rpc = vi.fn(async () => ({ data: rpcResult.data ?? 0, error: rpcResult.error ?? null }));
  return { sb: { from, rpc } as unknown as SupabaseClient, calls, rpc };
}

describe("reading", () => {
  it("reads every account in chart order, ending the order in the id, with its status", async () => {
    const { sb, calls } = fakeClient({
      acc_account: [
        { id: "a", account_code: "1000", name: "Till", account_type: "bank", is_contra: false, status: "active" },
        { id: "b", account_code: "1900", name: "Old", account_type: "fixed_asset", is_contra: null, status: "inactive" },
      ],
    });
    const accounts = await listComparisonAccounts(sb);
    expect(accounts).toEqual([
      { id: "a", code: "1000", name: "Till", type: "bank", isContra: false, active: true },
      { id: "b", code: "1900", name: "Old", type: "fixed_asset", isContra: false, active: false },
    ]);
    expect(calls[0].order).toEqual(["account_code", "id"]);
    expect(calls[0].range).toEqual([[0, 999]]);
  });

  it("pages past 1,000 saved dates, ordered by date then id", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({ as_of: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` }));
    let page = 0;
    const calls: number[][] = [];
    const sb = {
      from: () => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.order = () => b;
        b.range = async (a: number, z: number) => {
          calls.push([a, z]);
          page += 1;
          return { data: page === 1 ? first : [{ as_of: "2027-02-03" }], error: null };
        };
        return b;
      },
    } as unknown as SupabaseClient;
    const dates = await listComparisonDates(sb);
    expect(dates).toHaveLength(1001);
    expect(dates.at(-1)).toBe("2027-02-03");
    expect(calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it("reads one date's lines in id order and turns bigint figures into numbers", async () => {
    const { sb, calls } = fakeClient({
      acc_balance_comparison_line: [
        { account_id: "a", external_code: null, external_name: null, other_balance_minor: "12345" },
        { account_id: null, external_code: "X1", external_name: "Outside", external_group: "liability", other_balance_minor: -500 },
      ],
    });
    const lines = await listComparisonLines(sb, "2026-09-30");
    expect(lines).toEqual([
      { accountId: "a", externalCode: null, externalName: null, externalGroup: null, otherMinor: 12345 },
      { accountId: null, externalCode: "X1", externalName: "Outside", externalGroup: "liability", otherMinor: -500 },
    ]);
    expect(calls[0].eq).toEqual([["as_of", "2026-09-30"]]);
    expect(calls[0].order).toEqual(["id"]);
  });

  it("loads nothing but an empty report when no comparison is saved for the date", async () => {
    const { sb } = fakeClient(
      {
        acc_account: [{ id: "a", account_code: "1000", name: "Till", account_type: "bank", is_contra: false, status: "active" }],
        acc_balance_comparison: [],
        acc_balance_comparison_line: [{ account_id: "a", other_balance_minor: 1 }],
        acc_company_settings: [],
      },
    );
    const data = await loadBalanceComparison(sb, "2026-09-30");
    expect(data.header).toBeNull();
    // Lines with no header are not shown: a stale line cannot appear under a date that was never saved.
    expect(data.lines).toEqual([]);
    expect(data.figures).toEqual({ a: 5 });
    expect(data.accounts).toHaveLength(1);
  });
});

describe("saving", () => {
  it("sends the date, the name, the note and the lines in the shape the function reads", async () => {
    const { sb, rpc } = fakeClient({}, { data: 2 });
    const kept = await saveBalanceComparison(sb, {
      asOf: "2026-09-30",
      comparedWith: " Sample Ledger ",
      note: "  ",
      lines: [
        { accountId: "acct-1", otherMinor: 12345 },
        { externalCode: "X9", externalName: "Outside", externalGroup: "income", otherMinor: -500 },
      ],
    });
    expect(kept).toBe(2);
    expect(rpc).toHaveBeenCalledWith("acc_save_balance_comparison", {
      p_as_of: "2026-09-30",
      p_compared_with: "Sample Ledger",
      p_note: null,
      p_lines: [
        { account_id: "acct-1", other_balance_minor: 12345 },
        { external_code: "X9", external_name: "Outside", external_group: "income", other_balance_minor: -500 },
      ],
    });
  });

  it("passes the database's plain message through as the error", async () => {
    const { sb } = fakeClient({}, { error: { message: "An account code appears twice" } });
    await expect(
      saveBalanceComparison(sb, { asOf: "2026-09-30", comparedWith: "Sample Ledger", note: "", lines: [] }),
    ).rejects.toThrow("An account code appears twice");
  });
});

describe("saveBalanceComparisonAction", () => {
  const draft = {
    asOf: "2026-09-30",
    comparedWith: "Sample Ledger",
    note: "",
    lines: [{ accountId: "acct-1", otherMinor: 1000 }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserRole.mockResolvedValue("accountant");
  });

  it("refuses a viewer before it reads or writes anything", async () => {
    mocks.getUserRole.mockResolvedValue("viewer");
    const result = await saveBalanceComparisonAction(draft);
    expect(result).toEqual({ ok: false, error: "You do not have permission to save a balance comparison" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("says what is wrong with a draft without calling the database", async () => {
    const result = await saveBalanceComparisonAction({ ...draft, comparedWith: " " });
    expect(result).toEqual({ ok: false, error: "Enter the name of the other system" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("refuses a draft that is not shaped like one", async () => {
    const result = await saveBalanceComparisonAction({ ...draft, lines: [{ accountId: "a", otherMinor: 1.5 }] });
    expect(result.ok).toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("saves, says how many figures were kept, and revalidates the page", async () => {
    const { sb, rpc } = fakeClient({}, { data: 1 });
    mocks.createClient.mockResolvedValue(sb);
    const result = await saveBalanceComparisonAction(draft);
    expect(result).toEqual({ ok: true, data: { kept: 1, message: "Saved 1 figure for Sep 30, 2026." } });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/reports/balance-comparison");
  });

  it("shows the database's message when it refuses", async () => {
    const { sb } = fakeClient({}, { error: { message: "Choose an active account for each figure" } });
    mocks.createClient.mockResolvedValue(sb);
    const result = await saveBalanceComparisonAction(draft);
    expect(result).toEqual({ ok: false, error: "Choose an active account for each figure" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
