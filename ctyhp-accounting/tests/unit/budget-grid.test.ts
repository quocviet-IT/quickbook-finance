import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  budgetRangeIsValid,
  buildMonthByMonth,
  budgetResultOf,
  dirtyMonths,
  GRID_WIDTHS,
  groupBudgetByMonth,
  hasBudget,
  monthLines,
  monthLabelOf,
  monthlyActualsByAccount,
  monthStartsBetween,
  percentOfBudget,
  plannedSummary,
  runBudgetSave,
  saveOutcomeMessage,
  seedFromActuals,
  spreadYear,
  yearTotal,
  type BudgetGridValues,
  type MonthToSave,
} from "@/lib/domain/budget-grid";
import type { BudgetAccountAmount, LedgerBalance } from "@/lib/domain/reports";

describe("% of Budget", () => {
  it("is actual over budget, to one decimal place", () => {
    expect(percentOfBudget(1_000_000, 900_000)).toBe(111.1);
    expect(percentOfBudget(150_000, 200_000)).toBe(75);
    expect(percentOfBudget(0, 50_000)).toBe(0);
    expect(percentOfBudget(2, 3)).toBe(66.7);
  });

  it("is null, shown as a dash, when nothing is budgeted", () => {
    expect(percentOfBudget(40_000, 0)).toBeNull();
    expect(percentOfBudget(0, 0)).toBeNull();
    expect(hasBudget(0)).toBe(false);
    expect(hasBudget(1)).toBe(true);
  });
});

describe("the range asked for", () => {
  it("accepts months inside a calendar fiscal year", () => {
    expect(budgetRangeIsValid(2026, 1, "2026-01-01", "2026-12-31")).toBe(true);
    expect(budgetRangeIsValid(2026, 1, "2026-03-01", "2026-03-31")).toBe(true);
    expect(budgetRangeIsValid(2026, 1, "2026-03-01", "2026-03-01")).toBe(true);
  });

  it("follows a fiscal year that starts mid-calendar", () => {
    expect(budgetRangeIsValid(2026, 7, "2026-07-01", "2027-06-30")).toBe(true);
    expect(budgetRangeIsValid(2026, 7, "2026-01-01", "2026-06-30")).toBe(false);
  });

  it("refuses a range outside the year, backwards, off a month start, or a bad year", () => {
    expect(budgetRangeIsValid(2026, 1, "2025-12-01", "2026-03-31")).toBe(false);
    expect(budgetRangeIsValid(2026, 1, "2026-01-01", "2027-01-31")).toBe(false);
    expect(budgetRangeIsValid(2026, 1, "2026-05-01", "2026-04-30")).toBe(false);
    expect(budgetRangeIsValid(2026, 1, "2026-03-15", "2026-03-31")).toBe(false);
    expect(budgetRangeIsValid(2026, 1, "2026-03-01", "2026-03-15")).toBe(false);
    expect(budgetRangeIsValid(1999, 1, "1999-01-01", "1999-12-31")).toBe(false);
  });
});

