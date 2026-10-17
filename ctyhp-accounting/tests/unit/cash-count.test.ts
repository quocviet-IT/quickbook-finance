import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";
import {
  COUNTS_DRAWER_BODY,
  COUNTS_MIN_WIDTH,
  COUNT_BY_FLOOR,
  COUNT_FIXED_WIDTHS,
} from "@/components/cash/count-columns";
import {
  CASH_COUNT_AMBER_DAYS,
  cashCountMessage,
  cashVariance,
  countDateProblem,
  describeCashStanding,
  lastCountedLabel,
  parseCountedAmount,
  toCashCountResult,
  toCashCountRow,
  toCashStanding,
  varianceView,
  type CashStanding,
} from "@/lib/domain/cash-count";
import { formatMoney } from "@/lib/format";

const money = (minor: number) => formatMoney(minor, "USD", 2);
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function standing(over: Partial<CashStanding> = {}): CashStanding {
  return {
    accountId: "a1",
    accountCode: "1000",
    accountName: "Cash on Hand",
    balanceMinor: 125000,
    lastCountedOn: null,
    countedMinor: null,
    differenceMinor: null,
    daysSince: null,
    ...over,
  };
}

describe("the variance of a count", () => {
  it("is counted minus book: below zero is a shortage", () => {
    expect(cashVariance(9000, 10000)).toBe(-1000);
    expect(cashVariance(10500, 10000)).toBe(500);
    expect(cashVariance(10000, 10000)).toBe(0);
  });

  it("reads as short, over or no difference, live as the amount is typed", () => {
    expect(varianceView(-1000, money)).toEqual({ kind: "short", text: "Short by $10.00" });
    expect(varianceView(500, money)).toEqual({ kind: "over", text: "Over by $5.00" });
    expect(varianceView(0, money)).toEqual({ kind: "none", text: "No difference" });
  });
});

describe("the Balance Sheet line of a cash account", () => {
  it("says when it was last counted, in the sentence the design gives", () => {
    const view = describeCashStanding(
      standing({ lastCountedOn: "2026-08-03", countedMinor: 125000 }),
      "2026-09-30",
      money,
    );
    expect(view.text).toBe("Cash on Hand: last counted 08/03/2026 ($1,250.00). Count it again.");
    expect(view.tone).toBe("positive");
  });

  it("turns amber after 90 days and not before", () => {
    const last = { lastCountedOn: "2026-01-01", countedMinor: 1 };
    // 2026-01-01 + 90 days = 2026-04-01
    expect(CASH_COUNT_AMBER_DAYS).toBe(90);
    expect(describeCashStanding(standing(last), "2026-04-01", money).tone).toBe("positive");
    expect(describeCashStanding(standing(last), "2026-04-02", money).tone).toBe("warning");
  });

  it("measures the age to the report date, not to today", () => {
    const last = { lastCountedOn: "2020-01-01", countedMinor: 1 };
    expect(describeCashStanding(standing(last), "2020-02-01", money).tone).toBe("positive");
  });

  it("says never counted with the balance, and is amber when it holds one", () => {
    const view = describeCashStanding(standing(), "2026-09-30", money);
    expect(view.text).toBe("Cash on Hand: never counted · $1,250.00");
    expect(view.tone).toBe("warning");
    expect(view.overdue).toBe(true);
  });

  it("is not amber when it was never counted and holds nothing", () => {
    const view = describeCashStanding(standing({ balanceMinor: 0 }), "2026-09-30", money);
    expect(view.text).toBe("Cash on Hand: never counted · $0.00");
    expect(view.tone).toBe("neutral");
    expect(view.overdue).toBe(false);
  });

  it("never reads a date that does not parse as healthy", () => {
    expect(describeCashStanding(standing({ lastCountedOn: "soon", countedMinor: 1 }), "2026-09-30", money).tone).toBe("warning");
  });
});

describe("the Chart of Accounts line", () => {
  it("says last counted with the date, or never counted", () => {
    expect(lastCountedLabel("2026-08-03")).toBe("Last counted 08/03/2026");
    expect(lastCountedLabel(null)).toBe("Never counted");
  });
});

describe("the typed amount", () => {
  it("reads whole and decimal amounts, with a dollar sign and thousands commas", () => {
    expect(parseCountedAmount("1250", 2)).toEqual({ ok: true, minor: 125000 });
    expect(parseCountedAmount("1,250.5", 2)).toEqual({ ok: true, minor: 125050 });
    expect(parseCountedAmount(" $1,250.00 ", 2)).toEqual({ ok: true, minor: 125000 });
    expect(parseCountedAmount("0", 2)).toEqual({ ok: true, minor: 0 });
    expect(parseCountedAmount("1,250", 2)).toEqual({ ok: true, minor: 125000 });
  });

  it("never turns an empty or unreadable value into zero", () => {
    for (const raw of ["", "   ", "abc", "12abc", "1.2.3", "1,25", "12.345", "$", "--5"]) {
      const parsed = parseCountedAmount(raw, 2);
      expect(parsed.ok, raw).toBe(false);
    }
    expect(parseCountedAmount("", 2)).toEqual({ ok: false, error: "Enter the amount counted" });
  });

  it("refuses a negative amount", () => {
    expect(parseCountedAmount("-5", 2)).toEqual({ ok: false, error: "The amount counted cannot be negative" });
    expect(parseCountedAmount("(5.00)", 2).ok).toBe(false);
  });

  it("follows the currency's decimal places", () => {
    expect(parseCountedAmount("500", 0)).toEqual({ ok: true, minor: 500 });
    expect(parseCountedAmount("500.5", 0).ok).toBe(false);
  });
});

