import { describe, expect, it } from "vitest";
import {
  amountMagnitudeMatches,
  EMPTY_AMOUNT_FILTER,
  filterBankTransactions,
  filterGeneralLedgerRows,
  parseAmountFilterInput,
  type AmountFilter,
  type BankTransactionFilterRow,
  type GeneralLedgerFilterRow,
} from "@/lib/domain/transaction-filter";

// --- Bank Transactions fixtures ---------------------------------------------

interface BankRow extends BankTransactionFilterRow {
  id: string;
}

function bankRow(over: Partial<BankRow> & { id: string }): BankRow {
  return {
    description: "Something",
    reference: null,
    amount_minor: 0,
    ...over,
  };
}

// Two rows share a magnitude with opposite signs, so an exact-amount search
// for that magnitude is the test that the filter compares by magnitude, not
// by signed value.
const coffee = bankRow({ id: "coffee", description: "Coffee shop purchase", reference: "REF100", amount_minor: -125000 });
const payment = bankRow({ id: "payment", description: "Client payment received", reference: "INV2001", amount_minor: 125000 });
const rent = bankRow({ id: "rent", description: "Office rent", reference: "RENT08", amount_minor: -500000 });
const refund = bankRow({ id: "refund", description: "Refund issued to customer", reference: null, amount_minor: -30000 });
// Sits exactly on the min/max boundaries used below, to prove the range is
// inclusive on both ends rather than off by one in either direction.
const boundary = bankRow({ id: "boundary", description: "Equipment lease payment", reference: "LEASE100", amount_minor: -100000 });

const bankRows = [coffee, payment, rent, refund, boundary];
const ids = (rows: BankRow[]) => rows.map((r) => r.id);

describe("bank transactions: amount filter", () => {
  it("matches an exact amount by magnitude, not sign", () => {
    // Fails if Math.abs() around row.amount_minor is removed in
    // filterBankTransactions — "payment" (+125000) would still match but
    // "coffee" (-125000) would drop out, since exactMinor is stored positive.
    const kept = filterBankTransactions(bankRows, "", { ...EMPTY_AMOUNT_FILTER, exactMinor: 125000 });
    expect(ids(kept)).toEqual(["coffee", "payment"]);
  });

  it("min amount includes the boundary row itself", () => {
    // Fails if the min comparison is changed from `<` to `<=` (which would
    // wrongly exclude a row sitting exactly on the boundary): "boundary" at
    // exactly 100000 would then drop out.
    const kept = filterBankTransactions(bankRows, "", { ...EMPTY_AMOUNT_FILTER, minMinor: 100000 });
    expect(ids(kept)).toEqual(["coffee", "payment", "rent", "boundary"]);
  });

  it("max amount includes the boundary row itself", () => {
    // Fails if the max comparison is changed from `>` to `>=` (excluding the
    // boundary row): "boundary" at exactly 100000 would then drop out,
    // leaving only "refund".
    const kept = filterBankTransactions(bankRows, "", { ...EMPTY_AMOUNT_FILTER, maxMinor: 100000 });
    expect(ids(kept)).toEqual(["refund", "boundary"]);
  });

  it("min and max together narrow to the range", () => {
    // Fails if minMinor and maxMinor are not both applied (e.g. one branch
    // short-circuits or is skipped when the other is set): "rent" (500000,
    // above the max) or "refund" (30000, below the min) would leak in.
    const kept = filterBankTransactions(bankRows, "", { exactMinor: null, minMinor: 100000, maxMinor: 200000 });
    expect(ids(kept)).toEqual(["coffee", "payment", "boundary"]);
  });
});