describe("spreading a year", () => {
  it("splits evenly with no remainder", () => {
    expect(spreadYear(120_000)).toEqual(new Array(12).fill(10_000));
  });

  it("puts the rounding remainder in the first month and keeps the total", () => {
    const spread = spreadYear(100_000);
    expect(spread[0]).toBe(8_337); // 8,333 each, plus the 4 left over
    expect(spread.slice(1)).toEqual(new Array(11).fill(8_333));
    expect(yearTotal(spread)).toBe(100_000);
  });

  it("handles a year smaller than twelve minor units, and zero", () => {
    expect(spreadYear(5)).toEqual([5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spreadYear(0)).toEqual(new Array(12).fill(0));
  });
});

describe("starting from actuals", () => {
  const actuals: BudgetGridValues = {
    sales: [100_001, 200_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    rent: new Array(12).fill(50_000),
    idle: new Array(12).fill(0),
    refund: [-500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };

  it("copies the actuals when the uplift is 0", () => {
    const seeded = seedFromActuals(actuals, 0);
    expect(seeded.sales).toEqual(actuals.sales);
    expect(seeded.rent).toEqual(actuals.rent);
  });

  it("raises each month by the uplift and rounds to a minor unit", () => {
    const seeded = seedFromActuals(actuals, 3);
    expect(seeded.sales[0]).toBe(103_001); // 100,001 × 1.03 = 103,001.03
    expect(seeded.sales[1]).toBe(206_000);
    expect(seeded.rent[0]).toBe(51_500);
    expect(seedFromActuals({ x: [5, ...new Array(11).fill(0)] }, 10).x[0]).toBe(6); // 5.5 rounds away from zero
  });

  it("applies a negative uplift", () => {
    expect(seedFromActuals(actuals, -10).rent[0]).toBe(45_000);
  });

  it("leaves out an account with nothing to seed, and never seeds a negative", () => {
    const seeded = seedFromActuals(actuals, 0);
    expect(seeded.idle).toBeUndefined();
    expect(seeded.refund).toBeUndefined();
  });
});

describe("which months changed", () => {
  const baseline: BudgetGridValues = {
    sales: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
    rent: new Array(12).fill(5),
  };
  const copy = (values: BudgetGridValues): BudgetGridValues =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, [...v]]));

  it("finds nothing when nothing changed", () => {
    expect(dirtyMonths(baseline, copy(baseline))).toEqual([]);
  });

  it("finds only the months with a changed cell, in order", () => {
    const next = copy(baseline);
    next.rent[7] = 6;
    next.sales[2] = 31;
    expect(dirtyMonths(baseline, next)).toEqual([2, 7]);
  });

  it("counts an account added with figures, and an account emptied, and ignores one added with zeros", () => {
    const added = copy(baseline);
    added.travel = [0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(dirtyMonths(baseline, added)).toEqual([2]);
    const zeroRow = copy(baseline);
    zeroRow.travel = new Array(12).fill(0);
    expect(dirtyMonths(baseline, zeroRow)).toEqual([]);
    const emptied = copy(baseline);
    emptied.rent = new Array(12).fill(0);
    expect(dirtyMonths(baseline, emptied)).toEqual(new Array(12).fill(0).map((_, i) => i));
  });

  it("sends only the non-zero lines of a month", () => {
    const next = copy(baseline);
    next.rent[0] = 0;
    next.zero = new Array(12).fill(0);
    expect(monthLines(next, 0)).toEqual([{ account_id: "sales", amount_minor: 10 }]);
    expect(monthLines(next, 1)).toEqual([
      { account_id: "sales", amount_minor: 20 },
      { account_id: "rent", amount_minor: 5 },
    ]);
  });
});

describe("the planned summary", () => {
  it("adds income and other income, adds the rest as spending, and gives the result", () => {
    const accounts = [
      { accountId: "sales", accountType: "income" as const },
      { accountId: "interest", accountType: "other_income" as const },
      { accountId: "cogs", accountType: "cost_of_goods_sold" as const },
      { accountId: "rent", accountType: "expense" as const },
      { accountId: "fees", accountType: "other_expense" as const },
    ];
    const values: BudgetGridValues = {
      sales: new Array(12).fill(1_000),
      interest: spreadYear(1_200),
      cogs: new Array(12).fill(300),
      rent: new Array(12).fill(100),
      fees: spreadYear(600),
    };
    expect(plannedSummary(accounts, values)).toEqual({ income: 13_200, spending: 5_400, result: 7_800 });
  });
});

describe("saving the changed months", () => {
  const months: MonthToSave[] = [
    { index: 0, label: "Jan 2026" },
    { index: 3, label: "Apr 2026" },
    { index: 5, label: "Jun 2026" },
    { index: 9, label: "Oct 2026" },
  ];

  it("saves every month, one at a time, in order", async () => {
    const seen: string[] = [];
    let running = 0;
    let overlap = false;
    const outcome = await runBudgetSave(months, async (m) => {
      running += 1;
      if (running > 1) overlap = true;
      await Promise.resolve();
      seen.push(m.label);
      running -= 1;
      return { ok: true };
    });
    expect(seen).toEqual(["Jan 2026", "Apr 2026", "Jun 2026", "Oct 2026"]);
    expect(overlap).toBe(false);
    expect(outcome).toEqual({ saved: seen, failed: null, notSaved: [] });
    expect(saveOutcomeMessage(outcome)).toBe("Budget saved for Jan 2026, Apr 2026, Jun 2026, Oct 2026.");
  });

  it("stops at the first failure and reports what was and was not saved", async () => {
    const tried: string[] = [];
    const outcome = await runBudgetSave(months, async (m) => {
      tried.push(m.label);
      return m.index === 5 ? { ok: false, error: "Period is closed" } : { ok: true };
    });
    expect(tried).toEqual(["Jan 2026", "Apr 2026", "Jun 2026"]); // Oct is never attempted
    expect(outcome).toEqual({
      saved: ["Jan 2026", "Apr 2026"],
      failed: { label: "Jun 2026", error: "Period is closed" },
      notSaved: ["Jun 2026", "Oct 2026"],
    });
    const text = saveOutcomeMessage(outcome);
    expect(text).toContain("Saved: Jan 2026, Apr 2026");
    expect(text).toContain("Not saved: Jun 2026, Oct 2026");
    expect(text).toContain("Period is closed");
  });

  it("treats a save that throws as a failure", async () => {
    const outcome = await runBudgetSave(months, async (m) => {
      if (m.index === 0) throw new Error("network down");
      return { ok: true };
    });
    expect(outcome.saved).toEqual([]);
    expect(outcome.failed).toEqual({ label: "Jan 2026", error: "network down" });
    expect(outcome.notSaved).toHaveLength(4);
    expect(saveOutcomeMessage(outcome)).toContain("Saved: none");
  });

  it("is safe to run again: a retry sends the unsaved months and the same figures", async () => {
    let failOnce = true;
    const calls: string[] = [];
    const save = async (m: MonthToSave) => {
      calls.push(m.label);
      if (m.index === 5 && failOnce) {
        failOnce = false;
        return { ok: false, error: "timeout" };
      }
      return { ok: true };
    };
    const first = await runBudgetSave(months, save);
    const retry = await runBudgetSave(
      months.filter((m) => first.notSaved.includes(m.label)),
      save,
    );
    expect(retry.failed).toBeNull();
    expect(calls).toEqual(["Jan 2026", "Apr 2026", "Jun 2026", "Jun 2026", "Oct 2026"]);
  });

  it("has nothing to say when there was nothing to save", async () => {
    expect(saveOutcomeMessage(await runBudgetSave([], async () => ({ ok: true })))).toBe("Nothing to save.");
  });
});

describe("month by month", () => {
  const row = (
    accountId: string,
    accountType: LedgerBalance["accountType"],
    debitBase: number,
    creditBase: number,
  ): LedgerBalance => ({ accountId, accountCode: accountId, name: accountId, accountType, debitBase, creditBase });
  const budget = (accountId: string, accountType: BudgetAccountAmount["accountType"], amountMinor: number): BudgetAccountAmount => ({
    accountId,
    accountCode: accountId,
    name: accountId,
    accountType,
    amountMinor,
  });

  it("lists the months from the one holding `from` through the one holding `to`", () => {
    expect(monthStartsBetween("2026-01-01", "2026-03-31")).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(monthStartsBetween("2025-11-01", "2026-02-28")).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
    expect(monthStartsBetween("2026-05-01", "2026-05-31")).toEqual(["2026-05-01"]);
    expect(monthLabelOf("2026-03-01")).toBe("Mar 2026");
  });

  it("sets income less expenses against the budgeted income less expenses", () => {
    const months = ["2026-01-01", "2026-02-01", "2026-03-01"].map((start) => ({ start, label: monthLabelOf(start) }));
    const actual = new Map<string, LedgerBalance[]>([
      ["2026-01", [row("sales", "income", 0, 1_000), row("rent", "expense", 400, 0)]],
      // February has nothing posted.
      ["2026-03", [row("sales", "income", 0, 500), row("fees", "other_expense", 700, 0), row("interest", "other_income", 0, 50)]],
    ]);
    const planned = new Map<string, BudgetAccountAmount[]>([
      ["2026-01-01", [budget("sales", "income", 900), budget("rent", "expense", 400)]],
      ["2026-02-01", [budget("sales", "income", 900), budget("cogs", "cost_of_goods_sold", 100)]],
      // March has no budget at all.
    ]);
    const result = buildMonthByMonth(months, actual, planned);
    expect(result.map((m) => [m.label, m.actual, m.budget, m.variance])).toEqual([
      ["Jan 2026", 600, 500, 100],
      ["Feb 2026", 0, 800, -800],
      ["Mar 2026", -150, 0, -150],
    ]);
    expect(budgetResultOf(planned.get("2026-02-01")!)).toBe(800);
  });

  it("reads each account's natural monthly actual for seeding, 0 where nothing posted", () => {
    const months = ["2026-01-01", "2026-02-01"].map((start) => ({ start, label: monthLabelOf(start) }));
    const actual = new Map<string, LedgerBalance[]>([
      ["2026-01", [row("sales", "income", 0, 1_000), row("rent", "expense", 400, 0)]],
      ["2026-02", [row("rent", "expense", 450, 0)]],
    ]);
    expect(monthlyActualsByAccount(months, actual)).toEqual({ sales: [1_000, 0], rent: [400, 450] });
  });
});

describe("budget rows grouped by month", () => {
  const accounts = [
    { accountId: "rent", accountCode: "6100", name: "Rent", accountType: "expense" as const },
    { accountId: "sales", accountCode: "4000", name: "Sales", accountType: "income" as const },
  ];
  const starts = ["2026-01-01", "2026-02-01", "2026-03-01"];

  it("gives every requested month every account in code order, 0 where nothing is budgeted", () => {
    const grouped = groupBudgetByMonth(
      [
        { account_id: "sales", period_start: "2026-01-01", amount_minor: 900 },
        { account_id: "rent", period_start: "2026-03-01", amount_minor: 200 },
      ],
      accounts,
      starts,
    );
    expect([...grouped.keys()]).toEqual(starts);
    expect(grouped.get("2026-01-01")?.map((r) => [r.accountId, r.amountMinor])).toEqual([["sales", 900], ["rent", 0]]);
    expect(grouped.get("2026-02-01")?.every((r) => r.amountMinor === 0)).toBe(true);
    expect(grouped.get("2026-03-01")?.map((r) => [r.accountId, r.amountMinor])).toEqual([["sales", 0], ["rent", 200]]);
    expect(grouped.get("2026-01-01")?.[0]).toMatchObject({ accountCode: "4000", name: "Sales", accountType: "income" });
  });

  it("ignores months outside those asked for and accounts it does not know", () => {
    const grouped = groupBudgetByMonth(
      [
        { account_id: "sales", period_start: "2025-12-01", amount_minor: 5 },
        { account_id: "ghost", period_start: "2026-01-01", amount_minor: 7 },
      ],
      accounts,
      ["2026-01-01"],
    );
    expect([...grouped.keys()]).toEqual(["2026-01-01"]);
    expect(grouped.get("2026-01-01")?.every((r) => r.amountMinor === 0)).toBe(true);
  });

  it("is all zeros when the year has no budget at all, and the months then give a 0 budgeted result", () => {
    const grouped = groupBudgetByMonth([], accounts, starts);
    expect(budgetResultOf(grouped.get("2026-02-01")!)).toBe(0);
  });

  it("feeds the month-by-month results the same as the range sum", () => {
    const grouped = groupBudgetByMonth(
      [
        { account_id: "sales", period_start: "2026-01-01", amount_minor: 900 },
        { account_id: "rent", period_start: "2026-01-01", amount_minor: 400 },
        { account_id: "sales", period_start: "2026-02-01", amount_minor: 100 },
      ],
      accounts,
      starts,
    );
    const slots = starts.map((start) => ({ start, label: monthLabelOf(start) }));
    expect(buildMonthByMonth(slots, new Map(), grouped).map((m) => m.budget)).toEqual([500, 100, 0]);
  });
});

describe("the budget grid fits a 1440px window", () => {
  const drawer = Math.min(1500, 0.96 * 1440); // the drawer's own width
  const available = drawer - 48 /* body padding */ - 15; /* a vertical scrollbar */

  it("has Account, twelve months and Year that add up to no more than the room the drawer leaves", () => {
    expect(GRID_WIDTHS.account + 12 * GRID_WIDTHS.month + GRID_WIDTHS.year).toBe(GRID_WIDTHS.total);
    expect(GRID_WIDTHS.total).toBeLessThanOrEqual(available);
  });

  it("gives an amount like 1000000.00 room at 12px tabular numerals (about 7px a character)", () => {
    expect("1000000.00".length * 7 + 2 * 4 /* input padding */ + 2 * 2 /* cell padding */).toBeLessThanOrEqual(GRID_WIDTHS.month);
    expect("10000000.00".length * 7 + 12).toBeLessThanOrEqual(GRID_WIDTHS.year);
  });

  it("is laid out by the declared widths, with a sticky Account column that hides what passes under it", () => {
    const css = readFileSync(join(process.cwd(), "components/reports/budget-grid.module.css"), "utf8");
    expect(css).toMatch(/table-layout:\s*fixed/);
    expect(css).toMatch(/scroll-padding-left/);
    const account = css.match(/\.grid td\.account[^{]*\{[^}]*\}/)?.[0] ?? "";
    expect(account).toMatch(/position:\s*sticky/);
    expect(account).toMatch(/background:/);
    expect(account).toMatch(/border-right:/);
    const drawerSource = readFileSync(join(process.cwd(), "components/reports/BudgetEditorDrawer.tsx"), "utf8");
    expect(drawerSource).toMatch(/controls:\s*false/);
  });
});
