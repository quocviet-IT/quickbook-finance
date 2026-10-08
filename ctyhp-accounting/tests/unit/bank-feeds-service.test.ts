import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

/** What the stand-in for Plaid does: configured or not, and what /item/remove answers. */
const plaid = { configured: true, remove: vi.fn<(token: string) => Promise<void>>() };
vi.mock("@/lib/services/plaid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/plaid")>();
  return {
    ...actual,
    plaidConfiguration: () => ({ configured: plaid.configured, environment: "sandbox", clientName: "One Book" }),
    removePlaidItem: (token: string) => plaid.remove(token),
  };
});
vi.mock("@/lib/services/bank-token-crypto", () => ({ decryptBankToken: (payload: string) => `plain:${payload}` }));

const { PlaidError } = await import("@/lib/services/plaid");
const { BankFeedError, disconnectBankConnection, listBankFeedSyncs, undoBankFeedSync } = await import("@/lib/services/bank-feeds");

type Answer = { data: unknown; error: { message: string } | null };

/** A stand-in for PostgREST's rpc: scalar answers by function name, table answers paged; records every call. */
function fakeClient(answers: Record<string, Answer | Record<string, unknown>[]>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const orders: string[] = [];
  const sb = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const answer = answers[fn] ?? { data: null, error: null };
      if (!Array.isArray(answer)) return Promise.resolve(answer);
      const chain: Record<string, unknown> = {};
      chain.order = (column: string) => {
        orders.push(column);
        return chain;
      };
      chain.range = (from: number, to: number) => Promise.resolve({ data: answer.slice(from, to + 1), error: null });
      return chain;
    },
  } as unknown as SupabaseClient;
  return { sb, calls, orders };
}

beforeEach(() => {
  plaid.configured = true;
  plaid.remove.mockReset();
  plaid.remove.mockResolvedValue(undefined);
});

describe("disconnecting a bank connection", () => {
  const token = { acc_get_bank_connection_token: { data: "sealed", error: null } };

  it("removes it at Plaid with the connection's own token, then disconnects it with no note", async () => {
    const { sb, calls } = fakeClient(token);
    expect(await disconnectBankConnection(sb, "conn-1", " The bank closed the account ", false)).toEqual({ disconnected: true, confirmedByPlaid: true });
    expect(plaid.remove).toHaveBeenCalledWith("plain:sealed");
    expect(calls.at(-1)).toEqual({
      fn: "acc_disconnect_bank_connection",
      args: { p_connection_id: "conn-1", p_reason: "The bank closed the account", p_note: null },
    });
  });

  it("takes a connection Plaid no longer has as removed", async () => {
    plaid.remove.mockRejectedValue(new PlaidError("The Item you requested cannot be found.", "ITEM_NOT_FOUND"));
    const { sb, calls } = fakeClient(token);
    expect(await disconnectBankConnection(sb, "conn-1", "Closed", false)).toEqual({ disconnected: true, confirmedByPlaid: true });
    expect(calls.at(-1)?.args.p_note).toBeNull();
  });

  it("changes nothing when Plaid does not confirm, and says how to go on", async () => {
    plaid.remove.mockRejectedValue(new PlaidError("Plaid request failed: fetch failed"));
    const { sb, calls } = fakeClient(token);
    expect(await disconnectBankConnection(sb, "conn-1", "Closed", false)).toEqual({
      disconnected: false,
      unconfirmed: "Plaid did not confirm the removal: Plaid request failed: fetch failed. Try again, or tick Disconnect in OneBook only.",
    });
    expect(calls.map((c) => c.fn)).not.toContain("acc_disconnect_bank_connection");
  });

  it("disconnects in OneBook only when asked, with a note that Plaid was not told", async () => {
    plaid.remove.mockRejectedValue(new PlaidError("Plaid request failed: fetch failed"));
    const { sb, calls } = fakeClient(token);
    expect(await disconnectBankConnection(sb, "conn-1", "Closed", true)).toEqual({ disconnected: true, confirmedByPlaid: false });
    expect(calls.at(-1)?.args.p_note).toBe("Disconnected in OneBook only: Plaid did not confirm the removal (Plaid request failed: fetch failed)");
  });

  it("does not reach for the token when OneBook has no Plaid keys", async () => {
    plaid.configured = false;
    const { sb, calls } = fakeClient(token);
    const outcome = await disconnectBankConnection(sb, "conn-1", "Closed", false);
    expect(outcome).toEqual({
      disconnected: false,
      unconfirmed: "Plaid did not confirm the removal: OneBook has no Plaid keys. Try again, or tick Disconnect in OneBook only.",
    });
    expect(calls).toEqual([]);
    expect(plaid.remove).not.toHaveBeenCalled();
  });

  it("takes a token it cannot read as not confirmed", async () => {
    const { sb } = fakeClient({ acc_get_bank_connection_token: { data: null, error: { message: "Bank connection token was not found" } } });
    const outcome = await disconnectBankConnection(sb, "conn-1", "Closed", false);
    expect(outcome).toMatchObject({ disconnected: false, unconfirmed: expect.stringContaining("Bank connection token was not found") });
  });

  it("asks why first", async () => {
    const { sb, calls } = fakeClient(token);
    await expect(disconnectBankConnection(sb, "conn-1", "  ", true)).rejects.toThrow("Say why this bank connection is being disconnected");
    expect(calls).toEqual([]);
  });

  it("says why the database refused", async () => {
    const { sb } = fakeClient({ ...token, acc_disconnect_bank_connection: { data: null, error: { message: "This bank connection is already disconnected" } } });
    await expect(disconnectBankConnection(sb, "conn-1", "Closed", false)).rejects.toThrow(BankFeedError);
  });
});

