import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getLedgerBalances,
  getMonthlyLedgerBalances,
  getTransactionList,
} from "@/lib/services/reports";

const PAGE = 1000;

/**
 * A stand-in for PostgREST's row cap on a stored-procedure call.
 *
 * PostgREST's `db-max-rows` caps rows read from "a view, table, or stored
 * procedure" alike, and reports no error when it truncates. A bare
 * `await sb.rpc(fn, args)` — no `.range()` — gets exactly that: the first
 * `cap` rows and nothing past them, the same shape `tests/unit/import-
 * existing-hashes.test.ts` pins for a plain select. `.range(from, to)` pages
 * through the rest, exactly as PostgREST does for a table or view.
 */
function rpcClientWith(
  fn: string,
  rows: readonly Record<string, unknown>[],
  options: { cap?: number; failOnCall?: number } = {},
): { sb: SupabaseClient; calls: () => number } {
  const cap = options.cap ?? PAGE;
  let calls = 0;
  const rowsBetween = (from: number, to: number) => {
    calls += 1;
    if (options.failOnCall === calls) {
      return { data: null, error: { message: "boom" } };
    }
    const width = Math.min(to - from + 1, cap);
    return { data: rows.slice(from, from + width), error: null };
  };
  const sb = {
    rpc(name: string) {
      if (name !== fn) throw new Error(`unexpected rpc ${name}`);
      return {
        // Awaitable on its own, exactly as PostgREST is: a caller that never
        // asks for a range still gets an answer, silently capped. That is
        // what makes an implementation without paging fail here on the count
        // rather than on a missing method.
        range: (from: number, to: number) => Promise.resolve(rowsBetween(from, to)),
        then: (resolve: (value: unknown) => unknown) => resolve(rowsBetween(0, cap - 1)),
      };
    },
  } as unknown as SupabaseClient;
  return { sb, calls: () => calls };
}

function ledgerRow(i: number): Record<string, unknown> {
  return {
    account_id: `acct-${i}`,
    account_code: String(1000 + i),
    name: `Account ${i}`,
    account_type: "asset",
    debit_base: i,
    credit_base: 0,
  };
}

function txnRow(i: number): Record<string, unknown> {
  return {
    entry_id: `entry-${i}`,
    entry_number: String(i).padStart(6, "0"),
    entry_date: "2026-01-01",
    description: `Row ${i}`,
    source_type: "manual",
    party_name: null,
    category_label: null,
    money_label: null,
    amount_minor: i,
    currency_code: "USD",
    reconciled: false,
    account_ids: [],
  };
}

function monthlyRow(i: number): Record<string, unknown> {
  return {
    month_key: "2026-01",
    account_id: `acct-${i}`,
    account_code: String(1000 + i),
    name: `Account ${i}`,
    account_type: "asset",
    debit_base: i,
    credit_base: 0,
  };
}

describe("getLedgerBalances pages past the thousand-row cap", () => {
  it("reads 2,345 rows complete and in order, across three pages", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => ledgerRow(i));
    const { sb, calls } = rpcClientWith("acc_ledger_balances", rows);
    const result = await getLedgerBalances(sb, null, "2026-12-31");
    expect(result).toHaveLength(2345);
    expect(result[0].accountCode).toBe("1000");
    expect(result[2344].accountCode).toBe("3344");
    expect(result.map((r) => r.accountCode)).toEqual(rows.map((r) => r.account_code));
    expect(calls()).toBe(3);
  });

  it("costs exactly one request under the cap", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ledgerRow(i));
    const { sb, calls } = rpcClientWith("acc_ledger_balances", rows);
    const result = await getLedgerBalances(sb, null, "2026-12-31");
    expect(result).toHaveLength(12);
    expect(calls()).toBe(1);
  });

  it("returns all 1,000 rows at the exact boundary, and stops", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ledgerRow(i));
    const { sb, calls } = rpcClientWith("acc_ledger_balances", rows);
    const result = await getLedgerBalances(sb, null, "2026-12-31");
    expect(result).toHaveLength(1000);
    expect(result[999].accountCode).toBe("1999");
    expect(calls()).toBe(2);
  });

  it("throws on a page error instead of returning a partial read", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => ledgerRow(i));
    const { sb } = rpcClientWith("acc_ledger_balances", rows, { failOnCall: 2 });
    await expect(getLedgerBalances(sb, null, "2026-12-31")).rejects.toThrow("boom");
  });
});

