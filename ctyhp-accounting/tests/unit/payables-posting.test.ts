import { describe, it, expect } from "vitest";
import {
  buildBillPosting,
  buildExpensePosting,
  buildBillPaymentPosting,
  isBalanced,
  totalDebit,
  totalCredit,
  reverse,
} from "@/lib/domain/posting";

describe("buildBillPosting", () => {
  it("debits each expense account and credits AP for the total", () => {
    const lines = buildBillPosting({
      apAccountId: "ap",
      lines: [
        { expenseAccountId: "rent", amountMinor: 100_00 },
        { expenseAccountId: "utils", amountMinor: 40_00 },
      ],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(totalDebit(lines)).toBe(140_00);
    const ap = lines.find((l) => l.accountId === "ap")!;
    expect(ap.creditMinor).toBe(140_00);
    expect(ap.debitMinor).toBe(0);
  });

  it("groups multiple lines that share one expense account", () => {
    const lines = buildBillPosting({
      apAccountId: "ap",
      lines: [
        { expenseAccountId: "rent", amountMinor: 100_00 },
        { expenseAccountId: "rent", amountMinor: 50_00 },
      ],
    });
    const rent = lines.filter((l) => l.accountId === "rent");
    expect(rent).toHaveLength(1);
    expect(rent[0].debitMinor).toBe(150_00);
  });

  it("throws when there are no positive lines", () => {
    expect(() => buildBillPosting({ apAccountId: "ap", lines: [] })).toThrow();
  });
});

describe("buildExpensePosting", () => {
  it("debits expense accounts and credits the payment account", () => {
    const lines = buildExpensePosting({
      paymentAccountId: "bank",
      lines: [{ expenseAccountId: "meals", amountMinor: 25_00 }],
    });
    expect(isBalanced(lines)).toBe(true);
    const bank = lines.find((l) => l.accountId === "bank")!;
    expect(bank.creditMinor).toBe(25_00);
  });
});

describe("buildBillPaymentPosting", () => {
  it("debits AP and credits the payment account", () => {
    const lines = buildBillPaymentPosting({
      apAccountId: "ap",
      paymentAccountId: "bank",
      amountMinor: 140_00,
    });
    expect(isBalanced(lines)).toBe(true);
    const ap = lines.find((l) => l.accountId === "ap")!;
    expect(ap.debitMinor).toBe(140_00);
    const bank = lines.find((l) => l.accountId === "bank")!;
    expect(bank.creditMinor).toBe(140_00);
  });
});

describe("reverse of AP postings stays balanced", () => {
  it("reverses a bill posting", () => {
    const lines = buildBillPosting({
      apAccountId: "ap",
      lines: [{ expenseAccountId: "rent", amountMinor: 100_00 }],
    });
    const rev = reverse(lines);
    expect(isBalanced(rev)).toBe(true);
    expect(totalDebit(rev)).toBe(totalCredit(lines));
  });
});