describe("bank transactions: keyword filter", () => {
  it("searches the description field", () => {
    // Fails if row.description is dropped from the fields passed to
    // keywordMatches — "rent" only appears in the description of this row.
    expect(ids(filterBankTransactions(bankRows, "rent", EMPTY_AMOUNT_FILTER))).toEqual(["rent"]);
  });

  it("searches the reference field", () => {
    // Fails if row.reference is dropped from the fields passed to
    // keywordMatches — "INV2001" appears nowhere but the reference column.
    expect(ids(filterBankTransactions(bankRows, "INV2001", EMPTY_AMOUNT_FILTER))).toEqual(["payment"]);
  });

  it("does not throw on a row with a null reference", () => {
    // "refund" has reference: null; a keyword search must still run over it.
    expect(ids(filterBankTransactions(bankRows, "refund", EMPTY_AMOUNT_FILTER))).toEqual(["refund"]);
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(ids(filterBankTransactions(bankRows, "  OFFICE  ", EMPTY_AMOUNT_FILTER))).toEqual(["rent"]);
  });

  it("returns nothing for a keyword that matches no row", () => {
    expect(filterBankTransactions(bankRows, "nonexistent-keyword-xyz", EMPTY_AMOUNT_FILTER)).toEqual([]);
  });
});

describe("bank transactions: keyword and amount together", () => {
  it("requires both conditions to hold", () => {
    // Both "payment" and "boundary" have descriptions containing "payment".
    // Only "payment" also has magnitude 125000, so requiring both conditions
    // (an AND, not an OR) is what narrows it to one row. Fails if the two
    // predicates are combined with || instead of &&, or if one is dropped.
    const kept = filterBankTransactions(bankRows, "payment", { ...EMPTY_AMOUNT_FILTER, exactMinor: 125000 });
    expect(ids(kept)).toEqual(["payment"]);
  });
});

describe("bank transactions: clearing filters", () => {
  it("empty keyword and empty amount filter return every row, unchanged and in order", () => {
    expect(filterBankTransactions(bankRows, "", EMPTY_AMOUNT_FILTER)).toEqual(bankRows);
  });
});

// --- General Ledger fixtures -------------------------------------------------

interface GlRow extends GeneralLedgerFilterRow {
  id: string;
}

function glRow(over: Partial<GlRow> & { id: string }): GlRow {
  return {
    entryNumber: "JE-0000",
    memo: null,
    sourceType: "manual",
    debitMinor: 0,
    creditMinor: 0,
    ...over,
  };
}

// "deposit" carries its amount on the debit side, "glPayment" on the credit
// side, at the same magnitude — proving the filter reads whichever column is
// nonzero rather than reading debitMinor alone.
const deposit = glRow({ id: "deposit", entryNumber: "JE-0001", memo: "Client deposit received", sourceType: "invoice", debitMinor: 125000 });
const glPayment = glRow({ id: "glPayment", entryNumber: "JE-0002", memo: "Vendor payment issued", sourceType: "bill_payment", creditMinor: 125000 });
const glRent = glRow({ id: "glRent", entryNumber: "JE-0003", memo: "Monthly office rent", sourceType: "manual", creditMinor: 500000 });
const fee = glRow({ id: "fee", entryNumber: "JE-0004", memo: "Bank service fee", sourceType: "manual", debitMinor: 3000 });
const glBoundary = glRow({ id: "glBoundary", entryNumber: "JE-0005", memo: "Equipment lease", sourceType: "manual", debitMinor: 100000 });

const glRows = [deposit, glPayment, glRent, fee, glBoundary];
const glIds = (rows: GlRow[]) => rows.map((r) => r.id);

describe("general ledger: amount filter", () => {
  it("matches an exact amount whether it is a debit or a credit", () => {
    // Fails if Math.max(row.debitMinor, row.creditMinor) is replaced with
    // row.debitMinor alone — "glPayment", which only carries a credit, would
    // then be read as amount 0 and drop out.
    const kept = filterGeneralLedgerRows(glRows, "", { ...EMPTY_AMOUNT_FILTER, exactMinor: 125000 });
    expect(glIds(kept)).toEqual(["deposit", "glPayment"]);
  });

  it("min amount includes the boundary row itself", () => {
    const kept = filterGeneralLedgerRows(glRows, "", { ...EMPTY_AMOUNT_FILTER, minMinor: 100000 });
    expect(glIds(kept)).toEqual(["deposit", "glPayment", "glRent", "glBoundary"]);
  });

  it("max amount includes the boundary row itself", () => {
    const kept = filterGeneralLedgerRows(glRows, "", { ...EMPTY_AMOUNT_FILTER, maxMinor: 100000 });
    expect(glIds(kept)).toEqual(["fee", "glBoundary"]);
  });
});

