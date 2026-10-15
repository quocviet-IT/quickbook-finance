import { describe, expect, it } from "vitest";
import type { BankStanding } from "@/lib/domain/bank-standing";
import {
  historyClosingCell,
  historyDatedCell,
  historySinceCell,
  withStandings,
  type HistoryAccount,
} from "@/lib/domain/reconcile-history";

const money = (m: number) => (m < 0 ? "-" : "") + "$" + (Math.abs(m) / 100).toFixed(2);

const reconciled: BankStanding = {
  bankAccountId: "b1",
  lastCompletedId: "r1",
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
const never: BankStanding = {
  ...reconciled,
  lastCompletedId: null,
  lastCompletedDate: null,
  lastClosingMinor: null,
  sinceCount: 7,
  sinceNetMinor: -4_500,
};

describe("historyClosingCell", () => {
  it("is the closing, flagged when brought forward", () => {
    expect(historyClosingCell(reconciled, money)).toEqual({ amount: "$12500.00", broughtForward: false });
    expect(historyClosingCell({ ...reconciled, lastBroughtForward: true }, money)).toEqual({
      amount: "$12500.00",
      broughtForward: true,
    });
  });
  it("is nothing when never reconciled or unread", () => {
    expect(historyClosingCell(never, money)).toBeNull();
    expect(historyClosingCell(null, money)).toBeNull();
  });
  it("reads a dash, never $0.00, when a reconciliation has no closing recorded", () => {
    expect(historyClosingCell({ ...reconciled, lastClosingMinor: null }, money)).toEqual({ amount: "—", broughtForward: false });
  });
});

describe("historySinceCell", () => {
  it("counts and nets what has happened since", () => {
    expect(historySinceCell({ ...reconciled, sinceCount: 3, sinceNetMinor: 12_000 }, money)).toEqual(["3 entries", "$120.00"]);
    expect(historySinceCell({ ...reconciled, sinceCount: 1, sinceNetMinor: -500 }, money)).toEqual(["1 entry", "-$5.00"]);
  });
  it("says nothing since for a reconciled account with no activity", () => {
    expect(historySinceCell(reconciled, money)).toEqual(["Nothing since"]);
  });
  it("gives all the lines of a never-reconciled account", () => {
    expect(historySinceCell(never, money)).toEqual(["7 entries", "-$45.00"]);
  });
  it("says no activity for a never-reconciled account with nothing in it, as the Balance Sheet does", () => {
    expect(historySinceCell({ ...never, sinceCount: 0, sinceNetMinor: 0, bookMinor: 0 }, money)).toEqual(["No activity"]);
  });
  it("is a dash when the standing is unread", () => {
    expect(historySinceCell(null, money)).toEqual(["—"]);
  });
});

describe("historyDatedCell", () => {
  it("prints the first date, then the last under it", () => {
    expect(historyDatedCell("2026-01-02", "2026-09-30")).toEqual(["Jan 2, 2026", "– Sep 30, 2026"]);
  });
  it("prints one date when both are the same, and nothing when there are none", () => {
    expect(historyDatedCell("2026-09-30", "2026-09-30")).toEqual(["Sep 30, 2026"]);
    expect(historyDatedCell(null, null)).toBeNull();
  });
});

describe("withStandings", () => {
  const account = (id: string) => ({ bankAccountId: id }) as HistoryAccount;
  it("joins by account and leaves the rest null", () => {
    const rows = withStandings([account("b1"), account("b2")], [reconciled]);
    expect(rows[0].standing).toBe(reconciled);
    expect(rows[1].standing).toBeNull();
  });
  it("leaves every row null when the standing could not be read", () => {
    expect(withStandings([account("b1")], null)[0].standing).toBeNull();
  });
});
