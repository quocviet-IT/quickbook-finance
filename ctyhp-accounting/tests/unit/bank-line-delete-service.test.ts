import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BankingError, deleteBankTransactionWithVoid } from "@/lib/services/banking";

const REASON = "Imported twice from the same statement";

describe("deleteBankTransactionWithVoid", () => {
  it("delegates the whole decision to one atomic RPC", async () => {
    // Two calls were the RQ-06 hole: a void that succeeded followed by a delete
    // that failed left the entry voided and the line alive, which is the one
    // thing "if deletion fails, the data must remain unchanged" forbids.
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await deleteBankTransactionWithVoid({ rpc } as unknown as SupabaseClient, "txn-1", REASON);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("acc_delete_bank_transaction_with_void", {
      p_id: "txn-1",
      p_reason: REASON,
    });
  });

  it("reads nothing itself before deciding what to do", async () => {
    // Every `from(...)` here was a decision taken between the two writes, on a
    // row that could change underneath it. The database now decides, holding
    // the row, inside the transaction that does the work.
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const from = vi.fn();

    await deleteBankTransactionWithVoid({ rpc, from } as unknown as SupabaseClient, "txn-1", REASON);

    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces the database refusal verbatim as a BankingError", async () => {
    const message =
      "This line was settled against an invoice or bill. Remove that payment first, then delete the line.";
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message } });

    const call = () =>
      deleteBankTransactionWithVoid({ rpc } as unknown as SupabaseClient, "txn-1", REASON);

    await expect(call()).rejects.toEqual(expect.any(BankingError));
    await expect(call()).rejects.toThrow(message);
  });

  it("no longer warns about a half-finished delete, because there cannot be one", async () => {
    // The old message told the reader the entry had been voided but the line
    // survived, and to press Delete again. One transaction means that state can
    // no longer exist, so promising it would be a lie about what happened.
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Accounting period is closed" } });

    await expect(
      deleteBankTransactionWithVoid({ rpc } as unknown as SupabaseClient, "txn-1", REASON),
    ).rejects.toThrow(/^Accounting period is closed$/);
  });
});
