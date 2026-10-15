import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STANDING_AMBER_DAYS,
  STANDING_RED_DAYS,
  describeStanding,
  reconcileCardText,
  toBankStanding,
  withBelowZero,
  type BankStanding,
} from "@/lib/domain/bank-standing";

const money = (m: number) => (m < 0 ? "-" : "") + "$" + (Math.abs(m) / 100).toFixed(2);

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

const never: BankStanding = {
  ...base,
  lastCompletedId: null,
  lastCompletedDate: null,
  lastClosingMinor: null,
  bookMinor: 0,
};

/** A standing whose last agreed date is `days` before 2026-09-01. */
function aged(days: number, over: Partial<BankStanding> = {}): BankStanding {
  const d = new Date(Date.UTC(2026, 8, 1) - days * 86_400_000).toISOString().slice(0, 10);
  return { ...base, lastCompletedDate: d, ...over };
}

afterEach(() => vi.useRealTimers());

describe("constants", () => {
  it("are 60 and 180", () => {
    expect(STANDING_AMBER_DAYS).toBe(60);
    expect(STANDING_RED_DAYS).toBe(180);
  });
});

describe("describeStanding wording", () => {
  it("agreed with activity since, plural", () => {
    const v = describeStanding(
      { ...base, sinceCount: 3, sinceNetMinor: 45_050 },
      "2026-07-15",
      money,
    );
    expect(v.text).toBe("Agreed to Jun 30, 2026 at $12500.00 · 3 entries since, $450.50 not on a statement");
  });

  it("agreed with activity since, singular", () => {
    const v = describeStanding({ ...base, sinceCount: 1, sinceNetMinor: -2_000 }, "2026-07-15", money);
    expect(v.text).toBe("Agreed to Jun 30, 2026 at $12500.00 · 1 entry since, -$20.00 not on a statement");
  });

  it("agreed, nothing since", () => {
    const v = describeStanding(base, "2026-07-15", money);
    expect(v.text).toBe("Agreed to Jun 30, 2026 at $12500.00 · nothing since");
  });

  it("brought forward closing", () => {
    const v = describeStanding({ ...base, lastBroughtForward: true }, "2026-07-15", money);
    expect(v.text).toBe("Agreed to Jun 30, 2026 at $12500.00 (brought forward) · nothing since");
    const w = describeStanding(
      { ...base, lastBroughtForward: true, sinceCount: 2, sinceNetMinor: 100 },
      "2026-07-15",
      money,
    );
    expect(w.text).toBe(
      "Agreed to Jun 30, 2026 at $12500.00 (brought forward) · 2 entries since, $1.00 not on a statement",
    );
  });

  it("never reconciled, plural and singular", () => {
    expect(describeStanding({ ...never, sinceCount: 4, sinceNetMinor: 99_900 }, "2026-07-15", money).text).toBe(
      "Never reconciled · 4 entries, $999.00 not on a statement",
    );
    expect(describeStanding({ ...never, sinceCount: 1, sinceNetMinor: 500 }, "2026-07-15", money).text).toBe(
      "Never reconciled · 1 entry, $5.00 not on a statement",
    );
  });

  it("never reconciled with lines netting to zero is still danger", () => {
    const v = describeStanding({ ...never, sinceCount: 2, sinceNetMinor: 0 }, "2026-07-15", money);
    expect(v.text).toBe("Never reconciled · 2 entries, $0.00 not on a statement");
    expect(v.tone).toBe("danger");
  });

  it("never reconciled with a balance but no lines", () => {
    const v = describeStanding({ ...never, bookMinor: 7_000 }, "2026-07-15", money);
    expect(v.text).toBe("Never reconciled · 0 entries, $0.00 not on a statement");
    expect(v.tone).toBe("danger");
    expect(v.ageDays).toBeNull();
  });

  it("no activity is neutral", () => {
    const v = describeStanding(never, "2026-07-15", money);
    expect(v.text).toBe("No activity");
    expect(v.tone).toBe("neutral");
    expect(v.ageDays).toBeNull();
    expect(v.noLongerAgrees).toBeNull();
  });
});

describe("no longer agrees", () => {
  const voided = { ...base, voidTickedCount: 3, voidTickedMinor: -12_345, voidReconciliationDate: "2026-05-31" };

  it("plural, date and amount", () => {
    const v = describeStanding(voided, "2026-07-01", money);
    expect(v.noLongerAgrees).toBe(
      "No longer agrees: 3 entries ticked on the May 31, 2026 reconciliation were voided (-$123.45)",
    );
  });

  it("singular", () => {
    const v = describeStanding({ ...voided, voidTickedCount: 1, voidTickedMinor: 5_000 }, "2026-07-01", money);
    expect(v.noLongerAgrees).toBe(
      "No longer agrees: 1 entry ticked on the May 31, 2026 reconciliation was voided ($50.00)",
    );
  });

  it("is danger at one day old", () => {
    const v = describeStanding({ ...voided, lastCompletedDate: "2026-06-30" }, "2026-07-01", money);
    expect(v.ageDays).toBe(1);
    expect(v.tone).toBe("danger");
  });

  it("words a voided tick without its date, singular and plural", () => {
    const one = describeStanding({ ...voided, voidTickedCount: 1, voidTickedMinor: 5_000, voidReconciliationDate: null }, "2026-07-01", money);
    expect(one.noLongerAgrees).toBe(
      "No longer agrees: 1 entry ticked on a completed reconciliation was voided ($50.00)",
    );
    const many = describeStanding({ ...voided, voidReconciliationDate: null }, "2026-07-01", money);
    expect(many.noLongerAgrees).toBe(
      "No longer agrees: 3 entries ticked on a completed reconciliation were voided (-$123.45)",
    );
  });

  it("is absent when nothing was voided", () => {
    expect(describeStanding(base, "2026-07-01", money).noLongerAgrees).toBeNull();
  });
});

