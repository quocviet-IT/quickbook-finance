import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bankingPreferenceSchema, reviewPostItemsSchema } from "@/lib/domain/schemas";
import { postReviewItems, type ReviewPostDeps } from "@/lib/services/statement-review";

const sb = {} as SupabaseClient;
const id = "5a802489-7f77-4f20-9cbd-e0fb9a7d1542";

describe("posting a pair", () => {
  it("goes through the pair call with both lines and says which entries it made", async () => {
    const postPair = vi.fn(async () => ["JE-000041", "JE-000042"]);
    const deps = {
      lineState: vi.fn(async () => ({ status: "unmatched", pending: false, amountMinor: -500 })),
      matchOf: vi.fn(),
      approve: vi.fn(),
      settle: vi.fn(),
      categorise: vi.fn(),
      postPair,
    } as unknown as ReviewPostDeps;
    const [outcome] = await postReviewItems(sb, [{ transactionId: "t1", kind: "pair", pairKind: "funding", counterpartId: "t2" }], deps);
    expect(postPair).toHaveBeenCalledWith(sb, "t1", "t2", "funding");
    expect(outcome).toEqual({ id: "t1", ok: true, detail: "JE-000041, JE-000042" });
  });
});

describe("schemas", () => {
  it("take a pair item", () => {
    expect(reviewPostItemsSchema.safeParse([{ transactionId: id, kind: "pair", pairKind: "transfer", counterpartId: id }]).success).toBe(true);
    expect(reviewPostItemsSchema.safeParse([{ transactionId: id, kind: "pair", pairKind: "gift", counterpartId: id }]).success).toBe(false);
  });
  it("take a banking preference within the window options", () => {
    expect(bankingPreferenceSchema.safeParse({ fundingAccountId: id, pairWindowDays: 7 }).success).toBe(true);
    expect(bankingPreferenceSchema.safeParse({ fundingAccountId: null, pairWindowDays: 3 }).success).toBe(true);
    expect(bankingPreferenceSchema.safeParse({ fundingAccountId: id, pairWindowDays: 5 }).success).toBe(false);
  });
});
