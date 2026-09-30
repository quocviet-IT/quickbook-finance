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
  it("refuses nothing, more than fifty, and a kind it does not know", () => {
    expect(reviewPostItemsSchema.safeParse([]).success).toBe(false);
    expect(reviewPostItemsSchema.safeParse(Array.from({ length: 51 }, () => ({ transactionId: id, kind: "account", accountId: id }))).success).toBe(false);
    expect(reviewPostItemsSchema.safeParse([{ transactionId: id, kind: "void", accountId: id }]).success).toBe(false);
  });
});