describe("tone by age", () => {
  const asOf = "2026-09-01";
  it.each([
    [0, "positive"],
    [1, "positive"],
    [60, "positive"],
    [61, "warning"],
    [180, "warning"],
    [181, "danger"],
  ] as const)("%i days is %s", (days, tone) => {
    const v = describeStanding(aged(days), asOf, money);
    expect(v.ageDays).toBe(days);
    expect(v.tone).toBe(tone);
  });

  it("measures to the report date, not to today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T12:00:00Z"));
    const v = describeStanding(base, "2026-07-15", money);
    expect(v.ageDays).toBe(15);
    expect(v.tone).toBe("positive");
  });

  it("treats a report date before the last agreement as age 0", () => {
    const v = describeStanding(base, "2026-06-01", money);
    expect(v.ageDays).toBe(0);
    expect(v.tone).toBe("positive");
  });
});

describe("toBankStanding", () => {
  it("maps nulls", () => {
    const s = toBankStanding({
      bank_account_id: "a",
      last_completed_id: null,
      last_completed_date: null,
      last_closing_minor: null,
      last_brought_forward: null,
      since_count: 0,
      since_net_minor: 0,
      earlier_open_count: 0,
      earlier_open_net_minor: 0,
      void_ticked_count: 0,
      void_ticked_minor: 0,
      void_reconciliation_date: null,
      book_minor: 0,
    });
    expect(s).toEqual({
      bankAccountId: "a",
      lastCompletedId: null,
      lastCompletedDate: null,
      lastClosingMinor: null,
      lastBroughtForward: false,
      sinceCount: 0,
      sinceNetMinor: 0,
      earlierOpenCount: 0,
      earlierOpenNetMinor: 0,
      voidTickedCount: 0,
      voidTickedMinor: 0,
      voidReconciliationDate: null,
      bookMinor: 0,
    });
  });

  it("converts numeric strings and keeps values", () => {
    const s = toBankStanding({
      bank_account_id: "b",
      last_completed_id: "r",
      last_completed_date: "2026-06-30",
      last_closing_minor: "1250000",
      last_brought_forward: true,
      since_count: "3",
      since_net_minor: "-4500",
      earlier_open_count: "2",
      earlier_open_net_minor: "800",
      void_ticked_count: "1",
      void_ticked_minor: "-100",
      void_reconciliation_date: "2026-05-31",
      book_minor: "99",
    });
    expect(s.lastClosingMinor).toBe(1_250_000);
    expect(s.lastBroughtForward).toBe(true);
    expect(s.sinceCount).toBe(3);
    expect(s.sinceNetMinor).toBe(-4500);
    expect(s.earlierOpenCount).toBe(2);
    expect(s.earlierOpenNetMinor).toBe(800);
    expect(s.voidTickedMinor).toBe(-100);
    expect(s.voidReconciliationDate).toBe("2026-05-31");
    expect(s.bookMinor).toBe(99);
  });
});

describe("reconcileCardText", () => {
  it("never reconciled, plural", () => {
    expect(reconcileCardText("Harbor Checking", { ...never, sinceCount: 5, sinceNetMinor: 12_000 }, money)).toBe(
      "Harbor Checking has never been reconciled. 5 entries, $120.00, are waiting on a statement. Start with the oldest statement you have.",
    );
  });

  it("never reconciled, singular", () => {
    expect(reconcileCardText("Harbor Checking", { ...never, sinceCount: 1, sinceNetMinor: 300 }, money)).toBe(
      "Harbor Checking has never been reconciled. 1 entry, $3.00, is waiting on a statement. Start with the oldest statement you have.",
    );
  });

  it("never reconciled, no activity", () => {
    expect(reconcileCardText("Harbor Checking", never, money)).toBe(
      "Harbor Checking has never been reconciled. No entries are waiting on a statement yet.",
    );
  });

  it("reconciled, nothing since", () => {
    expect(reconcileCardText("Harbor Checking", base, money)).toBe("Reconciled to Jun 30, 2026; nothing new since.");
  });

  it("reconciled with activity uses the account line", () => {
    const s = { ...base, sinceCount: 2, sinceNetMinor: 1_000 };
    expect(reconcileCardText("Harbor Checking", s, money)).toBe(
      "Agreed to Jun 30, 2026 at $12500.00 · 2 entries since, $10.00 not on a statement",
    );
  });
});

describe("withBelowZero", () => {
  it("appends the date", () => {
    expect(withBelowZero("Agreed to Jun 30, 2026 at $1.00 · nothing since", "2026-03-04")).toBe(
      "Agreed to Jun 30, 2026 at $1.00 · nothing since · below zero at Mar 4, 2026",
    );
  });
});

describe("an unreadable date", () => {
  it("never reads a bank account's age as green when the last agreed date does not parse", () => {
    const v = describeStanding({ ...base, lastCompletedDate: "not a date" }, "2026-07-01", money);
    expect(v.ageDays).toBeNull();
    expect(v.tone).toBe("danger");
  });

  it("does the same when the report date does not parse", () => {
    const v = describeStanding(base, "", money);
    expect(v.ageDays).toBeNull();
    expect(v.tone).toBe("danger");
  });
});

describe("module stays lean", () => {
  it("has no value import from React or the tone module", () => {
    const src = readFileSync(join(process.cwd(), "lib/domain/bank-standing.ts"), "utf8");
    const imports = src.match(/^import[^;]*;/gm) ?? [];
    for (const line of imports) {
      expect(line).not.toMatch(/from\s+["']react/);
      if (/design\/tone/.test(line)) expect(line).toMatch(/^import type\s/);
    }
  });
});