describe("the syncs of a bank account", () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    run_id: id,
    connection_id: "conn-1",
    institution_name: "Example Bank",
    connection_status: "active",
    status: "succeeded",
    started_at: "2026-10-07T11:00:00Z",
    completed_at: "2026-10-07T11:00:05Z",
    added_count: 3,
    modified_count: 1,
    removed_count: 0,
    error_message: null,
    undone_at: null,
    undo_reason: null,
    changes: 5,
    is_newest: true,
    locked_lines: 0,
    ...extra,
  });

  it("reads every sync past the row cap, newest first", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => row(`run-${i}`, { is_newest: i === 0 }));
    const { sb, orders } = fakeClient({ acc_bank_feed_syncs: rows });
    const syncs = await listBankFeedSyncs(sb, "bank-1");
    expect(syncs).toHaveLength(1200);
    expect(orders.slice(0, 2)).toEqual(["started_at", "run_id"]);
    expect(syncs[0]).toEqual({
      runId: "run-0",
      connectionId: "conn-1",
      institutionName: "Example Bank",
      connectionStatus: "active",
      status: "succeeded",
      startedAt: "2026-10-07T11:00:00Z",
      completedAt: "2026-10-07T11:00:05Z",
      added: 3,
      modified: 1,
      removed: 0,
      errorMessage: null,
      undoneAt: null,
      undoReason: null,
      changes: 5,
      isNewest: true,
      lockedLines: 0,
    });
  });
});

describe("undoing a sync", () => {
  it("says what it removed and restored", async () => {
    const { sb, calls } = fakeClient({ acc_undo_bank_feed_sync: { data: { removed: 2, restored: 1 }, error: null } });
    expect(await undoBankFeedSync(sb, "run-1", "Duplicates of the CSV")).toEqual({ removed: 2, restored: 1 });
    expect(calls).toEqual([{ fn: "acc_undo_bank_feed_sync", args: { p_run_id: "run-1", p_reason: "Duplicates of the CSV" } }]);
  });

  it("says why the database refused", async () => {
    const { sb } = fakeClient({ acc_undo_bank_feed_sync: { data: null, error: { message: "Undo the newer syncs of this bank connection first" } } });
    await expect(undoBankFeedSync(sb, "run-1", "x")).rejects.toThrow("Undo the newer syncs of this bank connection first");
  });
});
