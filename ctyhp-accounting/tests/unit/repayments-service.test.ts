import { describe, expect, it } from "vitest";
import { repaymentInputSchema, repaymentPreviewSchema } from "@/lib/domain/schemas";
import { repaymentStatsFrom } from "@/lib/services/repayments";

const entry = { accountId: "card1", matchWords: "example card", matchDigits: "4321" };
const past = (id: string, date: string, text: string, accountId = "card1", direction: "in" | "out" = "out") => ({
  entryId: id,
  date,
  direction,
  accountId,
  texts: [text],
});

describe("repaymentStatsFrom", () => {
  it("counts past payments to the account it catches, and lists the newest it misses", () => {
    const stats = repaymentStatsFrom(
      entry,
      [
        past("1", "2026-01-05", "EXAMPLE CARD EPAY"),
        past("2", "2026-02-05", "Payment to card ending in 4321"),
        past("3", "2026-03-05", "XYZ BANK BILL PAY"),
        past("4", "2026-04-05", "EXAMPLE CARD EPAY", "rent"),
        past("5", "2026-05-05", "EXAMPLE CARD REFUND", "card1", "in"),
      ],
      [],
    );
    expect(stats).toEqual({ past: 3, caught: 2, waiting: 0, missed: [{ date: "2026-03-05", text: "XYZ BANK BILL PAY" }] });
  });
  it("counts waiting payments out on base-currency banks only", () => {
    const stats = repaymentStatsFrom(entry, [], [
      { description: "EXAMPLE CARD EPAY", amountMinor: -100, inBaseCurrency: true },
      { description: "EXAMPLE CARD EPAY", amountMinor: 100, inBaseCurrency: true },
      { description: "EXAMPLE CARD EPAY", amountMinor: -100, inBaseCurrency: false },
    ]);
    expect(stats.waiting).toBe(1);
  });
  it("lists at most ten misses", () => {
    const many = Array.from({ length: 12 }, (_, i) => past(String(i), `2026-01-${String(i + 1).padStart(2, "0")}`, "OTHER"));
    expect(repaymentStatsFrom(entry, many, []).missed).toHaveLength(10);
  });
});

describe("repayment schemas", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("take a card with words, digits or both", () => {
    expect(repaymentInputSchema.safeParse({ kind: "card", accountId: id, matchWords: "example card", matchDigits: "4321", isActive: true }).success).toBe(true);
    expect(repaymentInputSchema.safeParse({ kind: "card", accountId: id, matchWords: "", matchDigits: "4321", isActive: true }).success).toBe(true);
  });
  it("refuse a loan until loans ship, and digits that are not four", () => {
    expect(repaymentInputSchema.safeParse({ kind: "loan", accountId: id, matchWords: "x", matchDigits: null, isActive: true }).success).toBe(false);
    expect(repaymentPreviewSchema.safeParse({ accountId: id, matchWords: "", matchDigits: "12a4" }).success).toBe(false);
  });
});
