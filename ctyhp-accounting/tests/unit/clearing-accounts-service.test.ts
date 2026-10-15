import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ClearingAccountsError, getClearingStanding } from "@/lib/services/clearing-accounts";

type Rows = Record<string, unknown>[];

/** A stand-in for PostgREST: the RPC pages at a row cap and records its arguments, ordering and ranges. */
function fakeClient(rows: Rows, error: { message: string } | null = null, cap = 1000) {
  const calls: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  const orders: string[] = [];
  const ranges: [number, number][] = [];
  const sb = {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      const chain = {
        order: (column: string) => {
          orders.push(column);
          return chain;
        },
        range: (from: number, to: number) => {
          ranges.push([from, to]);
          if (error) return Promise.resolve({ data: null, error });
          return Promise.resolve({ data: rows.slice(from, from + Math.min(to - from + 1, cap)), error: null });
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { sb, calls, orders, ranges };
}

const row = (i: number): Record<string, unknown> => ({
  account_id: `acct-${String(i).padStart(5, "0")}`,
  balance_minor: String(i * 100),
  last_movement_date: "2026-03-04",
  open_count: i,
  open_oldest_date: "2026-02-01",
  open_minor: String(i * 100),
});

describe("getClearingStanding", () => {
  it("asks for the day, orders by the account id and maps each row", async () => {
    const { sb, calls, orders } = fakeClient([row(1), row(2)]);
    const out = await getClearingStanding(sb, "2026-09-30");
    expect(calls).toEqual([{ fn: "acc_clearing_standing", args: { p_as_of: "2026-09-30" } }]);
    expect(orders).toEqual(["account_id"]);
    expect(out.map((s) => s.accountId)).toEqual(["acct-00001", "acct-00002"]);
    expect(out[1]).toEqual({
      accountId: "acct-00002",
      balanceMinor: 200,
      lastMovementDate: "2026-03-04",
      openCount: 2,
      openOldestDate: "2026-02-01",
      openMinor: 200,
    });
  });

  it("returns nothing for a company with no clearing account", async () => {
    const { sb } = fakeClient([]);
    expect(await getClearingStanding(sb, "2026-09-30")).toEqual([]);
  });

  it("reads every page past the 1,000-row cap", async () => {
    const rows = Array.from({ length: 2_350 }, (_, i) => row(i + 1));
    const { sb, ranges } = fakeClient(rows);
    const out = await getClearingStanding(sb, "2026-09-30");
    expect(out).toHaveLength(2_350);
    expect(new Set(out.map((s) => s.accountId)).size).toBe(2_350);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("surfaces a failed read as a ClearingAccountsError with the database message", async () => {
    const { sb } = fakeClient([], { message: "function acc_clearing_standing does not exist" });
    await expect(getClearingStanding(sb, "2026-09-30")).rejects.toBeInstanceOf(ClearingAccountsError);
    await expect(getClearingStanding(sb, "2026-09-30")).rejects.toThrow("function acc_clearing_standing does not exist");
  });
});
