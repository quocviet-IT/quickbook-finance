import { describe, expect, it } from "vitest";
import {
  NO_OTHER_ACCOUNTS,
  OTHER_ACCOUNT_NOTE,
  otherAccountGroups,
  otherAccountLines,
  otherAccountTitle,
  sameAccountNumber,
  sameNumberRefusal,
  wholeStatementElsewhere,
  type ElsewhereBankLine,
} from "@/lib/domain/statement-other-accounts";

/**
 * A statement whose lines Bank Transactions already holds under another bank
 * account (3.0.22). Every bank, name and amount here is invented.
 */
const line = (txn_date: string, amount_minor: number, description = "EXAMPLE LINE") => ({ txn_date, amount_minor, description });

let seq = 0;
const held = (bankAccountId: string, txnDate: string, amountMinor: number, description: string | null = "EXAMPLE LINE"): ElsewhereBankLine => ({
  id: `line-${++seq}`,
  bankAccountId,
  txnDate,
  amountMinor,
  description,
});

const AUGUST = [
  line("2026-08-13", 50000, "Counter Credit"),
  line("2026-08-19", 2500, "Transfer from EXAMPLE ONE"),
  line("2026-08-19", 2500, "Transfer from EXAMPLE TWO"),
  line("2026-08-27", -1500, "Wire Transfer Fee"),
];
const AUGUST_UNDER_A = AUGUST.map((l) => held("acct-a", l.txn_date, l.amount_minor, l.description));

describe("otherAccountLines", () => {
  it("finds nothing when no other bank account holds a line", () => {
    expect(otherAccountLines(AUGUST, [], [])).toEqual(NO_OTHER_ACCOUNTS);
  });

  it("names the account that already holds every line of the statement", () => {
    const check = otherAccountLines(AUGUST, [], AUGUST_UNDER_A);
    expect(check.whole).toBe("acct-a");
    expect(check.lines.map((l) => l.index)).toEqual([0, 1, 2, 3]);
    expect(check.lines.every((l) => l.bankAccountId === "acct-a")).toBe(true);
  });

  it("reads a description the same whatever its case and spacing", () => {
    const check = otherAccountLines(
      [line("2026-08-13", 50000, "Counter  Credit "), line("2026-08-27", -1500, "WIRE TRANSFER FEE")],
      [],
      [held("acct-a", "2026-08-13", 50000, "counter credit"), held("acct-a", "2026-08-27", -1500, "Wire Transfer Fee")],
    );
    expect(check.whole).toBe("acct-a");
  });

  it("leaves one chance match alone: a monthly fee two accounts both pay", () => {
    const check = otherAccountLines(AUGUST, [], [held("acct-b", "2026-08-27", -1500, "Wire Transfer Fee")]);
    expect(check).toEqual(NO_OTHER_ACCOUNTS);
  });

  it("marks two or more lines another account holds, and is not the whole statement", () => {
    const check = otherAccountLines(AUGUST, [], AUGUST_UNDER_A.slice(0, 2));
    expect(check.whole).toBeNull();
    expect(check.lines.map((l) => l.index)).toEqual([0, 1]);
  });

  it("does not take a line of another day, another amount or other words for the same line", () => {
    const check = otherAccountLines(AUGUST, [], [
      held("acct-a", "2026-08-14", 50000, "Counter Credit"),
      held("acct-a", "2026-08-19", 2600, "Transfer from EXAMPLE ONE"),
      held("acct-a", "2026-08-19", 2500, "Transfer from SOMEONE ELSE"),
      held("acct-a", "2026-08-27", 1500, "Wire Transfer Fee"),
    ]);
    expect(check).toEqual(NO_OTHER_ACCOUNTS);
  });

  it("counts one for one: two identical lines and one held line mark one", () => {
    const twice = [line("2026-08-05", -900, "CARD FEE"), line("2026-08-05", -900, "CARD FEE"), line("2026-08-06", 100, "INTEREST")];
    const check = otherAccountLines(twice, [], [held("acct-a", "2026-08-05", -900, "CARD FEE"), held("acct-a", "2026-08-06", 100, "INTEREST")]);
    expect(check.lines.map((l) => l.index)).toEqual([0, 2]);
    expect(check.whole).toBeNull();
  });

  it("leaves out a line ticked Not a transaction, and judges the whole statement without it", () => {
    const check = otherAccountLines(AUGUST, [3], AUGUST_UNDER_A.slice(0, 3));
    expect(check.whole).toBe("acct-a");
    expect(check.lines.map((l) => l.index)).toEqual([0, 1, 2]);
  });

  it("marks a one-line statement another account holds, but does not call it the whole statement", () => {
    const check = otherAccountLines([line("2026-08-27", -1500, "Monthly Service Fee")], [], [held("acct-b", "2026-08-27", -1500, "Monthly Service Fee")]);
    expect(check.lines).toHaveLength(1);
    expect(check.whole).toBeNull();
  });

  it("knows the same statement read from another kind of file: every line by day and amount, whatever the words", () => {
    const fromCsv = AUGUST.map((l, i) => held("acct-a", l.txn_date, l.amount_minor, `CSV WORDS ${i}`));
    const check = otherAccountLines(AUGUST, [], fromCsv);
    expect(check.whole).toBe("acct-a");
    expect(check.lines.map((l) => l.index)).toEqual([0, 1, 2, 3]);
  });

  it("does not take an account that only moves the same money for the statement's own: a daily sweep", () => {
    // Savings shows three sweeps in. Checking holds the three deposits that were swept, and the sweeps out beside them.
    const savings = [line("2026-08-03", 40000, "TRANSFER FROM CHECKING"), line("2026-08-04", 55000, "TRANSFER FROM CHECKING"), line("2026-08-05", 61000, "TRANSFER FROM CHECKING")];
    const checking = savings.flatMap((l) => [
      held("acct-a", l.txn_date, l.amount_minor, "COUNTER DEPOSIT"),
      held("acct-a", l.txn_date, -l.amount_minor, "TRANSFER TO SAVINGS"),
    ]);
    expect(otherAccountLines(savings, [], checking)).toEqual(NO_OTHER_ACCOUNTS);
  });

  it("marks nothing on day and amount when the other account does not hold every line", () => {
    const fromCsv = AUGUST.slice(0, 3).map((l, i) => held("acct-a", l.txn_date, l.amount_minor, `CSV WORDS ${i}`));
    expect(otherAccountLines(AUGUST, [], fromCsv)).toEqual(NO_OTHER_ACCOUNTS);
  });

  it("does not call two lines another account's on day and amount alone", () => {
    const two = AUGUST.slice(0, 2);
    const fromCsv = two.map((l, i) => held("acct-a", l.txn_date, l.amount_minor, `CSV WORDS ${i}`));
    expect(otherAccountLines(two, [], fromCsv)).toEqual(NO_OTHER_ACCOUNTS);
  });

  it("gives a line two accounts hold to the account holding more of the statement", () => {
    const check = otherAccountLines(AUGUST, [], [
      ...AUGUST_UNDER_A.slice(0, 3),
      held("acct-b", "2026-08-13", 50000, "Counter Credit"),
      held("acct-b", "2026-08-27", -1500, "Wire Transfer Fee"),
    ]);
    expect(check.whole).toBeNull();
    expect(check.lines).toEqual([
      expect.objectContaining({ index: 0, bankAccountId: "acct-a" }),
      expect.objectContaining({ index: 1, bankAccountId: "acct-a" }),
      expect.objectContaining({ index: 2, bankAccountId: "acct-a" }),
      expect.objectContaining({ index: 3, bankAccountId: "acct-b" }),
    ]);
  });
});