describe("general ledger: keyword filter", () => {
  it("searches the memo field", () => {
    expect(glIds(filterGeneralLedgerRows(glRows, "office", EMPTY_AMOUNT_FILTER))).toEqual(["glRent"]);
  });

  it("searches the entry number field", () => {
    // Fails if row.entryNumber is dropped from the searched fields — this
    // string appears nowhere else on the row.
    expect(glIds(filterGeneralLedgerRows(glRows, "JE-0002", EMPTY_AMOUNT_FILTER))).toEqual(["glPayment"]);
  });

  it("searches the source type field", () => {
    // Fails if row.sourceType is dropped from the searched fields —
    // "bill_payment" appears nowhere else on the row (the memo says
    // "Vendor payment issued", not "bill_payment").
    expect(glIds(filterGeneralLedgerRows(glRows, "bill_payment", EMPTY_AMOUNT_FILTER))).toEqual(["glPayment"]);
  });

  it("returns nothing for a keyword that matches no row", () => {
    expect(filterGeneralLedgerRows(glRows, "nonexistent-keyword-xyz", EMPTY_AMOUNT_FILTER)).toEqual([]);
  });
});

describe("general ledger: keyword and amount together", () => {
  it("requires both conditions to hold", () => {
    // "glBoundary" is the only row whose memo contains "lease", but its
    // magnitude (100000) is below a 200000 minimum, so the combined filter
    // must return nothing rather than falling back to the keyword match
    // alone.
    const kept = filterGeneralLedgerRows(glRows, "lease", { ...EMPTY_AMOUNT_FILTER, minMinor: 200000 });
    expect(kept).toEqual([]);
  });
});

describe("general ledger: clearing filters", () => {
  it("empty keyword and empty amount filter return every row, unchanged and in order", () => {
    expect(filterGeneralLedgerRows(glRows, "", EMPTY_AMOUNT_FILTER)).toEqual(glRows);
  });
});

// --- Shared amount parsing / matching ---------------------------------------

describe("parseAmountFilterInput", () => {
  it("converts a typed decimal to minor units", () => {
    // Fails if the multiplication by 10**decimals is dropped, or if decimals
    // is ignored — "1250.00" at 2 decimals must become 125000, not 1250.
    expect(parseAmountFilterInput("1250.00", 2)).toBe(125000);
  });

  it("strips thousands separators and a currency symbol before parsing", () => {
    expect(parseAmountFilterInput("$1,250.00", 2)).toBe(125000);
  });

  it("discards a typed minus sign, matching the magnitude decision", () => {
    // Fails if Math.abs() is removed from parseAmountFilterInput.
    expect(parseAmountFilterInput("-1250.00", 2)).toBe(125000);
  });

  it("returns null, not zero, for blank input", () => {
    // Fails if blank input is parsed as 0 instead of returning null — a
    // caller would then wrongly treat "the box is empty" as "find zero-
    // amount rows only".
    expect(parseAmountFilterInput("", 2)).toBeNull();
    expect(parseAmountFilterInput("   ", 2)).toBeNull();
  });

  it("returns null for text that is not a number", () => {
    expect(parseAmountFilterInput("not-an-amount", 2)).toBeNull();
  });

  it("respects a currency's own decimal places", () => {
    // A zero-decimal currency: "1250" is 1250 minor units, not 125000.
    expect(parseAmountFilterInput("1250", 0)).toBe(1250);
  });
});

describe("amountMagnitudeMatches", () => {
  it("matches everything when every field of the filter is null", () => {
    const openFilter: AmountFilter = { exactMinor: null, minMinor: null, maxMinor: null };
    expect(amountMagnitudeMatches(0, openFilter)).toBe(true);
    expect(amountMagnitudeMatches(999_999, openFilter)).toBe(true);
  });
});
