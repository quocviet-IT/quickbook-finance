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

describe("getBankStandingWithChanges", () => {
  /** One client answering both reads: the standing, and the changes to completed reconciliations. */
  function twoReads(changes: Rows | Error) {
    const calls: string[] = [];
    const orders: Record<string, string[]> = {};
    const sb = {
      rpc: (fn: string) => {
        calls.push(fn);
        const chain = {
          order: (column: string) => {
            (orders[fn] ??= []).push(column);
            return chain;
          },
          range: () => {
            if (fn === "acc_reconciliation_changes" && changes instanceof Error) {
              return Promise.resolve({ data: null, error: { message: changes.message } });
            }
            return Promise.resolve({ data: fn === "acc_bank_standing" ? [row(1), row(2)] : changes, error: null });
          },
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    return { sb, calls, orders };
  }

  const change = {
    change_key: "voided:r1:e1",
    reconciliation_id: "r1",
    bank_account_id: "acct-00001",
    statement_ending_date: "2026-08-31",
    completed_at: "2026-09-02T10:00:00Z",
    kind: "voided",
    entry_id: "e1",
    entry_number: "JE-900001",
    entry_date: "2026-08-20",
    signed_minor: "100",
  };

  it("counts the changed reconciliations on each account, with one extra read ordered by change_key", async () => {
    const { sb, calls, orders } = twoReads([change]);
    const { getBankStandingWithChanges } = await import("@/lib/services/bank-standing");
    const out = await getBankStandingWithChanges(sb, "2026-09-30");
    expect([...calls].sort()).toEqual(["acc_bank_standing", "acc_reconciliation_changes"]);
    expect(orders.acc_reconciliation_changes).toEqual(["change_key"]);
    expect(out.map((s) => s.changedReconciliations)).toEqual([1, 0]);
  });

  it("returns the plain standing when the changes cannot be read", async () => {
    const { sb } = twoReads(new Error("acc_reconciliation_changes missing"));
    const { getBankStandingWithChanges } = await import("@/lib/services/bank-standing");
    const out = await getBankStandingWithChanges(sb, "2026-09-30");
    expect(out).toHaveLength(2);
    expect(out[0].changedReconciliations).toBeUndefined();
  });

  it("uses changes already read by the caller, with no further read", async () => {
    const { sb, calls } = twoReads([]);
    const { toReconciliationChange } = await import("@/lib/domain/reconciliation-changes");
    const out = await getBankStanding(sb, "2026-09-30", [toReconciliationChange(change)]);
    expect(calls).toEqual(["acc_bank_standing"]);
    expect(out.map((s) => s.changedReconciliations)).toEqual([1, 0]);
  });
});
