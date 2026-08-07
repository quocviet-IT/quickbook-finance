import { describe, expect, it } from "vitest";
import {
  filterTransactionList,
  NO_PARTY,
  transactionListChoices,
  type TransactionListFilter,
  type TransactionListRow,
} from "@/lib/domain/transaction-list";

const BANK = "11111111-1111-4111-8111-111111111111";
const FEES = "22222222-2222-4222-8222-222222222222";
const RENT = "33333333-3333-4333-8333-333333333333";
const TAX = "44444444-4444-4444-8444-444444444444";

function row(over: Partial<TransactionListRow>): TransactionListRow {
  return {
    entryId: "e1",
    entryNumber: "JE-0001",
    entryDate: "2026-08-01",
    description: "Something",
    sourceType: "manual",
    partyName: null,
    categoryLabel: null,
    moneyLabel: null,
    amountMinor: -1000,
    currencyCode: "USD",
    reconciled: false,
    accountIds: [],
    ...over,
  };
}

const empty: TransactionListFilter = {
  party: null,
  accountId: null,
  sourceType: null,
  reconciled: "all",
  search: "",
};

/** A four-account entry: its category side reads "— Split —" on screen. */
const split = row({
  entryId: "split",
  entryNumber: "JE-0009",
  description: "Monthly overheads",
  categoryLabel: "— Split —",
  moneyLabel: "Operating Bank Account",
  accountIds: [BANK, FEES, RENT, TAX],
});

const simple = row({
  entryId: "simple",
  entryNumber: "JE-0002",
  description: "Bank charge",
  partyName: null,
  categoryLabel: "Bank Service Charges",
  moneyLabel: "Operating Bank Account",
  accountIds: [BANK, FEES],
});

const billFromVendor = row({
  entryId: "bill",
  entryNumber: "BILL-0007",
  description: "Office rent",
  sourceType: "bill",
  partyName: "Harbor Properties",
  categoryLabel: "Rent",
  moneyLabel: null,
  reconciled: true,
  accountIds: [RENT],
});

const all = [split, simple, billFromVendor];

describe("filtering by account", () => {
  it("keeps a split entry that touches the account", () => {
    // The whole reason the report had to return account ids. Filtering on the
    // label would drop this row and the reviewer would never know.
    const kept = filterTransactionList(all, { ...empty, accountId: RENT });
    expect(kept.map((r) => r.entryId)).toEqual(["split", "bill"]);
  });

  it("leaves out entries that never touched it", () => {
    const kept = filterTransactionList(all, { ...empty, accountId: TAX });
    expect(kept.map((r) => r.entryId)).toEqual(["split"]);
  });
});

describe("filtering by party", () => {
  it("matches the party exactly", () => {
    const kept = filterTransactionList(all, { ...empty, party: "Harbor Properties" });
    expect(kept.map((r) => r.entryId)).toEqual(["bill"]);
  });

  it("offers 'no party' as a choice of its own", () => {
    const kept = filterTransactionList(all, { ...empty, party: NO_PARTY });
    expect(kept.map((r) => r.entryId)).toEqual(["split", "simple"]);
  });
});

describe("filtering by document type and reconciled state", () => {
  it("matches the source type", () => {
    expect(
      filterTransactionList(all, { ...empty, sourceType: "bill" }).map((r) => r.entryId),
    ).toEqual(["bill"]);
  });

  it("still separates reconciled from not", () => {
    expect(filterTransactionList(all, { ...empty, reconciled: "yes" }).map((r) => r.entryId)).toEqual(
      ["bill"],
    );
    expect(filterTransactionList(all, { ...empty, reconciled: "no" }).map((r) => r.entryId)).toEqual(
      ["split", "simple"],
    );
  });
});

describe("searching", () => {
  it("looks across description, entry number, party and both labels", () => {
    const find = (search: string) =>
      filterTransactionList(all, { ...empty, search }).map((r) => r.entryId);
    expect(find("overheads")).toEqual(["split"]);
    expect(find("BILL-0007")).toEqual(["bill"]);
    expect(find("harbor")).toEqual(["bill"]);
    expect(find("Bank Service")).toEqual(["simple"]);
    expect(find("operating bank")).toEqual(["split", "simple"]);
  });

  it("ignores case and surrounding space", () => {
    expect(
      filterTransactionList(all, { ...empty, search: "  MONTHLY  " }).map((r) => r.entryId),
    ).toEqual(["split"]);
  });
});

describe("the filters together", () => {
  it("narrows by all of them at once", () => {
    const kept = filterTransactionList(all, {
      party: NO_PARTY,
      accountId: BANK,
      sourceType: "manual",
      reconciled: "no",
      search: "charge",
    });
    expect(kept.map((r) => r.entryId)).toEqual(["simple"]);
  });

  it("returns everything when nothing is set", () => {
    expect(filterTransactionList(all, empty)).toEqual(all);
  });
});

describe("transactionListChoices", () => {
  it("offers only what the rows on screen actually hold", () => {
    const choices = transactionListChoices(all);
    expect(choices.parties).toEqual(["Harbor Properties"]);
    expect(choices.sourceTypes).toEqual(["bill", "manual"]);
    expect(choices.accountIds).toEqual([BANK, FEES, RENT, TAX].sort());
  });

  it("says nothing at all for an empty report", () => {
    expect(transactionListChoices([])).toEqual({
      parties: [],
      accountIds: [],
      sourceTypes: [],
    });
  });
});
