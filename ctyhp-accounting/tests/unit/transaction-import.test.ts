import { describe, expect, it } from "vitest";
import { fieldsFor, TARGET_LABEL } from "@/lib/domain/import-mapping";
import {
  describeTransactionRow,
  signedAmountMinor,
  transactionFileChecksum,
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

  it("calls a row with nothing in it empty, not broken", () => {
    // The tester's file had 99 rows reading "fee waiver" — a real charge that
    // was waived, so the amount is 0. Telling them to map a column they had
    // already mapped sent them looking for a mistake that was not theirs.
    expect(signedAmountMinor(base)).toEqual({ empty: true });
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

  it("calls a row whose amount is explicitly zero empty too", () => {
    expect(signedAmountMinor({ ...base, amount: 0 })).toEqual({ empty: true });
    expect(signedAmountMinor({ ...base, debit: 0, credit: 0 })).toEqual({ empty: true });
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

  it("tells two identical rows in one file apart", () => {
    // A bank can charge the same wire fee twice on the same day, and one file
    // did. Hashed the same they collide on the dedupe index and the second is
    // dropped in silence.
    const first = transactionRawHash({ ...input, occurrence: 0 });
    const second = transactionRawHash({ ...input, occurrence: 1 });
    expect(second).not.toBe(first);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    // Stable, so the same pair is recognised if the file is imported again.
    expect(transactionRawHash({ ...input, occurrence: 1 })).toBe(second);
  });

  it("leaves the first of a kind hashing exactly as it always did", () => {
    // Rows already imported have to keep recognising themselves.
    expect(transactionRawHash({ ...input, occurrence: 0 })).toBe(transactionRawHash(input));
  });
});

describe("transactionFileChecksum", () => {
  const rows = [
    ["2026-01-15", "Zelle Transfer", "121", "Sales", "-3200.00"],
    ["2026-01-16", "Deposit", "121", "Sales", "969.00"],
  ];

  it("is the same for the same rows, whatever the file was called", () => {
    expect(transactionFileChecksum(rows)).toBe(transactionFileChecksum([...rows]));
    expect(transactionFileChecksum(rows)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the rows change", () => {
    const edited = [rows[0], ["2026-01-16", "Deposit", "121", "Sales", "970.00"]];
    expect(transactionFileChecksum(edited)).not.toBe(transactionFileChecksum(rows));
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
