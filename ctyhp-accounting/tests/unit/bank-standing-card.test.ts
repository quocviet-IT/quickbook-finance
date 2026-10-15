import { describe, expect, it } from "vitest";
import { reconcileCard, reconcileEmptyText, type BankStanding } from "@/lib/domain/bank-standing";

const money = (m: number) => (m < 0 ? "-" : "") + "$" + (Math.abs(m) / 100).toFixed(2);

const reconciled: BankStanding = {
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

const never: BankStanding = {
  ...reconciled,
  lastCompletedId: null,
  lastCompletedDate: null,
  lastClosingMinor: null,
  sinceCount: 3,
  sinceNetMinor: 45_000,
  bookMinor: 45_000,
};

describe("reconcileCard", () => {
  it("says nothing new since, in the tone of the statement's age", () => {
    const card = reconcileCard("Example Checking", reconciled, "2026-07-15", money);
    expect(card.text).toBe("Reconciled to Jun 30, 2026; nothing new since.");
    expect(card.tone).toBe("positive");
    expect(card.noLongerAgrees).toBeNull();
  });

  it("turns amber and red as the last agreed statement ages", () => {
    expect(reconcileCard("Example Checking", reconciled, "2026-09-15", money).tone).toBe("warning");
    expect(reconcileCard("Example Checking", reconciled, "2027-02-01", money).tone).toBe("danger");
  });

  it("keeps the nothing-since sentence AND the danger second line when a tick was voided", () => {
    const card = reconcileCard(
      "Example Checking",
      { ...reconciled, voidTickedCount: 2, voidTickedMinor: 12_000, voidReconciliationDate: "2026-06-30" },
      "2026-07-15",
      money,
    );
    expect(card.text).toBe("Reconciled to Jun 30, 2026; nothing new since.");
    expect(card.noLongerAgrees).toBe(
      "No longer agrees: 2 entries ticked on the Jun 30, 2026 reconciliation were voided ($120.00)",
    );
    expect(card.tone).toBe("danger");
  });

  it("words an account with activity since the last statement", () => {
    const card = reconcileCard("Example Checking", { ...reconciled, sinceCount: 4, sinceNetMinor: -2_500 }, "2026-07-15", money);
    expect(card.text).toBe("Agreed to Jun 30, 2026 at $12500.00 · 4 entries since, -$25.00 not on a statement");
  });

  it("says never reconciled with what is waiting, in the danger tone", () => {
    const card = reconcileCard("Example Checking", never, "2026-07-15", money);
    expect(card.text).toBe(
      "Example Checking has never been reconciled. 3 entries, $450.00, are waiting on a statement. Start with the oldest statement you have.",
    );
    expect(card.tone).toBe("danger");
  });

  it("is neutral for a never-reconciled account with no activity", () => {
    const card = reconcileCard("Example Checking", { ...never, sinceCount: 0, sinceNetMinor: 0, bookMinor: 0 }, "2026-07-15", money);
    expect(card.tone).toBe("neutral");
    expect(card.text).toContain("has never been reconciled");
  });
});

describe("reconcileEmptyText", () => {
  it("uses the card's sentence when the standing was read", () => {
    expect(reconcileEmptyText("Example Checking", never, money)).toBe(
      "Example Checking has never been reconciled. 3 entries, $450.00, are waiting on a statement. Start with the oldest statement you have.",
    );
  });

  it("falls back to a plain sentence when the standing could not be read", () => {
    expect(reconcileEmptyText("Example Checking", null, money)).toBe("Example Checking has never been reconciled.");
  });
});
