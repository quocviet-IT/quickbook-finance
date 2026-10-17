import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLEARING_FIFO_NOTE,
  CLEARING_FORM_HELP,
  CLEARING_IDLE_DAYS,
  CLEARING_ITEM_DAYS,
  CLEARING_WHY,
  LEFT_STANDING,
  canBeClearing,
  byLeftStandingThenName,
  clearingItemNoun,
  describeClearing,
  toClearingStanding,
  type ClearingStanding,
} from "@/lib/domain/clearing-accounts";

const money = (m: number) => `$${(m / 100).toFixed(2)}`;

function standing(over: Partial<ClearingStanding> = {}): ClearingStanding {
  return {
    accountId: "a1",
    balanceMinor: 175_000,
    lastMovementDate: "2025-11-28",
    openCount: 14,
    openOldestDate: "2025-11-19",
    openMinor: 175_000,
    ...over,
  };
}

describe("constants and wording", () => {
  it("has the agreed thresholds and sentences", () => {
    expect(CLEARING_IDLE_DAYS).toBe(60);
    expect(CLEARING_ITEM_DAYS).toBe(90);
    expect(LEFT_STANDING).toBe("Left standing");
    expect(CLEARING_FIFO_NOTE).toBe(
      "The oldest items are found first in, first out: each amount out clears the oldest amount in that is still open.",
    );
    expect(CLEARING_WHY).toBe(
      "A clearing account should empty: money received waits there until it is banked, wages until they are paid. A balance left standing is either money not yet banked or something counted twice.",
    );
    expect(CLEARING_FORM_HELP).toBe(
      "It should empty: money received waits here until it is banked, wages until they are paid.",
    );
  });
});

describe("describeClearing", () => {
  it("flags receipts left near the end of a year, eight months on", () => {
    const v = describeClearing(standing(), "2026-07-31", "receipts", money);
    expect(v.leftStanding).toBe(true);
    expect(v.composition).toBe("$1750.00 across 14 receipts, oldest 11/19/2025");
    expect(v.idle).toBe("No movement for 245 days, since 11/28/2025");
    expect(v.idleDays).toBe(245);
    expect(v.oldestDays).toBe(254);
  });

  it("does not flag a recent balance but still describes it", () => {
    const v = describeClearing(
      standing({ lastMovementDate: "2026-01-30", openOldestDate: "2026-01-21", openCount: 3, openMinor: 5_000, balanceMinor: 5_000 }),
      "2026-03-01",
      "receipts",
      money,
    );
    expect(v.idleDays).toBe(30);
    expect(v.oldestDays).toBe(39);
    expect(v.leftStanding).toBe(false);
    expect(v.composition).toBe("$50.00 across 3 receipts, oldest 01/21/2026");
  });

  it("uses strictly more than for the idle limit", () => {
    // keep the oldest item young so only idleness decides
    const idle = (days: number) => {
      const asOf = new Date(Date.UTC(2026, 0, 1) + days * 86_400_000).toISOString().slice(0, 10);
      return describeClearing(standing({ lastMovementDate: "2026-01-01", openOldestDate: asOf }), asOf, "entries", money);
    };
    expect(idle(60).idleDays).toBe(60);
    expect(idle(60).leftStanding).toBe(false);
    expect(idle(61).leftStanding).toBe(true);
  });

  it("uses strictly more than for the oldest item limit", () => {
    const oldest = (days: number) => {
      const asOf = new Date(Date.UTC(2026, 0, 1) + days * 86_400_000).toISOString().slice(0, 10);
      return describeClearing(standing({ lastMovementDate: asOf, openOldestDate: "2026-01-01" }), asOf, "entries", money);
    };
    expect(oldest(90).leftStanding).toBe(false);
    expect(oldest(91).leftStanding).toBe(true);
  });

  it("is never left standing at a zero balance, and has no composition", () => {
    const v = describeClearing(
      standing({ balanceMinor: 0, openCount: 0, openOldestDate: null, openMinor: 0 }),
      "2027-01-01",
      "receipts",
      money,
    );
    expect(v.leftStanding).toBe(false);
    expect(v.composition).toBeNull();
    expect(v.oldestDays).toBeNull();
    expect(v.idle).not.toBeNull();
  });

  it("has no idle text when there has been no movement", () => {
    const v = describeClearing(standing({ lastMovementDate: null }), "2026-02-01", "receipts", money);
    expect(v.idle).toBeNull();
    expect(v.idleDays).toBeNull();
    // A balance with no movement to measure is never read as healthy.
    expect(v.leftStanding).toBe(true);
  });

  it("says receipts or entries, singular and plural", () => {
    const one = standing({ openCount: 1 });
    const two = standing({ openCount: 2 });
    expect(describeClearing(one, "2026-01-05", "receipts", money).composition).toContain("across 1 receipt,");
    expect(describeClearing(two, "2026-01-05", "receipts", money).composition).toContain("across 2 receipts,");
    expect(describeClearing(one, "2026-01-05", "entries", money).composition).toContain("across 1 entry,");
    expect(describeClearing(two, "2026-01-05", "entries", money).composition).toContain("across 2 entries,");
  });

  it("says 1 day in the singular", () => {
    const v = describeClearing(standing({ lastMovementDate: "2026-01-04" }), "2026-01-05", "receipts", money);
    expect(v.idle).toBe("No movement for 1 day, since 01/04/2026");
  });

  it("never looks healthy when a date does not parse", () => {
    const badIdle = describeClearing(standing({ lastMovementDate: "nonsense" }), "2026-01-05", "receipts", money);
    expect(badIdle.idleDays).toBeNull();
    expect(badIdle.idle).toBeNull();
    expect(badIdle.leftStanding).toBe(true);
    const badOldest = describeClearing(standing({ openOldestDate: "nonsense" }), "2026-01-05", "receipts", money);
    expect(badOldest.oldestDays).toBeNull();
    expect(badOldest.leftStanding).toBe(true);
    const badAsOf = describeClearing(standing(), "nonsense", "receipts", money);
    expect(badAsOf.leftStanding).toBe(true);
  });

  it("treats a negative (credit) balance as a balance", () => {
    const v = describeClearing(standing({ balanceMinor: -9_000, openMinor: 9_000 }), "2026-08-31", "entries", money);
    expect(v.leftStanding).toBe(true);
    expect(v.composition).toContain("$90.00 across 14 entries");
  });
});

