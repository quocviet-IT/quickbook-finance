import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

const plaid = { sync: vi.fn() };
vi.mock("@/lib/services/plaid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/plaid")>();
  return { ...actual, syncPlaidTransactions: (...args: unknown[]) => plaid.sync(...args) };
});
vi.mock("@/lib/services/bank-token-crypto", () => ({
  decryptBankToken: (payload: string) => `plain:${payload}`,
  encryptBankToken: (token: string) => `sealed:${token}`,
}));

const { syncBankConnection } = await import("@/lib/services/banking");

const transaction = (id: string, amount: number) => ({
  transaction_id: id,
  account_id: "acc-example-1",
  date: "2026-09-01",
  authorized_date: null,
  name: `EXAMPLE ${id}`,
  merchant_name: null,
  amount,
  pending: false,
  personal_finance_category: null,
});

/** A stand-in for the client: tables answer with fixed rows (none for the ones a sync only scans), rpc answers by name; every rpc is recorded. */
function fakeClient(rpcs: Record<string, unknown>) {
  const tables: Record<string, unknown[]> = {
    acc_bank_connection: [{ id: "conn-1", sync_cursor: "cursor-before", status: "active" }],
    acc_bank_feed_account: [{ bank_account_id: "bank-1", provider_account_id: "acc-example-1", currency_code: "USD" }],
    acc_currency: [{ code: "USD", decimal_places: 2 }],
    acc_bank_account: [{ account_id: "gl-1" }],
  };
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "is", "not", "in", "order"]) chain[name] = () => chain;
    chain.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    chain.range = (start: number, end: number) => Promise.resolve({ data: rows.slice(start, end + 1), error: null });
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
    return chain;
  };
  const sb = {
    from,
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: rpcs[fn] ?? null, error: null });
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

beforeEach(() => {
  plaid.sync.mockReset();
});

describe("syncBankConnection", () => {
  it("applies every page under the run that acc_begin_bank_feed_sync returned", async () => {
    plaid.sync.mockResolvedValue({
      added: [transaction("tx-added", 12.5)],
      modified: [transaction("tx-modified", 3)],
      removed: [{ transaction_id: "tx-removed" }],
      next_cursor: "cursor-after",
      has_more: false,
    });
    const { sb, calls } = fakeClient({
      acc_begin_bank_feed_sync: "run-example-1",
      acc_get_bank_connection_token: "sealed-token",
      acc_apply_bank_feed_page: { added: 1, modified: 1, removed: 1 },
    });

    expect(await syncBankConnection(sb, "conn-1")).toEqual({ added: 1, modified: 1, removed: 1, suggestions: 0 });

    const applies = calls.filter((call) => call.fn === "acc_apply_bank_feed_page");
    expect(applies).toHaveLength(1);
    expect(applies[0].args).toMatchObject({
      p_connection_id: "conn-1",
      p_run_id: "run-example-1",
      p_removed: ["tx-removed"],
    });
    expect(applies[0].args.p_added).toEqual([expect.objectContaining({ external_transaction_id: "tx-added", amount_minor: -1250 })]);
    expect(applies[0].args.p_modified).toEqual([expect.objectContaining({ external_transaction_id: "tx-modified", amount_minor: -300 })]);
    // The run that was begun is the run that is finished, with the cursor Plaid gave.
    expect(calls.map((call) => call.fn)).toEqual([
      "acc_begin_bank_feed_sync",
      "acc_get_bank_connection_token",
      "acc_apply_bank_feed_page",
      "acc_finish_bank_feed_sync",
    ]);
    expect(calls.at(-1)?.args).toMatchObject({ p_run_id: "run-example-1", p_cursor: "cursor-after", p_error_message: null });
  });
});