describe("the date of the count", () => {
  it("is today at most", () => {
    expect(countDateProblem("2026-10-17", "2026-10-17")).toBeNull();
    expect(countDateProblem("2026-10-16", "2026-10-17")).toBeNull();
    expect(countDateProblem("2026-10-18", "2026-10-17")).toBe("A cash count cannot be dated after today");
    expect(countDateProblem(null, "2026-10-17")).toBe("Enter the date of the count");
  });
});

describe("the message after a count", () => {
  const base = { cashCountId: "c1", approvalRequestId: null, bookMinor: 10000 };

  it("names the entry for a shortage and for an overage", () => {
    const short = toCashCountResult({
      cash_count_id: "c1",
      status: "posted",
      journal_entry_id: "e1",
      book_minor: 10000,
      difference_minor: -1000,
    });
    expect(cashCountMessage(short, "JE-000123", money)).toBe("Count recorded. Entry JE-000123 posts the shortage of $10.00.");
    const over = { ...short, differenceMinor: 500 };
    expect(cashCountMessage(over, "JE-000124", money)).toBe("Count recorded. Entry JE-000124 posts the overage of $5.00.");
  });

  it("says there was no difference", () => {
    const none = { ...base, status: "posted" as const, journalEntryId: null, differenceMinor: 0 };
    expect(cashCountMessage(none, null, money)).toBe("No difference; the count is recorded.");
  });

  it("says a count waits for approval", () => {
    const pending = {
      ...base,
      status: "pending_approval" as const,
      journalEntryId: null,
      approvalRequestId: "r1",
      differenceMinor: -2500,
    };
    expect(cashCountMessage(pending, null, money)).toBe("Count saved. The shortage of $25.00 waits for approval before it posts.");
  });
});

describe("rows from the database", () => {
  it("maps a standing row, bigint as string, nulls kept", () => {
    expect(
      toCashStanding({
        account_id: "a1",
        account_code: "1000",
        account_name: "Cash on Hand",
        balance_minor: "125000",
        last_counted_on: null,
        counted_minor: null,
        difference_minor: null,
        days_since: null,
      }),
    ).toEqual(standing());
  });

  it("maps a count with its entry number and name", () => {
    const row = toCashCountRow(
      {
        id: "c1",
        counted_on: "2026-08-03",
        counted_minor: "100",
        book_minor: 120,
        difference_minor: "-20",
        status: "posted",
        journal_entry_id: "e1",
        created_by: "u1",
      },
      new Map([["e1", "JE-000001"]]),
      new Map([["u1", "Pat Example"]]),
    );
    expect(row).toMatchObject({ differenceMinor: -20, entryNumber: "JE-000001", byName: "Pat Example", status: "posted" });
  });
});

describe("the counts table", () => {
  it("fits the drawer's body and the 1280 box", () => {
    const fixed = COUNT_FIXED_WIDTHS.reduce((sum, w) => sum + w, 0);
    expect(fitsBox(fixed, COUNT_BY_FLOOR, COUNTS_DRAWER_BODY)).toBe(true);
    expect(fitsBox(fixed, COUNT_BY_FLOOR, TABLE_BOX_AT_1280)).toBe(true);
  });

  it("holds its measured width on a phone, as the stylesheet says", () => {
    const css = read("components/cash/count-cash.module.css");
    expect(css).toContain(`min-width: ${COUNTS_MIN_WIDTH}px`);
    expect(css).toMatch(/max-width: 640px/);
    expect(read("components/cash/CashCountsDrawer.tsx")).toContain("styles.countsTable");
  });
});

describe("the cash count screens", () => {
  it("import no PDF module and no antd Table", () => {
    for (const path of [
      "lib/domain/cash-count.ts",
      "components/cash/CountCashDialog.tsx",
      "components/cash/CashCountsDrawer.tsx",
    ]) {
      const source = read(path);
      expect(source, path).not.toMatch(/from\s+["'][^"']*pdf-statement/);
      expect(source, path).not.toMatch(/import\s*\{[^}]*\bTable\b[^}]*\}\s*from\s*["']antd["']/);
    }
  });

  it("show the Chart of Accounts and the Balance Sheet buttons by their names", () => {
    expect(read("components/cash/CountCashDialog.tsx")).toContain("Record count");
    expect(read("app/(app)/accounts/AccountsClient.tsx")).toContain("Count cash");
    expect(read("app/(app)/reports/BalanceSheetBanksPanel.tsx")).toContain("Count cash");
  });

  it("list the new entity in the dashboard's recent activity", () => {
    // The activity entities moved to one shared map with 2.15.
    expect(read("lib/domain/audit-entities.ts")).toContain("acc_cash_count:");
  });
});