describe("clearingItemNoun", () => {
  it("is receipts only for undeposited funds", () => {
    expect(clearingItemNoun("undeposited_funds")).toBe("receipts");
    expect(clearingItemNoun("payroll_liabilities")).toBe("entries");
    expect(clearingItemNoun(null)).toBe("entries");
    expect(clearingItemNoun(undefined)).toBe("entries");
  });
});

describe("toClearingStanding", () => {
  it("maps numbers and dates", () => {
    expect(
      toClearingStanding({
        account_id: "x",
        balance_minor: 100,
        last_movement_date: "2026-01-02",
        open_count: 2,
        open_oldest_date: "2026-01-01",
        open_minor: 100,
      }),
    ).toEqual({ accountId: "x", balanceMinor: 100, lastMovementDate: "2026-01-02", openCount: 2, openOldestDate: "2026-01-01", openMinor: 100 });
  });

  it("is null-safe and reads numeric strings", () => {
    expect(
      toClearingStanding({
        account_id: "x",
        balance_minor: "-250",
        last_movement_date: null,
        open_count: "3",
        open_oldest_date: null,
        open_minor: "250",
      }),
    ).toEqual({ accountId: "x", balanceMinor: -250, lastMovementDate: null, openCount: 3, openOldestDate: null, openMinor: 250 });
    const empty = toClearingStanding({ account_id: "y" });
    expect(empty.balanceMinor).toBe(0);
    expect(empty.openCount).toBe(0);
    expect(empty.openMinor).toBe(0);
    expect(empty.lastMovementDate).toBeNull();
  });
});

describe("byLeftStandingThenName", () => {
  it("puts left standing first, then names in order", () => {
    const rows = [
      { leftStanding: false, name: "Alpha" },
      { leftStanding: true, name: "Zulu" },
      { leftStanding: true, name: "Bravo" },
      { leftStanding: false, name: "Charlie" },
    ];
    expect([...rows].sort(byLeftStandingThenName).map((r) => r.name)).toEqual(["Bravo", "Zulu", "Alpha", "Charlie"]);
  });
});

describe("the form's part stays out of every page", () => {
  it("is read by the shared form schemas from a module that imports nothing", () => {
    const lean = readFileSync(join(__dirname, "../../lib/domain/clearing-account-type.ts"), "utf8");
    expect(lean.split("\n").filter((l) => /^\s*import\s/.test(l))).toEqual([]);
    const schemas = readFileSync(join(__dirname, "../../lib/domain/schemas.ts"), "utf8");
    expect(schemas).toMatch(/from "\.\/clearing-account-type"/);
    expect(schemas).not.toMatch(/from "\.\/(clearing-accounts|bank-standing|report-presets)"/);
  });
});

describe("module is lean", () => {
  it("imports nothing from React, the database or services", () => {
    const src = readFileSync(join(__dirname, "../../lib/domain/clearing-accounts.ts"), "utf8");
    const imports = src.split("\n").filter((l) => /^\s*import\s/.test(l) && !/^\s*import\s+type\s/.test(l));
    for (const l of imports) {
      expect(l).not.toMatch(/from\s+["'](react|react-dom|@\/lib\/db|@\/lib\/services)[^"']*["']/);
    }
  });
});

describe("canBeClearing", () => {
  it("is true only for a current asset and a current liability", () => {
    expect(canBeClearing("current_asset")).toBe(true);
    expect(canBeClearing("current_liability")).toBe(true);
    for (const t of ["bank", "expense", "income", "equity", "fixed_asset", "accounts_payable", "credit_card", ""]) {
      expect(canBeClearing(t)).toBe(false);
    }
    expect(canBeClearing(undefined)).toBe(false);
  });
});

describe("Chart of Accounts form", () => {
  const src = readFileSync(join(__dirname, "../../app/(app)/accounts/AccountsClient.tsx"), "utf8");
  it("offers the clearing tick beside Contra, only where the type allows, and tags the row", () => {
    expect(src).toContain(`name="is_clearing"`);
    expect(src).toContain(`label="Clearing account"`);
    expect(src).toContain("tooltip={CLEARING_FORM_HELP}");
    expect(src).toContain("canBeClearing(watchedType)");
    expect(src).toContain("is_clearing: row.is_clearing");
    expect(src).toContain(`<Tag>Clearing</Tag>`);
  });
});

describe("Chart of Accounts save", () => {
  it("sends the tick explicitly, false when the type cannot clear", () => {
    const src = readFileSync(join(__dirname, "../../app/(app)/accounts/AccountsClient.tsx"), "utf8");
    expect(src).toContain("is_clearing: canBeClearing(fields.account_type)");
  });
});
