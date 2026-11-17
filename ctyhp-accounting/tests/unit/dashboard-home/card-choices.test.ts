import { describe, expect, it } from "vitest";
import { DEFAULT_CARD_CHOICES, HOME_PERIOD_KEYS, normalizeCardChoices, type CardChoices } from "@/lib/domain/dashboard-home/card-choices";
import { homePeriodRanges } from "@/lib/domain/dashboard-home/ranges";

describe("the default card choices (3.0.41)", () => {
  it("are the Dashboard as it was: this month, six months of cash, 30 days ahead, 7 days due", () => {
    expect(DEFAULT_CARD_CHOICES).toEqual({
      pnl: "month",
      expenses: "month",
      sales: "month",
      cashMonths: 6,
      horizon: 30,
      invoicesDue: 7,
      billsDue: 7,
    });
  });

  it("cannot be changed by the screen that starts from them", () => {
    expect(Object.isFrozen(DEFAULT_CARD_CHOICES)).toBe(true);
  });

  it("offer every period the calendar has, in the select's order", () => {
    expect(HOME_PERIOD_KEYS).toEqual(["month", "lastMonth", "last3", "quarter", "year", "last12", "lastYear"]);
    expect([...HOME_PERIOD_KEYS].sort()).toEqual(Object.keys(homePeriodRanges("2026-11-17", 1)).sort());
  });
});

describe("normalizeCardChoices", () => {
  const saved: CardChoices = {
    pnl: "last12",
    expenses: "lastYear",
    sales: "last3",
    cashMonths: 12,
    horizon: 90,
    invoicesDue: 30,
    billsDue: 30,
  };

  it("keeps choices the screen offers", () => {
    expect(normalizeCardChoices(saved)).toEqual(saved);
    for (const key of HOME_PERIOD_KEYS) expect(normalizeCardChoices({ pnl: key }).pnl).toBe(key);
    expect(normalizeCardChoices({ horizon: 60 }).horizon).toBe(60);
  });

  it("gives every card left without a choice its default", () => {
    expect(normalizeCardChoices({})).toEqual(DEFAULT_CARD_CHOICES);
    expect(normalizeCardChoices({ sales: "year" })).toEqual({ ...DEFAULT_CARD_CHOICES, sales: "year" });
  });

  it("drops a key it does not know, and a value no select offers", () => {
    const read = normalizeCardChoices({
      ...saved,
      watchlist: "a-1",
      forecast: 45,
      pnl: "nextYear",
      cashMonths: 24,
      horizon: 45,
      invoicesDue: 14,
    });
    expect(read).toEqual({ ...saved, pnl: "month", cashMonths: 6, horizon: 30, invoicesDue: 7 });
    expect(Object.keys(read).sort()).toEqual(Object.keys(DEFAULT_CARD_CHOICES).sort());
  });

  it("takes a number as a number only: text that looks like one is not a choice", () => {
    expect(normalizeCardChoices({ cashMonths: "12", horizon: "90", billsDue: "30", expenses: 1 })).toEqual(DEFAULT_CARD_CHOICES);
  });

  it("reads anything that is not choices as no choices at all", () => {
    for (const raw of [null, undefined, "last12", 12, true, ["last12"], [{ pnl: "last12" }]]) {
      expect(normalizeCardChoices(raw), JSON.stringify(raw)).toEqual(DEFAULT_CARD_CHOICES);
    }
  });

  it("reads only the object's own keys", () => {
    const inherited = Object.create({ pnl: "last12" }) as object;
    expect(normalizeCardChoices(inherited).pnl).toBe("month");
  });

  it("returns a new object every time, never the defaults themselves", () => {
    const read = normalizeCardChoices(null);
    expect(read).not.toBe(DEFAULT_CARD_CHOICES);
    read.pnl = "last3";
    expect(DEFAULT_CARD_CHOICES.pnl).toBe("month");
  });
});
