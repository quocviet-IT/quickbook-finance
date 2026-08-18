import { describe, expect, it } from "vitest";
import {
  evaluateBankTransactionDelete,
  type BankTransactionDeleteInput,
} from "@/lib/domain/bank-transaction-delete";

function input(overrides: Partial<BankTransactionDeleteInput> = {}): BankTransactionDeleteInput {
  return {
    status: "unmatched",
    transactionBatchId: null,
    posting: null,
    hasOpenSuggestion: false,
    ...overrides,
  };
}

describe("evaluateBankTransactionDelete", () => {
  it("allows a plain delete on an unmatched line with no open suggestion", () => {
    // Fails if the "unmatched" branch is removed or made to fall through to
    // a blocked result — the ordinary case, which worked before RQ-06's
    // correction, must keep working exactly as it did.
    expect(evaluateBankTransactionDelete(input())).toEqual({ kind: "delete_only" });
  });

  it("blocks an unmatched line with a suggested match still open", () => {
    // Fails if hasOpenSuggestion is ignored — acc_delete_bank_transaction
    // refuses any row carrying a reconciliation row of any status, and a
    // hidden failure here is exactly what RQ-06 forbids.
    const result = evaluateBankTransactionDelete(input({ hasOpenSuggestion: true }));
    expect(result.kind).toBe("blocked");
    expect(result.kind === "blocked" && result.reason).toMatch(/match against it/i);
  });

  it("blocks an ignored line", () => {
    // Fails if "ignored" is treated the same as "unmatched" and allowed
    // straight through to delete_only.
    const result = evaluateBankTransactionDelete(input({ status: "ignored" }));
    expect(result.kind).toBe("blocked");
    expect(result.kind === "blocked" && result.reason).toMatch(/bank feed/i);
  });

  it("blocks a matched line that came from a transactions import batch", () => {
    // Fails if transactionBatchId stops being checked before the posting —
    // that import's own Undo owns the entry, and voiding it from here would
    // break the dedupe index the import relies on to re-run cleanly.
    const result = evaluateBankTransactionDelete(
      input({ status: "matched", transactionBatchId: "batch-1" }),
    );
    expect(result.kind).toBe("blocked");
    expect(result.kind === "blocked" && result.reason).toMatch(/transactions import/i);
  });

  it("blocks a matched line with no journal-line posting (settled against an invoice or bill)", () => {
    // Fails if a null posting is treated as eligible instead of blocked —
    // this is exactly the settlement case RQ-06 says is a larger reversal
    // than a delete and is deliberately not folded into this action.
    const result = evaluateBankTransactionDelete(input({ status: "matched", posting: null }));
    expect(result.kind).toBe("blocked");
    expect(result.kind === "blocked" && result.reason).toMatch(/settled against an invoice or bill/i);
  });

  it("blocks a matched line posted by something other than categorising it here", () => {
    // Fails if ownEntry stops gating eligibility — a line matched to an
    // entry a manual journal (or anything else) posted is not Banking's
    // entry to void, and the message must name what it is instead of
    // reading as a generic refusal.
    const result = evaluateBankTransactionDelete(
      input({
        status: "matched",
        posting: { ownEntry: false, entryNumber: "JE-0042", sourceType: "manual" },
      }),
    );
    expect(result.kind).toBe("blocked");
    expect(result.kind === "blocked" && result.reason).toContain("posted by manual");
  });

  it("humanizes the source type in the refusal reason", () => {
    // Fails if the raw enum value ("ar_payment") leaks into the UI copy
    // unhumanized.
    const result = evaluateBankTransactionDelete(
      input({
        status: "matched",
        posting: { ownEntry: false, entryNumber: null, sourceType: "ar_payment" },
      }),
    );
    expect(result.kind === "blocked" && result.reason).toContain("posted by ar payment");
  });

  it("allows void-then-delete on a matched line Banking categorised itself", () => {
    // Fails if a genuinely eligible row (own_entry true, no import batch)
    // is still blocked — this is the whole point of RQ-06's correction: the
    // one path that must now work end to end.
    const result = evaluateBankTransactionDelete(
      input({
        status: "matched",
        posting: { ownEntry: true, entryNumber: "JE-0099", sourceType: "bank" },
      }),
    );
    expect(result).toEqual({ kind: "void_then_delete", entryNumber: "JE-0099" });
  });

  it("carries a null entry number through rather than inventing one", () => {
    // Fails if a placeholder string is substituted for a missing entry
    // number instead of passing null through for the caller to handle.
    const result = evaluateBankTransactionDelete(
      input({
        status: "matched",
        posting: { ownEntry: true, entryNumber: null, sourceType: "bank" },
      }),
    );
    expect(result).toEqual({ kind: "void_then_delete", entryNumber: null });
  });

  it("checks the transactions-import batch before the posting shape", () => {
    // Fails if the order of checks flips — a row can carry both a
    // transaction_batch_id and an own-shaped posting (import posts the same
    // source_type/source_id shape categorising does), and only the batch id
    // tells them apart. The import-specific message must win.
    const result = evaluateBankTransactionDelete(
      input({
        status: "matched",
        transactionBatchId: "batch-9",
        posting: { ownEntry: true, entryNumber: "JE-0001", sourceType: "bank" },
      }),
    );
    expect(result.kind === "blocked" && result.reason).toMatch(/transactions import/i);
  });
});
