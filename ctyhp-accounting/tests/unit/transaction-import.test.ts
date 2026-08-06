import { describe, expect, it } from "vitest";
import { fieldsFor, TARGET_LABEL } from "@/lib/domain/import-mapping";
import {
  describeTransactionRow,
  signedAmountMinor,
  transactionRawHash,
  type TransactionImportRecord,
} from "@/lib/domain/transaction-import";

const base: TransactionImportRecord = {
  txn_date: "2026-01-15",
  description: "Zelle Transfer",
  bank_account: "121 - PC49 BoA CK 3388",
  category_account: "Inventory Purchase",
  amount: null,
  debit: null,
  credit: null,
};

describe("the transactions target", () => {
  it("asks for a date and a category, and leaves the rest to the file's shape", () => {
    const keys = fieldsFor("transactions").map((field) => field.key);
    expect(keys).toEqual([
      "txn_date",
      "description",
      "bank_account",
      "category_account",
      "amount",
      "debit",
      "credit",
    ]);
    const required = fieldsFor("transactions")
      .filter((field) => field.required)
      .map((field) => field.key);
    expect(required).toEqual(["txn_date", "category_account"]);
    expect(TARGET_LABEL.transactions).toBe("Transactions");
  });
});

describe("signedAmountMinor", () => {
  it("takes a single Amount column as already signed", () => {
    expect(signedAmountMinor({ ...base, amount: 12550 })).toEqual({ minor: 12550 });
    expect(signedAmountMinor({ ...base, amount: -3200 })).toEqual({ minor: -3200 });
  });

  it("treats a debit as money into the bank and a credit as money out", () => {
    expect(signedAmountMinor({ ...base, debit: 32000 })).toEqual({ minor: 32000 });
    expect(signedAmountMinor({ ...base, credit: 16800 })).toEqual({ minor: -16800 });
    // Both columns present on one row: net them, as a ledger would.
    expect(signedAmountMinor({ ...base, debit: 500, credit: 200 })).toEqual({ minor: 300 });
  });

  it("refuses a row with no amount at all", () => {
    const result = signedAmountMinor(base);
    expect(result).toEqual({ problem: expect.stringMatching(/amount/i) });
  });

  it("refuses a row where Amount and Debit/Credit disagree", () => {
    const result = signedAmountMinor({ ...base, amount: 500, debit: 900 });
    expect(result).toEqual({ problem: expect.stringMatching(/disagree/i) });
  });

  it("accepts Amount alongside a Debit/Credit that agrees with it", () => {
    expect(signedAmountMinor({ ...base, amount: 300, debit: 500, credit: 200 })).toEqual({
      minor: 300,
    });
  });

  it("refuses a row whose amount is zero", () => {
    expect(signedAmountMinor({ ...base, amount: 0 })).toEqual({
      problem: expect.stringMatching(/amount/i),
    });
  });

  it("ignores the zeros an unmapped money column arrives as", () => {
    // `applyMapping` gives 0 for a column nobody mapped, so a file with only an
    // Amount column still reaches here with debit: 0, credit: 0.
    expect(signedAmountMinor({ ...base, amount: -320000, debit: 0, credit: 0 })).toEqual({
      minor: -320000,
    });
    expect(signedAmountMinor({ ...base, amount: 0, debit: 0, credit: 16800 })).toEqual({
      minor: -16800,
    });
  });
});

describe("transactionRawHash", () => {
  const input = {
    bankAccountId: "bank-1",
    txnDate: "2026-01-15",
    description: "Zelle Transfer",
    signedMinor: 12550,
  };

  it("is stable for the same row", () => {
    expect(transactionRawHash(input)).toBe(transactionRawHash({ ...input }));
  });

  it("changes when any part of the row changes", () => {
    const original = transactionRawHash(input);
    expect(transactionRawHash({ ...input, bankAccountId: "bank-2" })).not.toBe(original);
    expect(transactionRawHash({ ...input, txnDate: "2026-01-16" })).not.toBe(original);
    expect(transactionRawHash({ ...input, description: "Other" })).not.toBe(original);
    expect(transactionRawHash({ ...input, signedMinor: -12550 })).not.toBe(original);
  });

  it("is a hex digest, not the row itself", () => {
    expect(transactionRawHash(input)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("describeTransactionRow", () => {
  it("reads as the line a person would check", () => {
    const line = describeTransactionRow({ ...base, amount: -320000 }, -320000);
    expect(line).toContain("2026-01-15");
    expect(line).toContain("Inventory Purchase");
    expect(line).toContain("Zelle Transfer");
  });
});
