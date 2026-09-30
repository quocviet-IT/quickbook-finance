import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { postReviewItems, type ReviewPostDeps } from "@/lib/services/statement-review";

const sb = {} as SupabaseClient;
const deps = (over: Partial<ReviewPostDeps> = {}): ReviewPostDeps => ({
  lineState: vi.fn(async () => ({ status: "unmatched", pending: false, amountMinor: -125000 })),
  matchOf: vi.fn(async (_sb: SupabaseClient, id: string) => ({ bankTransactionId: "t1", status: id === "r1" ? "suggested" : "approved" })),
  approve: vi.fn(async () => undefined),
  settle: vi.fn(async () => "pay-1"),
  categorise: vi.fn(async () => ({ entry_number: "JE-000010" })),
  postPair: vi.fn(async () => ["JE-000011"]),
  ...over,
});

describe("postReviewItems", () => {
  it("posts each kind through its own call", async () => {
    const d = deps();
    const outcomes = await postReviewItems(
      sb,
      [
        { transactionId: "t1", kind: "match", reconciliationId: "r1" },
        { transactionId: "t1", kind: "document", documentId: "bill-1" },
        { transactionId: "t1", kind: "account", accountId: "acct-1" },
      ],
      d,
    );
    expect(outcomes).toEqual([
      { id: "t1", ok: true, detail: "Matched" },
      { id: "t1", ok: true, detail: "Settled" },
      { id: "t1", ok: true, detail: "JE-000010" },
    ]);
    expect(d.approve).toHaveBeenCalledWith(sb, "r1");
    expect(d.settle).toHaveBeenCalledWith(sb, {
      bankTransactionId: "t1",
      allocations: [{ document_id: "bill-1", amount_minor: 125000 }],
      method: null,
      memo: null,
    });
    expect(d.categorise).toHaveBeenCalledWith(sb, "t1", "acct-1");
  });

  it("posts nothing for a line that is gone or already handled", async () => {
    const gone = deps({ lineState: vi.fn(async () => null) });
    expect((await postReviewItems(sb, [{ transactionId: "t1", kind: "account", accountId: "a" }], gone))[0]).toMatchObject({ ok: false, error: expect.stringMatching(/no longer/) });
    const handled = deps({ lineState: vi.fn(async () => ({ status: "matched", pending: false, amountMinor: 1 })) });
    expect((await postReviewItems(sb, [{ transactionId: "t1", kind: "account", accountId: "a" }], handled))[0]).toMatchObject({ ok: false, error: expect.stringMatching(/already handled/) });
    expect(handled.categorise).not.toHaveBeenCalled();
  });

  it("refuses a match that is not this line's, or no longer on offer", async () => {
    const d = deps();
    const [outcome] = await postReviewItems(sb, [{ transactionId: "t1", kind: "match", reconciliationId: "r2" }], d);
    expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/no longer on offer/) });
    expect(d.approve).not.toHaveBeenCalled();
  });

  it("reports a refusal word for word and carries on", async () => {
    const d = deps({ categorise: vi.fn().mockRejectedValueOnce(new Error("The period is closed")).mockResolvedValueOnce({ entry_number: "JE-2" }) });
    const outcomes = await postReviewItems(
      sb,
      [
        { transactionId: "t1", kind: "account", accountId: "a" },
        { transactionId: "t2", kind: "account", accountId: "a" },
      ],
      d,
    );
    expect(outcomes).toEqual([
      { id: "t1", ok: false, error: "The period is closed" },
      { id: "t2", ok: true, detail: "JE-2" },
    ]);
  });

  it("refuses more than fifty lines in one call", async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ transactionId: `t${i}`, kind: "account" as const, accountId: "a" }));
    await expect(postReviewItems(sb, items, deps())).rejects.toThrow(/50/);
  });
});
