import { describe, expect, it } from "vitest";
import { reviewOpeningDraft, type OpeningDraftLine } from "@/lib/domain/opening-balances";

/**
 * The opening balances form, read as a draft (UI review, 2026-10-20): an empty
 * form is not "Balanced", and a disabled Post says what it is waiting for.
 */
const line = (n: number, accountId: string | null, debit: number, credit: number): OpeningDraftLine => ({
  line: n,
  accountId,
  debitMinor: debit,
  creditMinor: credit,
});

describe("an opening balances draft", () => {
  it("is empty, not balanced, before anything is typed, and says what Post needs", () => {
    const review = reviewOpeningDraft([line(1, null, 0, 0), line(2, null, 0, 0)], null);
    expect(review.status).toBe("empty");
    expect(review.canPost).toBe(false);
    // No tick for "every balance has an account" when there are no balances.
    expect(review.conditions.filter((c) => !c.met).map((c) => c.label)).toEqual([
      "Choose the as-of date",
      "Enter at least one balance",
      "Give every balance an account",
    ]);
  });

  it("is balanced only when there are balances and debits equal credits", () => {
    const review = reviewOpeningDraft([line(1, "cash", 50_000, 0), line(2, "capital", 0, 50_000)], "2026-01-01");
    expect(review.status).toBe("balanced");
    expect(review.equityMinor).toBe(0);
    expect(review.debitMinor).toBe(50_000);
    expect(review.canPost).toBe(true);
    expect(review.conditions.map((c) => c.label)).toEqual(["As of 01/01/2026", "2 balances entered", "Every balance has an account"]);
  });

  it("names what Opening Balance Equity takes, and on which side", () => {
    const credit = reviewOpeningDraft([line(1, "cash", 120_000, 0)], "2026-01-01");
    expect(credit.status).toBe("equity");
    expect(credit.equityMinor).toBe(120_000);
    expect(credit.canPost).toBe(true);
    const debit = reviewOpeningDraft([line(1, "loan", 0, 30_000)], "2026-01-01");
    expect(debit.equityMinor).toBe(-30_000);
  });

  it("holds Post while a balance has no account, naming the lines, so nothing typed is dropped when posting", () => {
    const review = reviewOpeningDraft([line(1, "cash", 10_000, 0), line(2, null, 0, 4_000), line(4, null, 500, 0)], "2026-01-01");
    expect(review.canPost).toBe(false);
    expect(review.status).toBe("incomplete");
    expect(review.missingAccountLines).toEqual([2, 4]);
    expect(review.conditions.find((c) => c.key === "accounts")).toEqual({
      key: "accounts",
      met: false,
      label: "Choose an account for lines 2 and 4",
    });
    // The totals still show what was typed.
    expect(review.debitMinor).toBe(10_500);
    expect(review.creditMinor).toBe(4_000);
  });

  it("is not Balanced while a balance has no account, even when the figures add up", () => {
    const review = reviewOpeningDraft([line(1, "cash", 5_000, 0), line(2, null, 0, 5_000)], "2026-01-01");
    expect(review.equityMinor).toBe(0);
    expect(review.status).toBe("incomplete");
  });

  it("ignores an account chosen with no amount", () => {
    const review = reviewOpeningDraft([line(1, "cash", 10_000, 0), line(2, "bank", 0, 0)], "2026-01-01");
    expect(review.entered).toBe(1);
    expect(review.canPost).toBe(true);
  });
});
