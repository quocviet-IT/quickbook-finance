import { describe, expect, it } from "vitest";
import type { LedgerBalance } from "@/lib/domain/reports";
import { buildProfitAndLoss } from "@/lib/domain/reports";
import { hasActivity, markPosted, monthEndBalances, monthMovement, sumLedgerRows } from "@/lib/domain/dashboard-home/series";

const row = (accountId: string, accountType: LedgerBalance["accountType"], debitBase: number, creditBase: number): LedgerBalance => ({
  accountId,
  accountCode: accountId,
  name: `Sample ${accountId}`,
  accountType,
  debitBase,
  creditBase,
});

const months = [
  { key: "2026-09", label: "Sep", year: 2026 },
  { key: "2026-10", label: "Oct", year: 2026 },
  { key: "2026-11", label: "Nov", year: 2026 },
];

describe("monthEndBalances", () => {
  const opening = [row("1010", "bank", 500_00, 100_00), row("1100", "accounts_receivable", 300_00, 0), row("2000", "accounts_payable", 0, 250_00)];
  const byMonth = new Map<string, LedgerBalance[]>([
    ["2026-09", [row("1010", "bank", 200_00, 50_00), row("1100", "accounts_receivable", 100_00, 300_00), row("2000", "accounts_payable", 250_00, 400_00)]],
    // October: nothing posted, so no key at all (getMonthlyLedgerBalances leaves it out).
    ["2026-11", [row("1010", "bank", 0, 75_00)]],
  ]);

  it("runs the bank balance from the opening, debit minus credit, and carries a quiet month", () => {
    // 400 opening, +150 in September, nothing in October, -75 in November.
    expect(monthEndBalances(opening, byMonth, months, ["bank"])).toEqual([550_00, 550_00, 475_00]);
  });

  it("keeps receivables debit positive", () => {
    // 300 opening, +100 - 300 in September.
    expect(monthEndBalances(opening, byMonth, months, ["accounts_receivable"])).toEqual([100_00, 100_00, 100_00]);
  });

  it("shows payables positive: credit minus debit", () => {
    // 250 owed, then 400 more billed and 250 paid in September.
    expect(monthEndBalances(opening, byMonth, months, ["accounts_payable"])).toEqual([400_00, 400_00, 400_00]);
  });

  it("starts from zero with no opening rows", () => {
    expect(monthEndBalances([], new Map(), months, ["bank"])).toEqual([0, 0, 0]);
  });
});

describe("monthMovement", () => {
  it("totals gross debits and credits of the account types per month, zero for a month with no key", () => {
    const byMonth = new Map<string, LedgerBalance[]>([
      ["2026-09", [row("1010", "bank", 200_00, 50_00), row("1020", "bank", 10_00, 5_00), row("2050", "credit_card", 70_00, 0)]],
      ["2026-11", [row("1010", "bank", 0, 75_00)]],
    ]);
    expect(monthMovement(byMonth, months, ["bank"])).toEqual({ debitMinor: [210_00, 0, 0], creditMinor: [55_00, 0, 75_00] });
  });
});

describe("markPosted", () => {
  it("marks a month not posted only when it starts after the last posted month and has no activity", () => {
    const byMonth = new Map<string, LedgerBalance[]>([["2026-09", [row("1010", "bank", 1, 0)]]]);
    expect(markPosted(months, "2026-09-30", byMonth).map((m) => [m.key, m.posted])).toEqual([
      ["2026-09", true],
      ["2026-10", false],
      ["2026-11", false],
    ]);
  });

  it("keeps a quiet month before the last posted entry as posted: its zero is real", () => {
    const byMonth = new Map<string, LedgerBalance[]>([["2026-11", [row("1010", "bank", 1, 0)]]]);
    expect(markPosted(months, "2026-11-02", byMonth).map((m) => m.posted)).toEqual([true, true, true]);
  });

  it("marks nothing posted when nothing is", () => {
    expect(markPosted(months, null, new Map()).map((m) => m.posted)).toEqual([false, false, false]);
    expect(markPosted(months, null, new Map())[0]).toEqual({ key: "2026-09", label: "Sep", year: 2026, posted: false });
  });
});

describe("sumLedgerRows", () => {
  it("adds whole months into a range that gives the Profit and Loss a range read would", () => {
    const september = [row("4000", "income", 0, 900_00), row("6100", "expense", 300_00, 0)];
    const october = [row("4000", "income", 10_00, 500_00), row("5000", "cost_of_goods_sold", 200_00, 0)];
    const summed = sumLedgerRows([september, undefined, october]);
    expect(summed.find((r) => r.accountId === "4000")).toMatchObject({ debitBase: 10_00, creditBase: 1400_00 });
    const pnl = buildProfitAndLoss(summed);
    // Income is credit positive in the Profit and Loss: 1,390; expenses are debit positive.
    expect(pnl.income.total).toBe(1390_00);
    expect(pnl.costOfGoodsSold.total + pnl.operatingExpenses.total).toBe(500_00);
    expect(pnl.netIncome).toBe(890_00);
    // The inputs are not changed.
    expect(september[0].creditBase).toBe(900_00);
  });

  it("tells a read with postings from one of all zeros", () => {
    expect(hasActivity([row("4000", "income", 0, 0), row("1010", "bank", 0, 0)])).toBe(false);
    expect(hasActivity([row("4000", "income", 0, 1)])).toBe(true);
  });
});
