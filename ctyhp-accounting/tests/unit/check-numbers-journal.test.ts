import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  duplicateCheckNumbers,
  journalReferenceRows,
  paymentRefLabel,
  type ExceptionPaymentRef,
} from "@/lib/domain/exceptions";

/**
 * 2.98: the check-number scan reads manual journal entries too.
 *
 * It read customer and bill payments only, so a check written by hand and keyed
 * as a journal entry against the bank, then keyed again as a bill payment with
 * the same number, was never flagged (prototype parity review, 30 Oct).
 */
const line = (over: Record<string, unknown>) => ({
  id: "l1",
  journal_entry_id: "je1",
  account_id: "bank",
  debit_minor: 0,
  credit_minor: 25_000,
  acc_account: { name: "Operating Checking", account_type: "bank" },
  acc_journal_entry: {
    entry_number: "JE-000101",
    entry_date: "2026-10-03",
    description: "Hand check to a supplier",
    source_ref: " 1042 ",
    source_type: "manual",
    status: "posted",
  },
  ...over,
});

const billPayment: ExceptionPaymentRef = {
  paymentId: "bp1",
  kind: "vendor",
  paymentNumber: "BP-000007",
  journalEntryId: "je9",
  paymentDate: "2026-10-04",
  reference: "1042",
  accountId: "bank",
  accountName: "Operating Checking",
  partyName: "Example Supplies",
  amountMinor: 25_000,
};

describe("manual journal entries as check references", () => {
  it("gives one reference per entry and bank account, for the money moved through it", () => {
    const refs = journalReferenceRows(
      [line({ id: "l1", credit_minor: 20_000 }), line({ id: "l2", credit_minor: 5_000 })],
      new Set(),
    );
    expect(refs).toEqual([
      {
        paymentId: "je1:bank",
        kind: "journal",
        paymentNumber: "JE-000101",
        journalEntryId: "je1",
        paymentDate: "2026-10-03",
        reference: "1042",
        accountId: "bank",
        accountName: "Operating Checking",
        partyName: "Hand check to a supplier",
        amountMinor: 25_000,
      },
    ]);
  });

  it("leaves out an entry since reversed, and one with no reference", () => {
    expect(journalReferenceRows([line({})], new Set(["je1"]))).toEqual([]);
    expect(
      journalReferenceRows([line({ acc_journal_entry: { ...line({}).acc_journal_entry, source_ref: "  " } })], new Set()),
    ).toEqual([]);
  });

  it("flags the number when a journal entry and a bill payment both used it on one account", () => {
    const clashes = duplicateCheckNumbers([...journalReferenceRows([line({})], new Set()), billPayment]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].reference).toBe("1042");
    expect(clashes[0].payments.map(paymentRefLabel)).toEqual(["Journal entry JE-000101", "Bill payment BP-000007"]);
  });

  it("does not flag the same number on two different accounts", () => {
    const other = { ...billPayment, accountId: "savings", accountName: "Savings" };
    expect(duplicateCheckNumbers([...journalReferenceRows([line({})], new Set()), other])).toEqual([]);
  });

  it("reads only posted manual entries with a reference, on bank and card accounts", () => {
    const service = readFileSync(join(process.cwd(), "lib/services/exceptions.ts"), "utf8");
    expect(service).toMatch(/\.eq\("acc_journal_entry\.source_type", "manual"\)/);
    expect(service).toMatch(/\.eq\("acc_journal_entry\.status", "posted"\)/);
    expect(service).toMatch(/\.not\("acc_journal_entry\.source_ref", "is", null\)/);
    expect(service).toMatch(/\.in\("acc_account\.account_type", \["bank", "credit_card"\]\)/);
    expect(service).toMatch(/const \[customer, vendor, journal\] = await Promise\.all/);
  });
});
