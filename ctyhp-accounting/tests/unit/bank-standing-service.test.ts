import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// bankrec pulls in server-only modules.
vi.mock("server-only", () => ({}));

import { BankRecError } from "@/lib/services/bankrec";
import { getBankStanding } from "@/lib/services/bank-standing";

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
  bank_account_id: `acct-${String(i).padStart(5, "0")}`,
  last_completed_id: null,
  last_completed_date: null,
  last_closing_minor: null,
  last_brought_forward: false,
  since_count: String(i),
  since_net_minor: "100",
  earlier_open_count: 0,
  earlier_open_net_minor: 0,
  void_ticked_count: 0,
  void_ticked_minor: 0,
  void_reconciliation_date: null,
  book_minor: "100",
});

describe("getBankStanding", () => {
  it("asks for the day, orders by the bank account id and maps each row", async () => {
    const { sb, calls, orders } = fakeClient([row(1), row(2)]);
    const out = await getBankStanding(sb, "2026-09-30");
    expect(calls).toEqual([{ fn: "acc_bank_standing", args: { p_as_of: "2026-09-30" } }]);
    expect(orders).toEqual(["bank_account_id"]);
    expect(out.map((s) => s.bankAccountId)).toEqual(["acct-00001", "acct-00002"]);
    expect(out[1]).toMatchObject({ sinceCount: 2, sinceNetMinor: 100, bookMinor: 100, lastCompletedDate: null });
  });

  it("returns nothing for a company with no bank account", async () => {
    const { sb } = fakeClient([]);
    expect(await getBankStanding(sb, "2026-09-30")).toEqual([]);
  });

  it("reads every page past the 1,000-row cap", async () => {
    const rows = Array.from({ length: 2_350 }, (_, i) => row(i + 1));
    const { sb, ranges } = fakeClient(rows);
    const out = await getBankStanding(sb, "2026-09-30");
    expect(out).toHaveLength(2_350);
    expect(new Set(out.map((s) => s.bankAccountId)).size).toBe(2_350);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("surfaces a failed read as a BankRecError with the database message", async () => {
    const { sb } = fakeClient([], { message: "function acc_bank_standing does not exist" });
    await expect(getBankStanding(sb, "2026-09-30")).rejects.toBeInstanceOf(BankRecError);
    await expect(getBankStanding(sb, "2026-09-30")).rejects.toThrow("function acc_bank_standing does not exist");
  });
});
