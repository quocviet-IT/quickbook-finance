import { describe, expect, it } from "vitest";
import { journalLines, toCents } from "@/lib/parity/cents";

describe("toCents", () => {
  it("turns the prototype's two-decimal dollars into integer cents, either sign", () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(-12.34)).toBe(-1234);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1234567.89)).toBe(123456789);
    expect(toCents(0)).toBe(0);
    expect(Object.is(toCents(-0), 0)).toBe(true);
  });
});

describe("journalLines", () => {
  const ids = new Map([
    ["Assets:Bank:Example", "a1"],
    ["Expenses:Rent", "a2"],
    ["Income:Sales", "a3"],
  ]);
  it("makes a positive posting a debit and a negative one a credit, dropping zeros", () => {
    expect(
      journalLines(
        [
          { account: "Expenses:Rent", cents: 50000 },
          { account: "Assets:Bank:Example", cents: -50000 },
          { account: "Income:Sales", cents: 0 },
        ],
        ids,
      ),
    ).toEqual({
      lines: [
        { account_id: "a2", debit_minor: 50000, credit_minor: 0, memo: null },
        { account_id: "a1", debit_minor: 0, credit_minor: 50000, memo: null },
      ],
    });
  });
  it("refuses an entry that names an unknown account, has fewer than two lines, or does not balance", () => {
    expect(journalLines([{ account: "Expenses:Unknown", cents: 100 }, { account: "Assets:Bank:Example", cents: -100 }], ids)).toEqual({
      problem: "no account for Expenses:Unknown",
    });
    expect(journalLines([{ account: "Expenses:Rent", cents: 0 }], ids)).toEqual({ problem: "fewer than two non-zero postings" });
    expect(journalLines([{ account: "Expenses:Rent", cents: 100 }, { account: "Assets:Bank:Example", cents: -99 }], ids)).toEqual({
      problem: "does not balance by 1 cent(s)",
    });
  });
});
