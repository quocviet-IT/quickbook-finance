import { describe, it, expect } from "vitest";
import { manualJournalSchema, reverseEntrySchema, openingBalanceSchema } from "@/lib/domain/schemas";

const uuid = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";

describe("manualJournalSchema", () => {
  it("accepts a balanced two-line entry", () => {
    const r = manualJournalSchema.safeParse({
      currency_code: "USD",
      lines: [
        { account_id: uuid, debit_minor: 1000, credit_minor: 0 },
        { account_id: uuid2, debit_minor: 0, credit_minor: 1000 },
      ],
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unbalanced entry", () => {
    const r = manualJournalSchema.safeParse({
      currency_code: "USD",
      lines: [
        { account_id: uuid, debit_minor: 1000, credit_minor: 0 },
        { account_id: uuid2, debit_minor: 0, credit_minor: 900 },
      ],
    });
    expect(r.success).toBe(false);
  });
  it("rejects a line with two positive sides", () => {
    const r = manualJournalSchema.safeParse({
      currency_code: "USD",
      lines: [
        { account_id: uuid, debit_minor: 500, credit_minor: 500 },
        { account_id: uuid2, debit_minor: 0, credit_minor: 0 },
      ],
    });
    expect(r.success).toBe(false);
  });
  it("rejects fewer than two lines", () => {
    const r = manualJournalSchema.safeParse({
      currency_code: "USD",
      lines: [{ account_id: uuid, debit_minor: 100, credit_minor: 0 }],
    });
    expect(r.success).toBe(false);
  });
});

describe("reverseEntrySchema", () => {
  it("requires a non-empty reason", () => {
    expect(reverseEntrySchema.safeParse({ entry_id: uuid, reason: "" }).success).toBe(false);
    expect(reverseEntrySchema.safeParse({ entry_id: uuid, reason: "dup" }).success).toBe(true);
  });
});

describe("openingBalanceSchema", () => {
  it("requires at least one line", () => {
    expect(openingBalanceSchema.safeParse({ currency_code: "USD", lines: [] }).success).toBe(false);
  });
});
