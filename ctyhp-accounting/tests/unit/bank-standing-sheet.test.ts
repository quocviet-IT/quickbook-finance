import { describe, expect, it } from "vitest";
import { balanceSheetBanks, ghostEntriesSentence, type BankStanding } from "@/lib/domain/bank-standing";

const base: BankStanding = {
  bankAccountId: "acct-1",
  lastCompletedId: "rec-1",
  lastCompletedDate: "2026-06-30",
  lastClosingMinor: 1_250_000,
  lastBroughtForward: false,
  sinceCount: 0,
  sinceNetMinor: 0,
  earlierOpenCount: 0,
  earlierOpenNetMinor: 0,
  voidTickedCount: 0,
  voidTickedMinor: 0,
  voidReconciliationDate: null,
  bookMinor: 1_250_000,
};

describe("ghostEntriesSentence", () => {
  it("is singular for one and plural otherwise", () => {
    expect(ghostEntriesSentence(1)).toBe(
      "1 entry looks like the account's own balance posted as payments. Reconcile shows the workings and offers to remove them.",
    );
    expect(ghostEntriesSentence(31)).toBe(
      "31 entries look like the account's own balance posted as payments. Reconcile shows the workings and offers to remove them.",
    );
  });
});

describe("balanceSheetBanks", () => {
  const standing = (id: string): BankStanding => ({ ...base, bankAccountId: id });
  const banks = [
    { id: "b2", name: "Savings" },
    { id: "b1", name: "checking" },
    { id: "b3", name: "Petty Cash" },
  ];

  it("gives one item per bank account, ordered by account name", () => {
    const out = balanceSheetBanks(banks, [standing("b1"), standing("b2"), standing("b3")], []);
    expect(out.map((b) => b.accountName)).toEqual(["checking", "Petty Cash", "Savings"]);
    expect(out.every((b) => !b.belowZero && b.ghostEntries === 0)).toBe(true);
  });

  it("marks the accounts found below zero, with their flagged entries", () => {
    const out = balanceSheetBanks(
      banks,
      [standing("b1"), standing("b2"), standing("b3")],
      [{ bankAccountId: "b2", ghostEntries: 4 }],
    );
    expect(out.find((b) => b.bankAccountId === "b2")).toMatchObject({ belowZero: true, ghostEntries: 4 });
    expect(out.find((b) => b.bankAccountId === "b1")).toMatchObject({ belowZero: false, ghostEntries: 0 });
  });

  it("leaves out an account with no standing row", () => {
    expect(balanceSheetBanks(banks, [standing("b1")], []).map((b) => b.bankAccountId)).toEqual(["b1"]);
  });
});