describe("getTransactionList pages past the thousand-row cap", () => {
  it("reads 2,345 rows complete and in order, across three pages", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => txnRow(i));
    const { sb, calls } = rpcClientWith("acc_transaction_list", rows);
    const result = await getTransactionList(sb, "2026-01-01", "2026-12-31");
    expect(result).toHaveLength(2345);
    expect(result[0].entryNumber).toBe("000000");
    expect(result[2344].entryNumber).toBe("002344");
    expect(result.map((r) => r.entryNumber)).toEqual(rows.map((r) => r.entry_number));
    expect(calls()).toBe(3);
  });

  it("costs exactly one request under the cap", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => txnRow(i));
    const { sb, calls } = rpcClientWith("acc_transaction_list", rows);
    const result = await getTransactionList(sb, "2026-01-01", "2026-12-31");
    expect(result).toHaveLength(12);
    expect(calls()).toBe(1);
  });

  it("returns all 1,000 rows at the exact boundary, and stops", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => txnRow(i));
    const { sb, calls } = rpcClientWith("acc_transaction_list", rows);
    const result = await getTransactionList(sb, "2026-01-01", "2026-12-31");
    expect(result).toHaveLength(1000);
    expect(result[999].entryNumber).toBe("000999");
    expect(calls()).toBe(2);
  });

  it("throws on a page error instead of returning a partial read", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => txnRow(i));
    const { sb } = rpcClientWith("acc_transaction_list", rows, { failOnCall: 2 });
    await expect(getTransactionList(sb, "2026-01-01", "2026-12-31")).rejects.toThrow("boom");
  });
});

describe("getMonthlyLedgerBalances pages past the thousand-row cap", () => {
  it("reads 2,345 rows complete and in order, across three pages", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => monthlyRow(i));
    const { sb, calls } = rpcClientWith("acc_monthly_ledger_balances", rows);
    const result = await getMonthlyLedgerBalances(sb, "2026-12-31", 12);
    const month = result.get("2026-01") ?? [];
    expect(month).toHaveLength(2345);
    expect(month[0].accountCode).toBe("1000");
    expect(month[2344].accountCode).toBe("3344");
    expect(month.map((r) => r.accountCode)).toEqual(rows.map((r) => r.account_code));
    expect(calls()).toBe(3);
  });

  it("costs exactly one request under the cap", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => monthlyRow(i));
    const { sb, calls } = rpcClientWith("acc_monthly_ledger_balances", rows);
    const result = await getMonthlyLedgerBalances(sb, "2026-12-31", 12);
    expect(result.get("2026-01")).toHaveLength(12);
    expect(calls()).toBe(1);
  });

  it("returns all 1,000 rows at the exact boundary, and stops", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => monthlyRow(i));
    const { sb, calls } = rpcClientWith("acc_monthly_ledger_balances", rows);
    const result = await getMonthlyLedgerBalances(sb, "2026-12-31", 12);
    const month = result.get("2026-01") ?? [];
    expect(month).toHaveLength(1000);
    expect(month[999].accountCode).toBe("1999");
    expect(calls()).toBe(2);
  });

  it("throws on a page error instead of returning a partial read", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => monthlyRow(i));
    const { sb } = rpcClientWith("acc_monthly_ledger_balances", rows, { failOnCall: 2 });
    await expect(getMonthlyLedgerBalances(sb, "2026-12-31", 12)).rejects.toThrow("boom");
  });
});
