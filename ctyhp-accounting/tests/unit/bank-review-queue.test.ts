import { describe, expect, it } from "vitest";
import { buildBankReviewRows } from "@/lib/domain/banking-import";

const account = (id: string, name: string, currency_code: string) => ({
  id,
  name,
  currency_code,
});

const txn = (id: string, bank_account_id: string, amount_minor = 1000) => ({
  id,
  bank_account_id,
  amount_minor,
});

const suggestion = (bank_transaction_id: string, confidence: number, target_number: string) => ({
  id: `s-${bank_transaction_id}`,
  bank_transaction_id,
  confidence,
  target_number,
});

describe("buildBankReviewRows", () => {
  it("names the account each transaction came from", () => {
    // The queue spans accounts, so a row that does not say where it came from
    // is a row nobody can act on.
    const [row] = buildBankReviewRows(
      [txn("t1", "a1")],
      [],
      [account("a1", "Operating Checking", "USD")],
    );
    expect(row.accountName).toBe("Operating Checking");
    expect(row.currencyCode).toBe("USD");
  });

  it("gives every row its own account's currency", () => {
    // Formatting a credit-card line with the checking account's currency is how
    // a review queue starts lying about amounts.
    const rows = buildBankReviewRows(
      [txn("t1", "a1"), txn("t2", "a2")],
      [],
      [account("a1", "Operating Checking", "USD"), account("a2", "Euro Card", "EUR")],
    );
    expect(rows.map((r) => r.currencyCode)).toEqual(["USD", "EUR"]);
  });

  it("attaches the suggested match to its own transaction", () => {
    const rows = buildBankReviewRows(
      [txn("t1", "a1"), txn("t2", "a1")],
      [suggestion("t2", 0.9, "JE-0007")],
      [account("a1", "Operating Checking", "USD")],
    );
    expect(rows[0].suggestion).toBeNull();
    expect(rows[1].suggestion?.target_number).toBe("JE-0007");
  });

  it("keeps the strongest suggestion when a transaction has more than one", () => {
    const rows = buildBankReviewRows(
      [txn("t1", "a1")],
      [suggestion("t1", 0.4, "JE-0001"), suggestion("t1", 0.95, "JE-0002")],
      [account("a1", "Operating Checking", "USD")],
    );
    expect(rows[0].suggestion?.target_number).toBe("JE-0002");
  });

  it("still shows a transaction whose account it cannot name", () => {
    // Dropping the row would hide money that really is on the statement.
    const [row] = buildBankReviewRows([txn("t1", "gone")], [], []);
    expect(row.accountName).toBe("Unknown account");
    expect(row.currencyCode).toBeNull();
  });

  it("preserves the order the transactions arrived in", () => {
    const rows = buildBankReviewRows(
      [txn("t3", "a1"), txn("t1", "a1"), txn("t2", "a1")],
      [],
      [account("a1", "Operating Checking", "USD")],
    );
    expect(rows.map((r) => r.transaction.id)).toEqual(["t3", "t1", "t2"]);
  });
});
