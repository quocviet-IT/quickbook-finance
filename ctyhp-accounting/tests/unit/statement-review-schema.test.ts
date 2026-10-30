import { describe, expect, it } from "vitest";
import { reviewPostItemsSchema } from "@/lib/domain/schemas";

const id = "5a802489-7f77-4f20-9cbd-e0fb9a7d1542";

describe("reviewPostItemsSchema", () => {
  it("takes the three kinds of item", () => {
    const parsed = reviewPostItemsSchema.parse([
      { transactionId: id, kind: "match", reconciliationId: id },
      { transactionId: id, kind: "document", documentId: id },
      { transactionId: id, kind: "account", accountId: id },
    ]);
    expect(parsed).toHaveLength(3);
  });
  it("carries the match an account item turns down, by its id", () => {
    expect(reviewPostItemsSchema.parse([{ transactionId: id, kind: "account", accountId: id, instead: id }])[0]).toMatchObject({ instead: id });
    expect(reviewPostItemsSchema.safeParse([{ transactionId: id, kind: "account", accountId: id, instead: "JE-000123" }]).success).toBe(false);
  });
  it("refuses nothing, more than fifty, and a kind it does not know", () => {
    expect(reviewPostItemsSchema.safeParse([]).success).toBe(false);
    expect(reviewPostItemsSchema.safeParse(Array.from({ length: 51 }, () => ({ transactionId: id, kind: "account", accountId: id }))).success).toBe(false);
    expect(reviewPostItemsSchema.safeParse([{ transactionId: id, kind: "void", accountId: id }]).success).toBe(false);
  });
});
