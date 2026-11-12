import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { UNREADABLE_STATE } from "@/lib/domain/bank-transaction-delete";
import {
  BankingError,
  deleteBankTransaction,
  getBankLineDeleteState,
  unmatchBankTransaction,
} from "@/lib/services/banking";

const REASON = "Imported twice from the same statement";
const MESSAGE =
  "This line is posted to the ledger as JE-000123, so it is not deleted. Void that entry first: it stays in the journal, marked Void, and the line goes back to For review.";

describe("deleteBankTransaction (3.0.23)", () => {
  it("asks the database to delete, in one call, and voids nothing on the way", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await deleteBankTransaction({ rpc } as unknown as SupabaseClient, "txn-1", REASON);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("acc_delete_bank_transaction", { p_id: "txn-1", p_reason: REASON });
  });

  it("reads nothing itself before deciding: the database holds the row and decides", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const from = vi.fn();
    await deleteBankTransaction({ rpc, from } as unknown as SupabaseClient, "txn-1", REASON);
    expect(from).not.toHaveBeenCalled();
  });

  it("passes the database's refusal on in its own words", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: MESSAGE } });
    const call = () => deleteBankTransaction({ rpc } as unknown as SupabaseClient, "txn-1", REASON);
    await expect(call()).rejects.toEqual(expect.any(BankingError));
    await expect(call()).rejects.toThrow(MESSAGE);
  });
});

describe("getBankLineDeleteState", () => {
  it("reads how a line stands", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { kind: "posted", message: MESSAGE, entry_number: "JE-000123" }, error: null });
    const found = await getBankLineDeleteState({ rpc } as unknown as SupabaseClient, "txn-1");
    expect(rpc).toHaveBeenCalledWith("acc_bank_line_delete_state", { p_id: "txn-1" });
    expect(found).toMatchObject({ kind: "posted", message: MESSAGE, entryNumber: "JE-000123" });
  });

  it("says so when the answer cannot be read, and offers no delete", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { kind: "something new" }, error: null });
    await expect(getBankLineDeleteState({ rpc } as unknown as SupabaseClient, "txn-1")).rejects.toThrow(UNREADABLE_STATE);
  });
});

describe("unmatchBankTransaction", () => {
  it("asks the database to take the match back, with the reason", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await unmatchBankTransaction({ rpc } as unknown as SupabaseClient, "txn-1", REASON);
    expect(rpc).toHaveBeenCalledWith("acc_unmatch_bank_transaction", { p_id: "txn-1", p_reason: REASON });
  });
});