describe("what the dialog and the server say", () => {
  it("groups the lines by the account that holds them, most first", () => {
    const check = otherAccountLines(AUGUST, [], [
      ...AUGUST_UNDER_A.slice(0, 2),
      held("acct-b", "2026-08-19", 2500, "Transfer from EXAMPLE TWO"),
      held("acct-b", "2026-08-27", -1500, "Wire Transfer Fee"),
    ]);
    const groups = otherAccountGroups(check, { "acct-a": "First Checking · 1015", "acct-b": "Second Checking · 1025" }, 4);
    expect(groups).toEqual([
      { bankAccountId: "acct-a", label: "First Checking · 1015", indexes: [0, 1], title: "2 of 4 lines are already in Bank Transactions under First Checking · 1015" },
      { bankAccountId: "acct-b", label: "Second Checking · 1025", indexes: [2, 3], title: "2 of 4 lines are already in Bank Transactions under Second Checking · 1025" },
    ]);
  });

  it("says another bank account when it has no name for it", () => {
    expect(otherAccountTitle(1, 1, undefined)).toBe("1 of 1 line is already in Bank Transactions under another bank account");
  });

  it("refuses the whole statement in one sentence that names both accounts and the way out", () => {
    expect(wholeStatementElsewhere("First Checking · 1015", "Second Checking · 1025")).toBe(
      "Every line of this statement is already in Bank Transactions under First Checking · 1015, so it is not imported into Second Checking · 1025 as well: " +
        "the same money would be in the books twice. To correct a bank account's name or number, use Edit account on Bank Transactions.",
    );
  });

  it("tells the person the lines are skipped and why", () => {
    expect(OTHER_ACCOUNT_NOTE).toContain("skipped");
    expect(OTHER_ACCOUNT_NOTE).toContain("twice");
  });
});

describe("two bank accounts with one number", () => {
  it("compares the digits, whatever is written around them", () => {
    expect(sameAccountNumber("4321", "••••4321")).toBe(true);
    expect(sameAccountNumber(" x-4321 ", "4321")).toBe(true);
    expect(sameAccountNumber("14321", "4321")).toBe(false);
  });

  it("never matches a number that has no digits, or is missing", () => {
    expect(sameAccountNumber(null, null)).toBe(false);
    expect(sameAccountNumber("", "")).toBe(false);
    expect(sameAccountNumber("checking", "checking")).toBe(false);
  });

  it("says which account has the number and what to do instead", () => {
    expect(sameNumberRefusal("First Checking · 1015", "4321")).toBe(
      "First Checking · 1015 already has the account number ending 4321. If this is that account, use Edit account to correct its name instead of adding it again. " +
        "If it is a different account, enter more digits of its number so the two can be told apart.",
    );
  });
});
