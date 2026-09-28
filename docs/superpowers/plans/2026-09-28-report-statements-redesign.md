# Financial Statements Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay out Profit and Loss, Balance Sheet, Trial Balance, Budget vs Actual and Statement of Equity the way the client's prototype lays out a statement — on paper, with the prototype's toolbar and Compare list, nested accounts, ruled totals, and every figure a QuickZoom — without changing a single figure.

**Architecture:** Pure builders (`lib/domain/statement.ts`) turn the existing builders' output (`buildProfitAndLoss`, `buildBalanceSheet`, … in `lib/domain/reports.ts`) into a statement model of rows and cells; a plain HTML `StatementTable` renders it; `statement-columns.ts` turns the Compare choice into column dates; a QuickZoom reads the posted lines behind a figure (`lib/services/zoom.ts`) and `lib/domain/zoom.ts` proves they add up to it. `ReportsClient.tsx` is rewritten around these; a read-only live test holds the new rows to the builders on every real company.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Ant Design 6, Supabase (PostgREST), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-report-statements-redesign-design.md`.

## Global Constraints

- **Presentation only.** Every amount comes from `lib/domain/reports.ts` (`buildProfitAndLoss`, `buildBalanceSheet`, `buildTrialBalance`, `buildBudgetVsActual`, `buildStatementOfEquity`, `sumProfitAndLoss`, `netIncomeOf`) fed by the same reads as today (`getLedgerBalancesAction`, `getBudgetVsActualAction`, `getStatementOfEquityAction`). Section and statement totals are always the builders' own figures, never re-added. Anything added in the new code is a display subtotal, and a test holds it to a builder total.
- US English; base currency USD; the paper says "Accrual basis"; there is no basis choice (the *Cash movements only* filter is out of scope).
- Routes do not change: `/reports?report=pnl|balance|trial|budget|equity`.
- Keep: the Accountant / Management toggle and its charts (`ReportBody`), the budget editor drawer.
- No hex colour in any source file, comments included (`tests/unit/no-hardcoded-color.test.ts`); use `var(--ob-…)` tokens.
- No new file may contain `<Table` (Ant Design), including `<Table.Summary…>` (`tests/unit/table-adoption.test.ts`). `StatementTable` is a plain HTML `<table>`. Lists (the zoom sheet) use `DataTable`.
- A `page.tsx` never reads an Ant Design sub-component (`tests/unit/rsc-antd.test.ts`).
- Never write a real customer's name or figure into code, tests or docs (`tests/unit/customer-data.test.ts`).
- Every read of a table or set-returning RPC is paged past PostgREST's 1,000-row cap.
- Write any file containing a backslash with the Write/Edit tool, never a shell heredoc or `sed`.
- Commits: stage files by name (never `git add -A` / `git add .`), one-line subject, **no Co-Authored-By trailer**, message written with Bash `printf '%s\n' "<subject>" > <file>` (PowerShell adds a BOM) and committed with `git commit -F <file>`. `$SCRATCH` in the commit steps is the scratchpad directory your dispatch names; never write the message file inside the repository.
- Run commands from `ctyhp-accounting/`. Focused tests: `npx vitest run tests/unit/<file>.test.ts`.

---

### Task 1: Compare → column dates

**Files:**
- Create: `ctyhp-accounting/lib/domain/statement-columns.ts`
- Test: `ctyhp-accounting/tests/unit/statement-columns.test.ts`

**Interfaces:**
- Consumes: `fiscalYearForDate` (`@/lib/domain/fiscal`); `periodColumnLabel` (`@/lib/domain/period-label`); `previousMonthEnd`, `previousPeriodRange` (`@/lib/domain/reports`); `MAX_TREND_COLUMNS`, `monthEnd`, `monthlyColumns`, `quarterlyColumns`, `sameDayLastYear`, `trendColumnLimitMessage`, type `RangeColumn` (`@/lib/domain/report-periods`); `shortDate` (`@/lib/domain/report-presets`).
- Produces: `COMPARE_OPTIONS`; `type CompareMode = "none" | "prev" | "year" | "years" | "quarter" | "month"`; `interface StatementColumnSpec { key: string; label: string; sub: string; from: string | null; to: string; isTotal: boolean }`; `type ColumnPlan = { ok: true; columns: StatementColumnSpec[]; change: boolean } | { ok: false; message: string }`; `rangeColumns(mode, from, to, fiscalStartMonth): ColumnPlan`; `pointColumns(mode, asOf, columnsFrom, fiscalStartMonth): ColumnPlan`; `fiscalYearStartOf(date, fiscalStartMonth): string`; `rangeLabel(from, to): string`.

- [ ] **Step 1: Write the failing tests**

`ctyhp-accounting/tests/unit/statement-columns.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPARE_OPTIONS,
  fiscalYearStartOf,
  pointColumns,
  rangeColumns,
  rangeLabel,
  type ColumnPlan,
} from "@/lib/domain/statement-columns";

const columnsOf = (plan: ColumnPlan) => {
  if (!plan.ok) throw new Error(plan.message);
  return plan.columns.map((c) => ({ label: c.label, from: c.from, to: c.to, isTotal: c.isTotal }));
};

describe("the Compare list", () => {
  it("is the prototype's, in its order", () => {
    expect(COMPARE_OPTIONS.map((o) => o.label)).toEqual([
      "No comparison",
      "Previous period",
      "Previous year",
      "Column per year",
      "Column per quarter",
      "Column per month",
    ]);
  });
});

describe("rangeColumns (Profit and Loss)", () => {
  it("is one column for no comparison, named by its dates", () => {
    expect(columnsOf(rangeColumns("none", "2026-01-01", "2026-12-31", 1))).toEqual([
      { label: "2026", from: "2026-01-01", to: "2026-12-31", isTotal: false },
    ]);
    expect(rangeColumns("none", "2026-01-01", "2026-09-28", 1)).toMatchObject({
      ok: true,
      change: false,
      columns: [{ label: "Jan 1, 2026 – Sep 28, 2026" }],
    });
  });

  it("puts the previous period beside it, with a change pair", () => {
    const plan = rangeColumns("prev", "2026-01-01", "2026-03-31", 1);
    expect(plan).toMatchObject({ ok: true, change: true });
    expect(columnsOf(plan)).toEqual([
      { label: "Q1 2026", from: "2026-01-01", to: "2026-03-31", isTotal: false },
      { label: "Q4 2025", from: "2025-10-01", to: "2025-12-31", isTotal: false },
    ]);
  });

  it("puts the same dates a year earlier beside it, February 29 included", () => {
    expect(columnsOf(rangeColumns("year", "2024-02-01", "2024-02-29", 1))).toEqual([
      { label: "Feb 2024", from: "2024-02-01", to: "2024-02-29", isTotal: false },
      { label: "Feb 2023", from: "2023-02-01", to: "2023-02-28", isTotal: false },
    ]);
  });

  it("gives a column per month, clipped to the range, then a Total", () => {
    expect(columnsOf(rangeColumns("month", "2026-01-15", "2026-03-10", 1))).toEqual([
      { label: "Jan 15, 2026 – Jan 31, 2026", from: "2026-01-15", to: "2026-01-31", isTotal: false },
      { label: "Feb 2026", from: "2026-02-01", to: "2026-02-28", isTotal: false },
      { label: "Mar 1, 2026 – Mar 10, 2026", from: "2026-03-01", to: "2026-03-10", isTotal: false },
      { label: "Total", from: "2026-01-15", to: "2026-03-10", isTotal: true },
    ]);
  });

  it("puts a column's dates under a heading that names a period, and nothing under one that is already dates", () => {
    const plan = rangeColumns("month", "2026-01-15", "2026-03-10", 1);
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.columns.map((c) => c.sub)).toEqual([
      "",
      "Feb 1, 2026 – Feb 28, 2026",
      "",
      "Jan 15, 2026 – Mar 10, 2026",
    ]);
  });

  it("has no Total when there is only one column", () => {
    expect(columnsOf(rangeColumns("month", "2026-03-01", "2026-03-31", 1))).toEqual([
      { label: "Mar 2026", from: "2026-03-01", to: "2026-03-31", isTotal: false },
    ]);
  });

  it("gives a column per fiscal year, for a year starting in July", () => {
    expect(columnsOf(rangeColumns("years", "2024-07-01", "2026-09-28", 7))).toEqual([
      { label: "FY 2024–25", from: "2024-07-01", to: "2025-06-30", isTotal: false },
      { label: "FY 2025–26", from: "2025-07-01", to: "2026-06-30", isTotal: false },
      { label: "FY 2026–27", from: "2026-07-01", to: "2026-09-28", isTotal: false },
      { label: "Total", from: "2024-07-01", to: "2026-09-28", isTotal: true },
    ]);
  });

  it("refuses more columns than a reader can scan, and says what to do", () => {
    const plan = rangeColumns("month", "2020-01-01", "2026-12-31", 1);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain("monthly columns");
  });

  it("refuses a range that ends before it starts", () => {
    expect(rangeColumns("none", "2026-05-01", "2026-04-30", 1)).toEqual({
      ok: false,
      message: "The start date is after the end date.",
    });
  });
});

describe("pointColumns (Balance Sheet, Trial Balance)", () => {
  it("is one date for no comparison", () => {
    expect(columnsOf(pointColumns("none", "2026-09-28", "2026-01-01", 1))).toEqual([
      { label: "Sep 28, 2026", from: null, to: "2026-09-28", isTotal: false },
    ]);
  });

  it("compares with the end of the month before, leap years included", () => {
    expect(columnsOf(pointColumns("prev", "2024-03-10", "2024-01-01", 1))[1]).toEqual({
      label: "Feb 29, 2024",
      from: null,
      to: "2024-02-29",
      isTotal: false,
    });
  });

  it("compares with the same day a year earlier", () => {
    expect(columnsOf(pointColumns("year", "2024-02-29", "2024-01-01", 1))[1].to).toBe("2023-02-28");
  });

  it("gives a date per month end from Columns from, the last one As of itself", () => {
    const plan = pointColumns("month", "2026-03-15", "2026-01-01", 1);
    expect(columnsOf(plan)).toEqual([
      { label: "Jan 2026", from: null, to: "2026-01-31", isTotal: false },
      { label: "Feb 2026", from: null, to: "2026-02-28", isTotal: false },
      { label: "Mar 2026", from: null, to: "2026-03-15", isTotal: false },
    ]);
    if (plan.ok) expect(plan.columns[2].sub).toBe("As of Mar 15, 2026");
  });

  it("gives a date per quarter end and per fiscal year end", () => {
    expect(columnsOf(pointColumns("quarter", "2026-03-15", "2025-11-01", 1)).map((c) => [c.label, c.to])).toEqual([
      ["Q4 2025", "2025-12-31"],
      ["Q1 2026", "2026-03-15"],
    ]);
    expect(columnsOf(pointColumns("years", "2026-09-28", "2024-01-01", 1)).map((c) => [c.label, c.to])).toEqual([
      ["2024", "2024-12-31"],
      ["2025", "2025-12-31"],
      ["2026", "2026-09-28"],
    ]);
  });
});

describe("helpers", () => {
  it("finds the first day of a fiscal year", () => {
    expect(fiscalYearStartOf("2026-03-10", 7)).toBe("2025-07-01");
    expect(fiscalYearStartOf("2026-09-28", 1)).toBe("2026-01-01");
  });

  it("names a range by its period when it is a whole one, and by its dates when not", () => {
    expect(rangeLabel("2026-04-01", "2026-06-30")).toBe("Q2 2026");
    expect(rangeLabel("2026-04-02", "2026-06-30")).toBe("Apr 2, 2026 – Jun 30, 2026");
  });

  it("imports nothing that could write to the books", () => {
    expect(readFileSync("lib/domain/statement-columns.ts", "utf8")).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/statement-columns.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/statement-columns"`.

- [ ] **Step 3: Write the module**

`ctyhp-accounting/lib/domain/statement-columns.ts`:

```ts
/**
 * The columns of a statement, from the prototype's Compare list (`COMPARE`,
 * `plCols`, `bsCols` in Accounting-System-v3.html).
 *
 * A range statement (Profit and Loss) has columns that are date ranges; a point
 * statement (Balance Sheet, Trial Balance) has columns that are dates. Pure:
 * dates in, columns out.
 */

import { fiscalYearForDate } from "@/lib/domain/fiscal";
import { periodColumnLabel } from "@/lib/domain/period-label";
import { previousMonthEnd, previousPeriodRange } from "@/lib/domain/reports";
import {
  MAX_TREND_COLUMNS,
  monthEnd,
  monthlyColumns,
  quarterlyColumns,
  sameDayLastYear,
  trendColumnLimitMessage,
  type RangeColumn,
} from "@/lib/domain/report-periods";
import { shortDate } from "@/lib/domain/report-presets";

export const COMPARE_OPTIONS = [
  { key: "none", label: "No comparison" },
  { key: "prev", label: "Previous period" },
  { key: "year", label: "Previous year" },
  { key: "years", label: "Column per year" },
  { key: "quarter", label: "Column per quarter" },
  { key: "month", label: "Column per month" },
] as const;

export type CompareMode = (typeof COMPARE_OPTIONS)[number]["key"];

/** One column: a range (Profit and Loss) or a date, with `from` null (Balance Sheet, Trial Balance). */
export interface StatementColumnSpec {
  key: string;
  label: string;
  /** A second line under the heading, e.g. "As of Mar 15, 2026". */
  sub: string;
  from: string | null;
  to: string;
  /** The last column of a per-period Profit and Loss: the whole range. */
  isTotal: boolean;
}

export type ColumnPlan =
  | { ok: true; columns: StatementColumnSpec[]; change: boolean }
  | { ok: false; message: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The first day of the fiscal year a date falls in. */
export function fiscalYearStartOf(date: string, fiscalStartMonth: number): string {
  return `${fiscalYearForDate(date, fiscalStartMonth)}-${pad(fiscalStartMonth)}-01`;
}

function fiscalYearEndOf(date: string, fiscalStartMonth: number): string {
  const lastMonth = fiscalStartMonth - 1 + 11; // months after January of the fiscal year's first calendar year
  const year = fiscalYearForDate(date, fiscalStartMonth) + Math.floor(lastMonth / 12);
  return monthEnd(year, (lastMonth % 12) + 1);
}

function fiscalYearLabel(date: string, fiscalStartMonth: number): string {
  const year = fiscalYearForDate(date, fiscalStartMonth);
  return fiscalStartMonth === 1 ? String(year) : `FY ${year}–${String(year + 1).slice(-2)}`;
}

/** A range split at fiscal-year ends, the first and last clipped to it. */
function fiscalYearColumns(from: string, to: string, fiscalStartMonth: number): RangeColumn[] {
  const columns: RangeColumn[] = [];
  for (let start = from; start <= to; ) {
    const end = fiscalYearEndOf(start, fiscalStartMonth);
    const columnTo = end < to ? end : to;
    columns.push({ from: start, to: columnTo, label: fiscalYearLabel(start, fiscalStartMonth) });
    start = nextDay(columnTo);
  }
  return columns;
}

/** A range named by its period when it is a whole one ("Q2 2026"), otherwise by its dates. */
export function rangeLabel(from: string, to: string): string {
  const label = periodColumnLabel(from, to);
  return /\d{4}-\d{2}-\d{2}/.test(label) ? `${shortDate(from)} – ${shortDate(to)}` : label;
}

const monthName = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
const quarterName = (date: string) => `Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1} ${date.slice(0, 4)}`;

/** A range column, with its dates in small text under a heading that names a period instead. */
function rangeColumn(key: string, from: string, to: string, label = rangeLabel(from, to)): StatementColumnSpec {
  const dates = `${shortDate(from)} – ${shortDate(to)}`;
  return { key, label, sub: label === dates ? "" : dates, from, to, isTotal: false };
}

function perPeriod(columns: RangeColumn[], from: string, to: string, name: (c: RangeColumn) => string): ColumnPlan {
  const out = columns.map((c, i) => rangeColumn(`p${i}`, c.from, c.to, name(c)));
  if (out.length > 1) out.push({ ...rangeColumn("total", from, to, "Total"), isTotal: true });
  return { ok: true, columns: out, change: false };
}

/** The columns of a range statement. */
export function rangeColumns(mode: CompareMode, from: string, to: string, fiscalStartMonth: number): ColumnPlan {
  if (to < from) return { ok: false, message: "The start date is after the end date." };
  const current = rangeColumn("current", from, to);
  switch (mode) {
    case "none":
      return { ok: true, columns: [current], change: false };
    case "prev": {
      const prior = previousPeriodRange(from, to);
      return { ok: true, columns: [current, rangeColumn("prior", prior.from, prior.to)], change: true };
    }
    case "year":
      return {
        ok: true,
        columns: [current, rangeColumn("prior", sameDayLastYear(from), sameDayLastYear(to))],
        change: true,
      };
    case "month":
    case "quarter": {
      const message = trendColumnLimitMessage(mode, from, to);
      if (message) return { ok: false, message };
      const split = mode === "month" ? monthlyColumns(from, to) : quarterlyColumns(from, to);
      return perPeriod(split, from, to, (c) => rangeLabel(c.from, c.to));
    }
    case "years": {
      const split = fiscalYearColumns(from, to, fiscalStartMonth);
      if (split.length > MAX_TREND_COLUMNS) {
        return { ok: false, message: `That range is ${split.length} fiscal years. Narrow the range.` };
      }
      return perPeriod(split, from, to, (c) => c.label);
    }
  }
}

function pointColumn(key: string, date: string, label?: string): StatementColumnSpec {
  return {
    key,
    label: label ?? shortDate(date),
    sub: label ? `As of ${shortDate(date)}` : "",
    from: null,
    to: date,
    isTotal: false,
  };
}

/** The columns of a point statement. `columnsFrom` matters only for a column per month, quarter or year. */
export function pointColumns(
  mode: CompareMode,
  asOf: string,
  columnsFrom: string,
  fiscalStartMonth: number,
): ColumnPlan {
  const current = pointColumn("current", asOf);
  switch (mode) {
    case "none":
      return { ok: true, columns: [current], change: false };
    case "prev":
      return { ok: true, columns: [current, pointColumn("prior", previousMonthEnd(asOf))], change: true };
    case "year":
      return { ok: true, columns: [current, pointColumn("prior", sameDayLastYear(asOf))], change: true };
    case "month":
    case "quarter": {
      if (columnsFrom > asOf) return { ok: false, message: "Columns from is after As of." };
      const message = trendColumnLimitMessage(mode, columnsFrom, asOf);
      if (message) return { ok: false, message };
      const split = mode === "month" ? monthlyColumns(columnsFrom, asOf) : quarterlyColumns(columnsFrom, asOf);
      const name = mode === "month" ? monthName : quarterName;
      return { ok: true, columns: split.map((c, i) => pointColumn(`p${i}`, c.to, name(c.to))), change: false };
    }
    case "years": {
      if (columnsFrom > asOf) return { ok: false, message: "Columns from is after As of." };
      const split = fiscalYearColumns(columnsFrom, asOf, fiscalStartMonth);
      if (split.length > MAX_TREND_COLUMNS) {
        return { ok: false, message: `That range is ${split.length} fiscal years. Narrow the range.` };
      }
      return {
        ok: true,
        columns: split.map((c, i) => pointColumn(`p${i}`, c.to, fiscalYearLabel(c.to, fiscalStartMonth))),
        change: false,
      };
    }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/statement-columns.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add -- lib/domain/statement-columns.ts tests/unit/statement-columns.test.ts
printf '%s\n' "feat(statements): the prototype's Compare list, as column dates for range and point statements" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 2: The statement model, the account tree, and the Profit and Loss

**Files:**
- Create: `ctyhp-accounting/lib/domain/statement.ts`
- Test: `ctyhp-accounting/tests/unit/statement.test.ts`

**Interfaces:**
- Consumes: `StatementColumnSpec` (Task 1); `percentOfIncome`, types `ProfitAndLoss`, `ReportSection` (`@/lib/domain/reports`); `AccountType` (`@/lib/domain/accounts`).
- Produces (all exported): `AccountRef { id; code; name; type: AccountType; parentId: string | null }`; `AccountIndex = ReadonlyMap<string, AccountRef>`; `indexAccounts(accounts)`; `ZoomSpec { title: string; accountIds: string[]; from: string | null; to: string; figure: number }`; `StatementRowKind`; `StatementCell { amount: number | null; zoom: ZoomSpec | null }`; `StatementTone = "favorable" | "unfavorable" | null`; `StatementRow { key; kind; label; depth: 0|1|2|3; accountId: string | null; cells; percent?; change?; tone? }`; `StatementColumn = StatementColumnSpec`; `Statement { title; columns; changeLabels: [string, string] | null; percent: boolean; rows; empty: boolean; outOfBalance: number | null }`; `changeOf(current, prior)`; `pnlStatement(input: PnlStatementInput): Statement`. Row keys used later: `income:total`, `cogs:total`, `gross`, `opex:total`, `net-operating`, `net-other`, `net-income`, `<section>:note`; account rows `<section>:a:<accountId>`, parent subtotals `<section>:t:<accountId>`.

- [ ] **Step 1: Write the failing tests**

`ctyhp-accounting/tests/unit/statement.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AccountType } from "@/lib/domain/accounts";
import { buildProfitAndLoss, type LedgerBalance } from "@/lib/domain/reports";
import { indexAccounts, pnlStatement, type AccountRef, type Statement, type StatementColumn } from "@/lib/domain/statement";

const acct = (id: string, code: string, name: string, type: AccountType, parentId: string | null = null): AccountRef => ({
  id,
  code,
  name,
  type,
  parentId,
});

const ACCOUNTS = indexAccounts([
  acct("sales", "4000", "Sales", "income"),
  acct("services", "4100", "Services", "income", "sales"),
  acct("cogs", "5000", "Cost of Goods Sold", "cost_of_goods_sold"),
  acct("rent", "6100", "Rent", "expense"),
  acct("repairs", "6200", "Repairs", "expense"),
  acct("showroom", "6210", "Showroom Repairs", "expense", "repairs"),
  acct("interest", "7000", "Interest Income", "other_income"),
]);

const bal = (id: string, debitBase: number, creditBase: number): LedgerBalance => {
  const a = ACCOUNTS.get(id)!;
  return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, debitBase, creditBase };
};

/** Q2: $10,000 sales and $2,000 services; $3,000 cost of sales; $1,500 rent, $200 + $300 repairs; $50 interest. */
const CURRENT = [
  bal("sales", 0, 1_000_000),
  bal("services", 0, 200_000),
  bal("cogs", 300_000, 0),
  bal("rent", 150_000, 0),
  bal("repairs", 20_000, 0),
  bal("showroom", 30_000, 0),
  bal("interest", 0, 5_000),
];
/** Q1: $8,000 sales; $2,500 cost of sales; $1,500 rent; $100 showroom repairs. */
const PRIOR = [bal("sales", 0, 800_000), bal("cogs", 250_000, 0), bal("rent", 150_000, 0), bal("showroom", 10_000, 0)];

const Q2: StatementColumn = { key: "current", label: "Q2 2026", sub: "", from: "2026-04-01", to: "2026-06-30", isTotal: false };
const Q1: StatementColumn = { key: "prior", label: "Q1 2026", sub: "", from: "2026-01-01", to: "2026-03-31", isTotal: false };

const single = (rows: LedgerBalance[], showPercent = false) =>
  pnlStatement({ columns: [Q2], pnls: [buildProfitAndLoss(rows)], accounts: ACCOUNTS, showPercent, change: false });
const pair = () =>
  pnlStatement({
    columns: [Q2, Q1],
    pnls: [buildProfitAndLoss(CURRENT), buildProfitAndLoss(PRIOR)],
    accounts: ACCOUNTS,
    showPercent: true,
    change: true,
  });
const row = (s: Statement, key: string) => s.rows.find((r) => r.key === key);
const amounts = (s: Statement, key: string) => row(s, key)?.cells.map((c) => c.amount);

describe("pnlStatement", () => {
  it("carries every builder figure and adds none of its own to them", () => {
    const s = single(CURRENT);
    const pnl = buildProfitAndLoss(CURRENT);
    expect(amounts(s, "income:total")).toEqual([pnl.income.total]);
    expect(amounts(s, "cogs:total")).toEqual([pnl.costOfGoodsSold.total]);
    expect(amounts(s, "gross")).toEqual([pnl.grossProfit]);
    expect(amounts(s, "opex:total")).toEqual([pnl.operatingExpenses.total]);
    expect(amounts(s, "net-operating")).toEqual([900_000 - 200_000]);
    expect(amounts(s, "net-other")).toEqual([5_000]);
    expect(amounts(s, "net-income")).toEqual([pnl.netIncome]);
    expect(pnl.netIncome).toBe(705_000);
  });

  it("nests an account under its parent, with the parent's subtotal", () => {
    const s = single(CURRENT);
    const opex = s.rows.filter((r) => r.key.startsWith("opex"));
    expect(opex.map((r) => [r.key, r.kind, r.depth, r.cells[0].amount])).toEqual([
      ["opex", "section", 0, null],
      ["opex:a:rent", "account", 1, 150_000],
      ["opex:a:repairs", "account", 1, 20_000],
      ["opex:a:showroom", "account", 2, 30_000],
      ["opex:t:repairs", "subtotal", 1, 50_000],
      ["opex:total", "total", 0, 200_000],
    ]);
    expect(row(s, "opex:t:repairs")?.label).toBe("Total 6200 Repairs");
  });

  it("heads children with a parent that has no balance of its own", () => {
    const s = single([bal("showroom", 10_000, 0), bal("sales", 0, 800_000)]);
    expect(row(s, "opex:a:repairs")?.cells[0].amount).toBeNull();
    expect(row(s, "opex:a:repairs")?.accountId).toBeNull();
    expect(row(s, "opex:a:showroom")?.accountId).toBe("showroom");
    expect(row(s, "opex:a:showroom")?.depth).toBe(2);
    expect(amounts(s, "opex:t:repairs")).toEqual([10_000]);
  });

  it("shows each figure as a share of that column's income", () => {
    expect(row(single(CURRENT, true), "opex:a:rent")?.percent).toEqual([12.5]);
  });

  it("puts the change beside two columns: the first less the second, as a % of the second", () => {
    const s = pair();
    expect(amounts(s, "net-income")).toEqual([705_000, 390_000]);
    expect(row(s, "net-income")?.change).toEqual({ amount: 315_000, percent: (315_000 / 390_000) * 100 });
    expect(row(s, "opex:a:repairs")?.change).toEqual({ amount: 20_000, percent: null });
    expect(s.changeLabels).toEqual(["Change", "%"]);
  });

  it("opens a total onto every account behind it, in its column's dates", () => {
    const s = pair();
    expect(row(s, "income:total")?.cells[0].zoom).toEqual({
      title: "Total Income",
      accountIds: ["sales", "services"],
      from: "2026-04-01",
      to: "2026-06-30",
      figure: 1_200_000,
    });
    expect(row(s, "income:total")?.cells[1].zoom?.from).toBe("2026-01-01");
  });

  it("leaves out cost of sales and other income when there are none, and says when a section is empty", () => {
    const s = single([bal("rent", 150_000, 0)]);
    expect(row(s, "cogs:total")).toBeUndefined();
    expect(row(s, "gross")).toBeUndefined();
    expect(row(s, "net-other")).toBeUndefined();
    expect(row(s, "income:note")?.label).toBe("No income in this period");
  });

  it("is empty when nothing was posted", () => {
    expect(single([]).empty).toBe(true);
    expect(single(CURRENT).empty).toBe(false);
  });
});

describe("statement module", () => {
  it("imports nothing that could write to the books", () => {
    expect(readFileSync("lib/domain/statement.ts", "utf8")).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/statement.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/statement"`.

- [ ] **Step 3: Write the module**

`ctyhp-accounting/lib/domain/statement.ts`:

```ts
/**
 * A financial statement, laid out as the client's prototype lays one out
 * (`reportPL`, `reportBS`, `reportTB`, `reportBudget` in Accounting-System-v3.html):
 * sections, accounts nested under their parent, subtotals, totals and a grand
 * total, one cell per column — and every figure a QuickZoom.
 *
 * Pure, and it computes no figure. Every amount comes from
 * `lib/domain/reports.ts`. What is added here is only for display — a parent
 * account's subtotal, a group's subtotal on the balance sheet — and the tests
 * hold each of those to the builders' own totals. Section and statement totals
 * are always the builders', never re-added.
 */

import type { AccountType } from "@/lib/domain/accounts";
import { percentOfIncome, type ProfitAndLoss, type ReportSection } from "@/lib/domain/reports";
import type { StatementColumnSpec } from "@/lib/domain/statement-columns";

/* ------------------------------------------------------------------ model */

export interface AccountRef {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
}

export type AccountIndex = ReadonlyMap<string, AccountRef>;

export function indexAccounts(accounts: readonly AccountRef[]): AccountIndex {
  return new Map(accounts.map((a) => [a.id, a]));
}

/** What clicking a figure opens: every posted line on these accounts in these dates. */
export interface ZoomSpec {
  title: string;
  accountIds: string[];
  /** Null for a point statement: all history up to `to`. */
  from: string | null;
  to: string;
  /** The amount that was clicked. The list it opens must add up to it. */
  figure: number;
}

export type StatementRowKind = "section" | "classhead" | "account" | "subtotal" | "total" | "grand" | "spacer" | "note";

export interface StatementCell {
  /** Minor units, base currency; null is a blank. */
  amount: number | null;
  zoom: ZoomSpec | null;
}

export type StatementTone = "favorable" | "unfavorable" | null;

export interface StatementRow {
  key: string;
  kind: StatementRowKind;
  label: string;
  depth: 0 | 1 | 2 | 3;
  /** An account row's account; its name opens that account's General Ledger. */
  accountId: string | null;
  cells: StatementCell[];
  /** % of income, per column, when the statement shows it. */
  percent?: (number | null)[];
  /** Two columns: the first less the second, and that as a % of the second. */
  change?: { amount: number; percent: number | null } | null;
  /** Budget vs Actual: whether the variance is good news. */
  tone?: StatementTone;
}

export type StatementColumn = StatementColumnSpec;

export interface Statement {
  title: string;
  columns: StatementColumn[];
  /** Headings of the two change columns, when the statement has them. */
  changeLabels: [string, string] | null;
  percent: boolean;
  rows: StatementRow[];
  empty: boolean;
  /** When a statement should balance and does not: by how much, in the first column that does not. */
  outOfBalance: number | null;
}

/* ------------------------------------------------------------------- rows */

interface Ctx {
  columns: readonly StatementColumn[];
  accounts: AccountIndex;
  /** Income per column, when % of income is shown. */
  percentBase: readonly number[] | null;
  change: boolean;
}

type Depth = StatementRow["depth"];
const depthOf = (n: number): Depth => Math.min(Math.max(n, 0), 3) as Depth;

export function changeOf(current: number, prior: number): { amount: number; percent: number | null } {
  const amount = current - prior;
  return { amount, percent: prior === 0 ? null : (amount / Math.abs(prior)) * 100 };
}

interface RowSpec {
  key: string;
  kind: StatementRowKind;
  label: string;
  depth?: number;
  accountId?: string | null;
  amounts?: readonly number[] | null;
  /** The accounts behind the figures. None: the figures are not links. */
  zoomIds?: readonly string[] | null;
  /** The dates a cell's zoom reads, when they are not its column's. */
  zoomRange?: (column: number) => { from: string | null; to: string };
  zoomTitle?: string;
}

function makeRow(ctx: Ctx, spec: RowSpec): StatementRow {
  const amounts = spec.amounts ?? null;
  const ids = spec.zoomIds && spec.zoomIds.length > 0 ? [...spec.zoomIds] : null;
  const cells: StatementCell[] = amounts
    ? amounts.map((amount, i) => {
        const range = spec.zoomRange ? spec.zoomRange(i) : { from: ctx.columns[i].from, to: ctx.columns[i].to };
        return {
          amount,
          zoom: ids ? { title: spec.zoomTitle ?? spec.label, accountIds: ids, from: range.from, to: range.to, figure: amount } : null,
        };
      })
    : ctx.columns.map(() => ({ amount: null, zoom: null }));
  const row: StatementRow = {
    key: spec.key,
    kind: spec.kind,
    label: spec.label,
    depth: depthOf(spec.depth ?? 0),
    accountId: spec.accountId ?? null,
    cells,
  };
  if (amounts && ctx.percentBase) {
    const base = ctx.percentBase;
    row.percent = amounts.map((a, i) => percentOfIncome(a, base[i]));
  }
  if (amounts && ctx.change) row.change = changeOf(amounts[0], amounts[1]);
  return row;
}

const sectionRow = (ctx: Ctx, key: string, label: string) => makeRow(ctx, { key, kind: "section", label });
const classheadRow = (ctx: Ctx, key: string, label: string) => makeRow(ctx, { key, kind: "classhead", label });
const noteRow = (ctx: Ctx, key: string, label: string) => makeRow(ctx, { key, kind: "note", label, depth: 1 });
const spacerRow = (ctx: Ctx, key: string) => makeRow(ctx, { key, kind: "spacer", label: "" });

/* ------------------------------------------------------ lines and the tree */

interface Leaf {
  key: string;
  accountId: string | null;
  code: string;
  name: string;
  amounts: number[];
}

type SectionLine = ReportSection["lines"][number];
const lineKey = (l: SectionLine) => l.accountId ?? `${l.accountCode}:${l.name}`;
const labelOf = (code: string, name: string) => (code ? `${code} ${name}` : name);

/**
 * Every line a section has in any column, in code order, 0 in a column that
 * lacks it — the pairing `compareReportLines` does for two columns.
 */
function leavesOf(sections: readonly ReportSection[]): Leaf[] {
  const byKey = new Map<string, Leaf>();
  sections.forEach((section, i) => {
    for (const line of section.lines) {
      const key = lineKey(line);
      let leaf = byKey.get(key);
      if (!leaf) {
        leaf = { key, accountId: line.accountId, code: line.accountCode, name: line.name, amounts: sections.map(() => 0) };
        byKey.set(key, leaf);
      }
      leaf.amounts[i] = line.amount;
    }
  });
  return [...byKey.values()].sort((a, b) => a.code.localeCompare(b.code));
}

const idsOf = (leaves: readonly Leaf[]): string[] => leaves.flatMap((l) => (l.accountId ? [l.accountId] : []));

function sumLeaves(leaves: readonly Leaf[], width: number): number[] {
  const total = new Array<number>(width).fill(0);
  for (const leaf of leaves) leaf.amounts.forEach((v, i) => (total[i] += v));
  return total;
}

interface TreeNode {
  key: string;
  accountId: string | null;
  code: string;
  label: string;
  own: number[] | null;
  children: TreeNode[];
}

const ofTypes =
  (...types: AccountType[]) =>
  (a: AccountRef) =>
    types.includes(a.type);

/**
 * Accounts under their parent, as the prototype's `buildTreeN` nests
 * `Assets:Bank:…`. A parent from another section, or a loop in the chart,
 * leaves an account at the top.
 */
function forest(leaves: readonly Leaf[], ctx: Ctx, inSection: (a: AccountRef) => boolean): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const nodeFor = (id: string, trail: ReadonlySet<string>): TreeNode => {
    const found = nodes.get(id);
    if (found) return found;
    const account = ctx.accounts.get(id)!;
    const node: TreeNode = { key: id, accountId: id, code: account.code, label: labelOf(account.code, account.name), own: null, children: [] };
    nodes.set(id, node);
    const parent = account.parentId ? ctx.accounts.get(account.parentId) : undefined;
    if (parent && inSection(parent) && !trail.has(parent.id)) {
      nodeFor(parent.id, new Set([...trail, id])).children.push(node);
    } else {
      roots.push(node);
    }
    return node;
  };
  for (const leaf of leaves) {
    if (leaf.accountId && ctx.accounts.has(leaf.accountId)) {
      nodeFor(leaf.accountId, new Set()).own = leaf.amounts;
    } else {
      roots.push({ key: leaf.key, accountId: leaf.accountId, code: leaf.code, label: labelOf(leaf.code, leaf.name), own: leaf.amounts, children: [] });
    }
  }
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.code.localeCompare(b.code));
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return roots;
}

function subtreeTotal(node: TreeNode, width: number): number[] {
  const total = node.own ? [...node.own] : new Array<number>(width).fill(0);
  for (const child of node.children) subtreeTotal(child, width).forEach((v, i) => (total[i] += v));
  return total;
}

const subtreeIds = (node: TreeNode): string[] => [
  ...(node.accountId ? [node.accountId] : []),
  ...node.children.flatMap(subtreeIds),
];

function renderTree(nodes: readonly TreeNode[], depth: number, ctx: Ctx, out: StatementRow[], prefix: string): void {
  for (const node of nodes) {
    out.push(
      makeRow(ctx, {
        key: `${prefix}:a:${node.key}`,
        kind: "account",
        label: node.label,
        depth,
        // A heading with nothing of its own may be a non-posting account the
        // General Ledger does not list, so only an account with a figure links there.
        accountId: node.own ? node.accountId : null,
        amounts: node.own,
        zoomIds: node.own && node.accountId ? [node.accountId] : null,
      }),
    );
    if (node.children.length === 0) continue;
    renderTree(node.children, depth + 1, ctx, out, prefix);
    out.push(
      makeRow(ctx, {
        key: `${prefix}:t:${node.key}`,
        kind: "subtotal",
        label: `Total ${node.label}`,
        depth,
        amounts: subtreeTotal(node, ctx.columns.length),
        zoomIds: subtreeIds(node),
      }),
    );
  }
}

/* ------------------------------------------------------- Profit and Loss */

export interface PnlStatementInput {
  columns: readonly StatementColumn[];
  /** One per column, in column order; a Total column's is `sumProfitAndLoss` of the others. */
  pnls: readonly ProfitAndLoss[];
  accounts: AccountIndex;
  showPercent: boolean;
  /** Two columns and a change pair (Previous period, Previous year). */
  change: boolean;
}

/** Following `reportPL`. */
export function pnlStatement(input: PnlStatementInput): Statement {
  const { pnls } = input;
  const ctx: Ctx = {
    columns: input.columns,
    accounts: input.accounts,
    percentBase: input.showPercent ? pnls.map((p) => p.income.total) : null,
    change: input.change,
  };
  const rows: StatementRow[] = [];
  const pick = (f: (p: ProfitAndLoss) => ReportSection) => pnls.map(f);
  const income = leavesOf(pick((p) => p.income));
  const cogs = leavesOf(pick((p) => p.costOfGoodsSold));
  const opex = leavesOf(pick((p) => p.operatingExpenses));
  const otherIncome = leavesOf(pick((p) => p.otherIncome));
  const otherExpenses = leavesOf(pick((p) => p.otherExpenses));

  const block = (
    key: string,
    title: string,
    leaves: Leaf[],
    types: AccountType[],
    totals: number[],
    emptyNote: string | null,
  ) => {
    rows.push(sectionRow(ctx, key, title));
    if (leaves.length === 0 && emptyNote) rows.push(noteRow(ctx, `${key}:note`, emptyNote));
    renderTree(forest(leaves, ctx, ofTypes(...types)), 1, ctx, rows, key);
    rows.push(makeRow(ctx, { key: `${key}:total`, kind: "total", label: `Total ${title}`, amounts: totals, zoomIds: idsOf(leaves) }));
  };

  block("income", "Income", income, ["income"], pick((p) => p.income).map((s) => s.total), "No income in this period");
  if (cogs.length > 0) {
    rows.push(spacerRow(ctx, "s-cogs"));
    block("cogs", "Cost of Goods Sold", cogs, ["cost_of_goods_sold"], pick((p) => p.costOfGoodsSold).map((s) => s.total), null);
    rows.push(spacerRow(ctx, "s-gross"));
    rows.push(
      makeRow(ctx, {
        key: "gross",
        kind: "total",
        label: "Gross Profit",
        amounts: pnls.map((p) => p.grossProfit),
        zoomIds: [...idsOf(income), ...idsOf(cogs)],
      }),
    );
  }
  rows.push(spacerRow(ctx, "s-opex"));
  block("opex", "Operating Expenses", opex, ["expense"], pick((p) => p.operatingExpenses).map((s) => s.total), "No expenses in this period");
  rows.push(spacerRow(ctx, "s-net-operating"));
  const operatingIds = [...idsOf(income), ...idsOf(cogs), ...idsOf(opex)];
  rows.push(
    makeRow(ctx, {
      key: "net-operating",
      kind: "total",
      label: "Net Operating Income",
      amounts: pnls.map((p) => p.grossProfit - p.operatingExpenses.total),
      zoomIds: operatingIds,
    }),
  );
  if (otherIncome.length > 0 || otherExpenses.length > 0) {
    rows.push(spacerRow(ctx, "s-other"));
    if (otherIncome.length > 0) {
      block("other-income", "Other Income", otherIncome, ["other_income"], pick((p) => p.otherIncome).map((s) => s.total), null);
    }
    if (otherExpenses.length > 0) {
      block("other-expenses", "Other Expenses", otherExpenses, ["other_expense"], pick((p) => p.otherExpenses).map((s) => s.total), null);
    }
    rows.push(
      makeRow(ctx, {
        key: "net-other",
        kind: "total",
        label: "Net Other Income",
        amounts: pnls.map((p) => p.otherIncome.total - p.otherExpenses.total),
        zoomIds: [...idsOf(otherIncome), ...idsOf(otherExpenses)],
      }),
    );
  }
  rows.push(spacerRow(ctx, "s-net"));
  rows.push(
    makeRow(ctx, {
      key: "net-income",
      kind: "grand",
      label: "Net Income",
      amounts: pnls.map((p) => p.netIncome),
      zoomIds: [...operatingIds, ...idsOf(otherIncome), ...idsOf(otherExpenses)],
    }),
  );

  return {
    title: "Profit and Loss",
    columns: [...input.columns],
    changeLabels: input.change ? ["Change", "%"] : null,
    percent: input.showPercent,
    rows,
    empty: [income, cogs, opex, otherIncome, otherExpenses].every((l) => l.length === 0),
    outOfBalance: null,
  };
}
```

`classheadRow`, `sumLeaves` and `RowSpec.zoomRange` have no caller until Task 3; an unused-variable lint warning on them in this commit is expected and goes away there.

Note for Tasks 3–4: they append to this file and use the private helpers above (`makeRow`, `sectionRow`, `classheadRow`, `noteRow`, `spacerRow`, `leavesOf`, `idsOf`, `sumLeaves`, `forest`, `renderTree`, `labelOf`, `ofTypes`, `Ctx`, `Leaf`, `RowSpec`, `SectionLine`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/statement.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add -- lib/domain/statement.ts tests/unit/statement.test.ts
printf '%s\n' "feat(statements): the Profit and Loss as the prototype sets one out, accounts under their parents" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 3: Balance Sheet and Trial Balance

**Files:**
- Modify: `ctyhp-accounting/lib/domain/statement.ts` (imports; append two builders)
- Test: `ctyhp-accounting/tests/unit/statement.test.ts` (append)

**Interfaces:**
- Consumes: Task 2's model and helpers; `buildBalanceSheet`, `buildTrialBalance`, types `BalanceSheet`, `TrialBalance` (`@/lib/domain/reports`); `ACCOUNT_TYPES`, `statementSectionOf` (`@/lib/domain/accounts`); `dayBefore` (`@/lib/domain/fiscal`).
- Produces: `balanceSheetStatement(input: BalanceSheetStatementInput): Statement` with row keys `assets`, `assets:<cash|ar|other|long>` (classheads), `assets:<group>:total` (group subtotals), `assets:total` (grand), `liabilities:current:total`, `liabilities:total`, `equity:retained`, `equity:net-income`, `equity:total`, `le:total` (grand); `trialBalanceStatement(input: TrialBalanceStatementInput): Statement` with account rows `a:<accountId>` and the grand `total`; its columns are doubled (Debit, Credit per input column).

- [ ] **Step 1: Append the failing tests**

In `tests/unit/statement.test.ts`, extend the imports:

```ts
import { buildBalanceSheet, buildProfitAndLoss, buildTrialBalance, type BalanceSheet, type LedgerBalance } from "@/lib/domain/reports";
import {
  balanceSheetStatement,
  indexAccounts,
  pnlStatement,
  trialBalanceStatement,
  type AccountRef,
  type Statement,
  type StatementColumn,
} from "@/lib/domain/statement";
```

and append:

```ts
const BS_ACCOUNTS = indexAccounts([
  acct("cash", "1000", "Cash", "bank"),
  acct("checking", "1010", "Checking", "bank", "cash"),
  acct("ar", "1100", "Accounts Receivable", "accounts_receivable"),
  acct("inventory", "1200", "Inventory", "current_asset"),
  acct("equipment", "1500", "Equipment", "fixed_asset"),
  acct("ap", "2000", "Accounts Payable", "accounts_payable"),
  acct("card", "2100", "Company Card", "credit_card"),
  acct("owner", "3000", "Owner's Equity", "equity"),
  acct("sales", "4000", "Sales", "income"),
  acct("rent", "6100", "Rent", "expense"),
]);
const bsBal = (id: string, debitBase: number, creditBase: number): LedgerBalance => {
  const a = BS_ACCOUNTS.get(id)!;
  return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, debitBase, creditBase };
};
/** June 30, 2026: $12,500 of assets against $2,000 owed and $10,500 of equity ($6,000 put in, $4,500 earned). */
const JUNE = [
  bsBal("cash", 500_000, 0),
  bsBal("checking", 250_000, 0),
  bsBal("ar", 120_000, 0),
  bsBal("inventory", 80_000, 0),
  bsBal("equipment", 300_000, 0),
  bsBal("ap", 0, 150_000),
  bsBal("card", 0, 50_000),
  bsBal("owner", 0, 600_000),
  bsBal("sales", 0, 900_000),
  bsBal("rent", 450_000, 0),
];
const JUNE_30: StatementColumn = { key: "current", label: "Jun 30, 2026", sub: "", from: null, to: "2026-06-30", isTotal: false };
const sheetOf = (rows: LedgerBalance[], priorEarnings = 300_000) =>
  balanceSheetStatement({
    columns: [JUNE_30],
    sheets: [buildBalanceSheet(rows)],
    priorEarnings: [priorEarnings],
    fiscalYearStarts: ["2026-01-01"],
    accounts: BS_ACCOUNTS,
    change: false,
  });

describe("balanceSheetStatement", () => {
  it("groups assets as the prototype does, and the groups add up to Total Assets", () => {
    const s = sheetOf(JUNE);
    expect(amounts(s, "assets:cash:total")).toEqual([750_000]);
    expect(amounts(s, "assets:ar:total")).toEqual([120_000]);
    expect(amounts(s, "assets:other:total")).toEqual([80_000]);
    expect(amounts(s, "assets:long:total")).toEqual([300_000]);
    expect(amounts(s, "assets:total")).toEqual([buildBalanceSheet(JUNE).totalAssets]);
    expect(row(s, "assets:total")?.kind).toBe("grand");
    expect(row(s, "assets:cash:a:checking")?.depth).toBe(2);
  });

  it("shows receivables only when there are some, and the other groups always", () => {
    const s = sheetOf(JUNE.filter((b) => b.accountId !== "ar" && b.accountId !== "equipment"));
    expect(row(s, "assets:ar")).toBeUndefined();
    expect(row(s, "assets:long")?.kind).toBe("classhead");
    expect(amounts(s, "assets:long:total")).toEqual([0]);
  });

  it("splits the year's profit from earlier years', and the two make the builder's Current earnings", () => {
    const s = sheetOf(JUNE);
    expect(amounts(s, "equity:retained")).toEqual([300_000]);
    expect(amounts(s, "equity:net-income")).toEqual([150_000]);
    expect(amounts(s, "equity:total")).toEqual([1_050_000]);
    expect(amounts(s, "le:total")).toEqual([1_250_000]);
    expect(row(s, "equity:retained")?.cells[0].zoom).toMatchObject({ accountIds: ["sales", "rent"], from: null, to: "2025-12-31" });
    expect(row(s, "equity:net-income")?.cells[0].zoom).toMatchObject({ from: "2026-01-01", to: "2026-06-30" });
  });

  it("says by how much it is out of balance, when it is", () => {
    const off: BalanceSheet = {
      ...buildBalanceSheet(JUNE),
      totalAssets: 1_250_010,
      balanced: false,
    };
    const s = balanceSheetStatement({
      columns: [JUNE_30],
      sheets: [off],
      priorEarnings: [300_000],
      fiscalYearStarts: ["2026-01-01"],
      accounts: BS_ACCOUNTS,
      change: false,
    });
    expect(s.outOfBalance).toBe(10);
    expect(sheetOf(JUNE).outOfBalance).toBeNull();
  });
});

describe("trialBalanceStatement", () => {
  // Rent is coded 0100 on purpose: a trial balance orders by type first, so it still comes last.
  const TB_ACCOUNTS = indexAccounts([
    acct("cash", "1000", "Cash", "bank"),
    acct("ap", "2000", "Accounts Payable", "accounts_payable"),
    acct("owner", "3000", "Owner's Equity", "equity"),
    acct("sales", "4000", "Sales", "income"),
    acct("rent", "0100", "Rent", "expense"),
  ]);
  const tbBal = (id: string, debitBase: number, creditBase: number): LedgerBalance => {
    const a = TB_ACCOUNTS.get(id)!;
    return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, debitBase, creditBase };
  };
  const ROWS = [tbBal("rent", 1_150, 0), tbBal("cash", 500, 0), tbBal("ap", 0, 150), tbBal("owner", 0, 600), tbBal("sales", 0, 900)];
  const tb = trialBalanceStatement({ columns: [JUNE_30], tbs: [buildTrialBalance(ROWS)], accounts: TB_ACCOUNTS });

  it("orders accounts by type, then code, with a blank on the side a balance is not", () => {
    expect(tb.rows.filter((r) => r.kind === "account").map((r) => r.accountId)).toEqual(["cash", "ap", "owner", "sales", "rent"]);
    expect(amounts(tb, "a:cash")).toEqual([500, null]);
    expect(amounts(tb, "a:ap")).toEqual([null, 150]);
    expect(tb.columns.map((c) => c.label)).toEqual(["Debit", "Credit"]);
  });

  it("closes with the builder's totals, each opening onto the accounts on its side", () => {
    expect(amounts(tb, "total")).toEqual([1_650, 1_650]);
    expect(row(tb, "total")?.cells[0].zoom?.accountIds.sort()).toEqual(["cash", "rent"]);
    expect(row(tb, "total")?.cells[1].zoom?.accountIds.sort()).toEqual(["ap", "owner", "sales"]);
    expect(tb.outOfBalance).toBeNull();
  });

  it("names each side by its column when there are several", () => {
    const two = trialBalanceStatement({
      columns: [JUNE_30, { ...JUNE_30, key: "prior", label: "May 31, 2026", to: "2026-05-31" }],
      tbs: [buildTrialBalance(ROWS), buildTrialBalance(ROWS)],
      accounts: TB_ACCOUNTS,
    });
    expect(two.columns.map((c) => c.label)).toEqual([
      "Jun 30, 2026 Debit",
      "Jun 30, 2026 Credit",
      "May 31, 2026 Debit",
      "May 31, 2026 Credit",
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/statement.test.ts`
Expected: FAIL — `balanceSheetStatement is not a function` (or not exported).

- [ ] **Step 3: Append the builders**

In `lib/domain/statement.ts`, replace the two import lines at the top with:

```ts
import { ACCOUNT_TYPES, statementSectionOf, type AccountType } from "@/lib/domain/accounts";
import { dayBefore } from "@/lib/domain/fiscal";
import {
  percentOfIncome,
  type BalanceSheet,
  type ProfitAndLoss,
  type ReportSection,
  type TrialBalance,
} from "@/lib/domain/reports";
```

and append at the end of the file:

```ts
/* ---------------------------------------------------------- Balance Sheet */

export interface BalanceSheetStatementInput {
  columns: readonly StatementColumn[];
  sheets: readonly BalanceSheet[];
  /** Per column: `netIncomeOf` everything up to the day before the fiscal year that contains the column's date. */
  priorEarnings: readonly number[];
  /** Per column: the first day of that fiscal year. */
  fiscalYearStarts: readonly string[];
  accounts: AccountIndex;
  change: boolean;
}

const ASSET_GROUPS: ReadonlyArray<{ key: string; title: string; types: AccountType[]; always: boolean }> = [
  { key: "cash", title: "Cash and Bank", types: ["bank"], always: true },
  { key: "ar", title: "Accounts Receivable", types: ["accounts_receivable"], always: false },
  { key: "other", title: "Other Current Assets", types: ["current_asset"], always: true },
  { key: "long", title: "Long-term Assets", types: ["fixed_asset"], always: true },
];

const LIABILITY_TYPES: AccountType[] = ["accounts_payable", "credit_card", "current_liability"];

/** `buildBalanceSheet`'s own line for the profit it carries in equity. */
const isCurrentEarnings = (line: SectionLine) => line.accountId === null && line.name === "Current earnings";

/** Following `reportBS`. */
export function balanceSheetStatement(input: BalanceSheetStatementInput): Statement {
  const { sheets } = input;
  const width = sheets.length;
  const ctx: Ctx = { columns: input.columns, accounts: input.accounts, percentBase: null, change: input.change };
  const rows: StatementRow[] = [];
  const typeOf = (leaf: Leaf) => (leaf.accountId ? input.accounts.get(leaf.accountId)?.type : undefined);
  const plIds = [...input.accounts.values()]
    .filter((a) => statementSectionOf(a.type) === "profit_and_loss")
    .map((a) => a.id);

  // Assets, in the prototype's groups; an account of an unexpected type counts as other current.
  const assets = leavesOf(sheets.map((s) => s.assets));
  const groupOf = (leaf: Leaf) => {
    const type = typeOf(leaf);
    return ASSET_GROUPS.find((g) => type !== undefined && g.types.includes(type))?.key ?? "other";
  };
  rows.push(sectionRow(ctx, "assets", "Assets"));
  for (const group of ASSET_GROUPS) {
    const leaves = assets.filter((leaf) => groupOf(leaf) === group.key);
    if (leaves.length === 0 && !group.always) continue;
    rows.push(classheadRow(ctx, `assets:${group.key}`, group.title));
    renderTree(forest(leaves, ctx, ofTypes(...group.types)), 1, ctx, rows, `assets:${group.key}`);
    rows.push(
      makeRow(ctx, {
        key: `assets:${group.key}:total`,
        kind: "subtotal",
        label: `Total ${group.title}`,
        amounts: sumLeaves(leaves, width),
        zoomIds: idsOf(leaves),
      }),
    );
  }
  rows.push(makeRow(ctx, { key: "assets:total", kind: "grand", label: "Total Assets", amounts: sheets.map((s) => s.totalAssets), zoomIds: idsOf(assets) }));

  // Liabilities. OneBook has no long-term liability type, so there is one group.
  const liabilities = leavesOf(sheets.map((s) => s.liabilities));
  rows.push(spacerRow(ctx, "s-liabilities"));
  rows.push(sectionRow(ctx, "liabilities", "Liabilities"));
  rows.push(classheadRow(ctx, "liabilities:current", "Current Liabilities"));
  renderTree(forest(liabilities, ctx, ofTypes(...LIABILITY_TYPES)), 1, ctx, rows, "liabilities");
  rows.push(
    makeRow(ctx, {
      key: "liabilities:current:total",
      kind: "subtotal",
      label: "Total Current Liabilities",
      amounts: sumLeaves(liabilities, width),
      zoomIds: idsOf(liabilities),
    }),
  );
  rows.push(
    makeRow(ctx, { key: "liabilities:total", kind: "total", label: "Total Liabilities", amounts: sheets.map((s) => s.totalLiabilities), zoomIds: idsOf(liabilities) }),
  );

  // Equity: the accounts, then the builder's "Current earnings" split at the start of the fiscal year.
  const equity = leavesOf(sheets.map((s) => ({ ...s.equity, lines: s.equity.lines.filter((l) => !isCurrentEarnings(l)) })));
  const earnings = sheets.map((s) => s.equity.lines.find(isCurrentEarnings)?.amount ?? 0);
  const prior = [...input.priorEarnings];
  const thisYear = earnings.map((e, i) => e - prior[i]);
  rows.push(spacerRow(ctx, "s-equity"));
  rows.push(sectionRow(ctx, "equity", "Equity"));
  renderTree(forest(equity, ctx, ofTypes("equity")), 1, ctx, rows, "equity");
  if (prior.some((v) => v !== 0)) {
    rows.push(
      makeRow(ctx, {
        key: "equity:retained",
        kind: "account",
        label: "Retained earnings — prior years",
        depth: 1,
        amounts: prior,
        zoomIds: plIds,
        zoomRange: (i) => ({ from: null, to: dayBefore(input.fiscalYearStarts[i]) }),
      }),
    );
  }
  if (thisYear.some((v) => v !== 0)) {
    rows.push(
      makeRow(ctx, {
        key: "equity:net-income",
        kind: "account",
        label: "Net income — this year",
        depth: 1,
        amounts: thisYear,
        zoomIds: plIds,
        zoomRange: (i) => ({ from: input.fiscalYearStarts[i], to: input.columns[i].to }),
      }),
    );
  }
  const equityIds = [...idsOf(equity), ...plIds];
  rows.push(makeRow(ctx, { key: "equity:total", kind: "total", label: "Total Equity", amounts: sheets.map((s) => s.totalEquity), zoomIds: equityIds }));
  rows.push(spacerRow(ctx, "s-le"));
  rows.push(
    makeRow(ctx, {
      key: "le:total",
      kind: "grand",
      label: "Total Liabilities and Equity",
      amounts: sheets.map((s) => s.totalLiabilities + s.totalEquity),
      zoomIds: [...idsOf(liabilities), ...equityIds],
    }),
  );

  const unbalanced = sheets.find((s) => !s.balanced);
  return {
    title: "Balance Sheet",
    columns: [...input.columns],
    changeLabels: input.change ? ["Change", "%"] : null,
    percent: false,
    rows,
    empty: assets.length === 0 && liabilities.length === 0 && equity.length === 0 && earnings.every((e) => e === 0),
    outOfBalance: unbalanced ? unbalanced.totalAssets - (unbalanced.totalLiabilities + unbalanced.totalEquity) : null,
  };
}

/* ---------------------------------------------------------- Trial Balance */

export interface TrialBalanceStatementInput {
  columns: readonly StatementColumn[];
  tbs: readonly TrialBalance[];
  accounts: AccountIndex;
}

/** Following `reportTB`: a Debit and a Credit for every date. */
export function trialBalanceStatement(input: TrialBalanceStatementInput): Statement {
  const several = input.columns.length > 1;
  const columns: StatementColumn[] = input.columns.flatMap((c) => [
    { ...c, key: `${c.key}:dr`, label: several ? `${c.label} Debit` : "Debit" },
    { ...c, key: `${c.key}:cr`, label: several ? `${c.label} Credit` : "Credit" },
  ]);
  const ctx: Ctx = { columns, accounts: input.accounts, percentBase: null, change: false };

  const lines = new Map<string, { code: string; name: string; debit: number[]; credit: number[] }>();
  input.tbs.forEach((tb, i) => {
    for (const line of tb.lines) {
      let entry = lines.get(line.accountId);
      if (!entry) {
        entry = { code: line.accountCode, name: line.name, debit: input.tbs.map(() => 0), credit: input.tbs.map(() => 0) };
        lines.set(line.accountId, entry);
      }
      entry.debit[i] = line.debit;
      entry.credit[i] = line.credit;
    }
  });
  const order = (id: string) => {
    const type = input.accounts.get(id)?.type;
    const index = type ? ACCOUNT_TYPES.indexOf(type) : -1;
    return index === -1 ? ACCOUNT_TYPES.length : index;
  };
  const ids = [...lines.keys()].sort((a, b) => order(a) - order(b) || lines.get(a)!.code.localeCompare(lines.get(b)!.code));

  const rows = ids.map((id) => {
    const entry = lines.get(id)!;
    const row = makeRow(ctx, {
      key: `a:${id}`,
      kind: "account",
      label: labelOf(entry.code, entry.name),
      accountId: id,
      amounts: input.tbs.flatMap((_, i) => [entry.debit[i], entry.credit[i]]),
      zoomIds: [id],
    });
    // A zero side is a blank, as on any trial balance.
    row.cells = row.cells.map((cell) => (cell.amount === 0 ? { amount: null, zoom: null } : cell));
    return row;
  });

  const total = makeRow(ctx, { key: "total", kind: "grand", label: "Total", amounts: input.tbs.flatMap((tb) => [tb.totalDebit, tb.totalCredit]) });
  total.cells = total.cells.map((cell, j) => {
    const tb = input.tbs[Math.floor(j / 2)];
    const debitSide = j % 2 === 0;
    const accountIds = tb.lines.filter((l) => (debitSide ? l.debit : l.credit) > 0).map((l) => l.accountId);
    return {
      amount: cell.amount,
      zoom: accountIds.length
        ? { title: debitSide ? "Total debits" : "Total credits", accountIds, from: columns[j].from, to: columns[j].to, figure: cell.amount ?? 0 }
        : null,
    };
  });

  const unbalanced = input.tbs.find((tb) => !tb.balanced);
  return {
    title: "Trial Balance",
    columns,
    changeLabels: null,
    percent: false,
    rows: [...rows, total],
    empty: input.tbs.every((tb) => tb.lines.length === 0),
    outOfBalance: unbalanced ? unbalanced.totalDebit - unbalanced.totalCredit : null,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/statement.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add -- lib/domain/statement.ts tests/unit/statement.test.ts
printf '%s\n' "feat(statements): the Balance Sheet in the prototype's groups, and the Trial Balance by type" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 4: Budget vs Actual, Statement of Equity, and the export sheet

**Files:**
- Modify: `ctyhp-accounting/lib/domain/statement.ts` (imports; append)
- Modify: `ctyhp-accounting/lib/domain/report-export.ts` (shared cell text; `tsvFromExportSheet`)
- Test: `ctyhp-accounting/tests/unit/statement.test.ts` (append); `ctyhp-accounting/tests/unit/report-export-tsv.test.ts` (create)

**Interfaces:**
- Consumes: Tasks 2–3; `buildBudgetVsActual`, `buildStatementOfEquity`, types `BudgetVsActual`, `StatementOfEquity` (`@/lib/domain/reports`); `fromMinor` (`@/lib/domain/money`); `sanitizeExportFileName`, types `ReportExportColumn`, `ReportExportSheet` (`@/lib/domain/report-export`).
- Produces: `budgetStatement(input: BudgetStatementInput): Statement` (columns Actual, Budget; change labels Variance, %; rows `<section>:a:<id>`, `<section>:total`, `gross`, `net-income`; budget cells never zoom; `tone` on rows with figures); `equityStatement(input: EquityStatementInput): Statement` (row keys from the builder: `opening`, `activity:<id>`, `net-income`, `closing`); `statementSheet(statement, meta: StatementSheetMeta): ReportExportSheet`; `tsvFromExportSheet(sheet): string`.

- [ ] **Step 1: Append the failing tests**

In `tests/unit/statement.test.ts`, extend the imports so they read:

```ts
import {
  buildBalanceSheet,
  buildBudgetVsActual,
  buildProfitAndLoss,
  buildStatementOfEquity,
  buildTrialBalance,
  type BalanceSheet,
  type LedgerBalance,
} from "@/lib/domain/reports";
import {
  balanceSheetStatement,
  budgetStatement,
  equityStatement,
  indexAccounts,
  pnlStatement,
  statementSheet,
  trialBalanceStatement,
  type AccountRef,
  type Statement,
  type StatementColumn,
} from "@/lib/domain/statement";
```

and append:

```ts
describe("budgetStatement", () => {
  const BUDGET_ACCOUNTS = indexAccounts([
    acct("sales", "4000", "Sales", "income"),
    acct("cogs", "5000", "Cost of Goods Sold", "cost_of_goods_sold"),
    acct("rent", "6100", "Rent", "expense"),
    acct("ads", "6300", "Advertising", "expense"),
    acct("misc", "6400", "Miscellaneous", "expense"),
  ]);
  const b = (id: string, debitBase: number, creditBase: number): LedgerBalance => {
    const a = BUDGET_ACCOUNTS.get(id)!;
    return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, debitBase, creditBase };
  };
  const budgetOf = (id: string, amountMinor: number) => {
    const a = BUDGET_ACCOUNTS.get(id)!;
    return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, amountMinor };
  };
  const bva = buildBudgetVsActual(
    [b("sales", 0, 1_000_000), b("cogs", 300_000, 0), b("rent", 150_000, 0), b("misc", 0, 0)],
    [budgetOf("sales", 900_000), budgetOf("cogs", 250_000), budgetOf("rent", 200_000), budgetOf("ads", 50_000)],
  );
  const s = budgetStatement({ bva, from: "2026-01-01", to: "2026-06-30", accounts: BUDGET_ACCOUNTS });

  it("sets actual beside budget, with the builder's variance", () => {
    expect(s.columns.map((c) => c.label)).toEqual(["Actual", "Budget"]);
    expect(s.changeLabels).toEqual(["Variance", "%"]);
    for (const line of bva.lines.filter((l) => l.current !== 0 || l.prior !== 0)) {
      const r = s.rows.find((x) => x.kind === "account" && x.accountId === line.accountId);
      expect(r?.cells.map((c) => c.amount)).toEqual([line.current, line.prior]);
      expect(r?.change).toEqual({ amount: line.variance, percent: line.variancePercent });
    }
    expect(amounts(s, "net-income")).toEqual([bva.actual.netIncome, bva.budget.netIncome]);
  });

  it("colours a variance by whether it is good news", () => {
    expect(row(s, "income:a:sales")?.tone).toBe("favorable");
    expect(row(s, "opex:a:rent")?.tone).toBe("favorable");
    expect(row(s, "cogs:a:cogs")?.tone).toBe("unfavorable");
    expect(row(s, "opex:a:ads")?.tone).toBe("favorable");
    expect(row(s, "net-income")?.tone).toBe("favorable");
  });

  it("opens the actual figure and never the budget, which is not in the books", () => {
    expect(row(s, "income:a:sales")?.cells[0].zoom?.accountIds).toEqual(["sales"]);
    expect(row(s, "income:a:sales")?.cells[1].zoom).toBeNull();
  });

  it("leaves out an account with neither an actual nor a budget", () => {
    expect(s.rows.some((r) => r.accountId === "misc")).toBe(false);
  });
});

describe("equityStatement", () => {
  const EQ_ACCOUNTS = indexAccounts([
    acct("owner", "3000", "Owner's Equity", "equity"),
    acct("sales", "4000", "Sales", "income"),
    acct("rent", "6100", "Rent", "expense"),
  ]);
  const e = (id: string, debitBase: number, creditBase: number): LedgerBalance => {
    const a = EQ_ACCOUNTS.get(id)!;
    return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, debitBase, creditBase };
  };
  const soe = buildStatementOfEquity(
    [e("owner", 0, 600_000), e("sales", 0, 300_000), e("rent", 100_000, 0)],
    [e("owner", 0, 50_000), e("sales", 0, 400_000), e("rent", 150_000, 0)],
  );
  const s = equityStatement({ soe, from: "2026-01-01", to: "2026-06-30", accounts: EQ_ACCOUNTS });

  it("carries the builder's lines and closes on its ending equity", () => {
    expect(amounts(s, "opening")).toEqual([800_000]);
    expect(amounts(s, "net-income")).toEqual([250_000]);
    expect(amounts(s, "closing")).toEqual([soe.closingEquity]);
    expect(row(s, "closing")?.kind).toBe("grand");
  });

  it("opens each line onto the entries behind it", () => {
    expect(row(s, "opening")?.cells[0].zoom).toMatchObject({ from: null, to: "2025-12-31" });
    expect(row(s, "closing")?.cells[0].zoom).toMatchObject({ from: null, to: "2026-06-30" });
    expect(row(s, "net-income")?.cells[0].zoom?.accountIds).toEqual(["sales", "rent"]);
  });
});

describe("statementSheet", () => {
  const sheet = statementSheet(pair(), {
    companyName: "Harbour Test Co",
    currencyCode: "USD",
    decimals: 2,
    subtitle: "April 1, 2026 – June 30, 2026",
    fileName: "Profit and Loss 2026-04-01 to 2026-06-30",
  });

  it("names its columns as the screen does, with the % and change columns", () => {
    expect(sheet.columns.map((c) => c.header)).toEqual(["Account", "Q2 2026", "% of income", "Q1 2026", "% of income", "Change", "%"]);
    expect(sheet.fileName).toBe("Profit-and-Loss-2026-04-01-to-2026-06-30");
  });

  it("writes the figures in the currency's units, indents accounts, and leaves out the spacers", () => {
    const total = sheet.rows.find((r) => r.account === "Total Income");
    expect(total).toMatchObject({ c0: 12_000, c1: 8_000, change: 4_000, changePct: 50 });
    expect(sheet.rows.find((r) => String(r.account).trim() === "6210 Showroom Repairs")?.account).toBe("    6210 Showroom Repairs");
    expect(sheet.rows.some((r) => r.account === "")).toBe(false);
  });
});
```

`ctyhp-accounting/tests/unit/report-export-tsv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tsvFromExportSheet } from "@/lib/domain/report-export";

describe("tsvFromExportSheet", () => {
  const tsv = tsvFromExportSheet({
    fileName: "x",
    companyName: "Harbour Test Co",
    title: "Profit and Loss",
    subtitle: "April 1, 2026 – June 30, 2026",
    currencyCode: "USD",
    columns: [
      { key: "account", header: "Account" },
      { key: "amount", header: "Amount", kind: "money" },
    ],
    rows: [
      { account: "4000 Sales", amount: 12000 },
      { account: "A name\twith a tab", amount: null },
    ],
  });
  const lines = tsv.split("\n");

  it("puts the report's identity above the table", () => {
    expect(lines.slice(0, 5)).toEqual(["Harbour Test Co", "Profit and Loss", "April 1, 2026 – June 30, 2026", "Currency: USD", ""]);
  });

  it("separates columns with tabs, writes money plainly, and keeps a stray tab from splitting a cell", () => {
    expect(lines[5]).toBe("Account\tAmount");
    expect(lines[6]).toBe("4000 Sales\t12000.00");
    expect(lines[7]).toBe("A name with a tab\t");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/statement.test.ts tests/unit/report-export-tsv.test.ts`
Expected: FAIL — `budgetStatement is not a function` and `tsvFromExportSheet is not a function`.

- [ ] **Step 3: The shared cell text and TSV in `report-export.ts`**

In `ctyhp-accounting/lib/domain/report-export.ts`, replace the whole `csvFromExportSheet` function (the one at the end of the file, with its doc comment) with:

```ts
/** Decimal places the sheet's currency is written in. */
function currencyDigits(currencyCode: string): number {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

/** A value as it goes into a text export: money as a plain number in the currency's decimals, a blank as nothing. */
function exportCellText(v: string | number | null | undefined, kind: ExportCellKind, digits: number): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" && kind === "money") return v.toFixed(digits);
  return typeof v === "number" ? String(v) : v;
}

/**
 * A sheet as CSV, with the report's identity above it: what "Save as CSV"
 * hands over, from the same sheet the PDF and Excel buttons use.
 *
 * Money is written as a plain number in the currency's own decimals, without a
 * symbol or thousands separators, so a spreadsheet reads it as a number.
 */
export function csvFromExportSheet(sheet: ReportExportSheet): string {
  const cell = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  const digits = currencyDigits(sheet.currencyCode);
  const lines = [
    sheet.columns.map((c) => cell(c.header)).join(","),
    ...sheet.rows.map((r) => sheet.columns.map((c) => cell(exportCellText(r[c.key], c.kind ?? "text", digits))).join(",")),
  ];
  return csvWithReportIdentity(lines.join("\n"), sheet);
}

/**
 * A sheet as tab-separated text, for "Copy this report": pasted into a
 * spreadsheet it keeps its columns, with the report's identity above them. A
 * tab or line break inside a value would split it, so it becomes a space.
 */
export function tsvFromExportSheet(sheet: ReportExportSheet): string {
  const clean = (value: string): string => value.replace(/[\t\r\n]+/g, " ");
  const digits = currencyDigits(sheet.currencyCode);
  return [
    clean(sheet.companyName),
    clean(sheet.title),
    clean(sheet.subtitle),
    `Currency: ${sheet.currencyCode}`,
    "",
    sheet.columns.map((c) => clean(c.header)).join("\t"),
    ...sheet.rows.map((r) => sheet.columns.map((c) => clean(exportCellText(r[c.key], c.kind ?? "text", digits))).join("\t")),
  ].join("\n");
}
```

- [ ] **Step 4: Append the builders to `statement.ts`**

Replace the imports at the top of `lib/domain/statement.ts` with:

```ts
import { ACCOUNT_TYPES, statementSectionOf, type AccountType } from "@/lib/domain/accounts";
import { dayBefore } from "@/lib/domain/fiscal";
import { fromMinor } from "@/lib/domain/money";
import {
  percentOfIncome,
  type BalanceSheet,
  type BudgetVsActual,
  type ProfitAndLoss,
  type ReportSection,
  type StatementOfEquity,
  type TrialBalance,
} from "@/lib/domain/reports";
import { sanitizeExportFileName, type ReportExportColumn, type ReportExportSheet } from "@/lib/domain/report-export";
import type { StatementColumnSpec } from "@/lib/domain/statement-columns";
```

and append at the end of the file:

```ts
/* -------------------------------------------------------- Budget vs Actual */

export interface BudgetStatementInput {
  bva: BudgetVsActual;
  from: string;
  to: string;
  accounts: AccountIndex;
}

const BUDGET_SECTIONS: ReadonlyArray<{
  key: string;
  title: string;
  types: AccountType[];
  incomeSide: boolean;
  always: boolean;
  pick: (p: ProfitAndLoss) => ReportSection;
}> = [
  { key: "income", title: "Income", types: ["income"], incomeSide: true, always: true, pick: (p) => p.income },
  { key: "cogs", title: "Cost of Goods Sold", types: ["cost_of_goods_sold"], incomeSide: false, always: false, pick: (p) => p.costOfGoodsSold },
  { key: "opex", title: "Operating Expenses", types: ["expense"], incomeSide: false, always: true, pick: (p) => p.operatingExpenses },
  { key: "other-income", title: "Other Income", types: ["other_income"], incomeSide: true, always: false, pick: (p) => p.otherIncome },
  { key: "other-expenses", title: "Other Expenses", types: ["other_expense"], incomeSide: false, always: false, pick: (p) => p.otherExpenses },
];

/** Good news is more income than budgeted, or less cost — the rule `buildBudgetVsActual` applies to a line. */
function toneOf(variance: number, incomeSide: boolean): StatementTone {
  if (variance === 0) return null;
  return (incomeSide ? variance > 0 : variance < 0) ? "favorable" : "unfavorable";
}

/** Following `reportBudget`: Actual, Budget, Variance and %, by the P&L's sections. */
export function budgetStatement(input: BudgetStatementInput): Statement {
  const { bva } = input;
  const columns: StatementColumn[] = [
    { key: "actual", label: "Actual", sub: "", from: input.from, to: input.to, isTotal: false },
    { key: "budget", label: "Budget", sub: "", from: input.from, to: input.to, isTotal: false },
  ];
  const ctx: Ctx = { columns, accounts: input.accounts, percentBase: null, change: true };
  const rows: StatementRow[] = [];
  const shown = bva.lines.filter((l) => l.current !== 0 || l.prior !== 0);
  const budgetRow = (spec: RowSpec, incomeSide: boolean): StatementRow => {
    const row = makeRow(ctx, spec);
    row.cells[1] = { amount: row.cells[1].amount, zoom: null }; // a budget is not in the books
    row.tone = row.change ? toneOf(row.change.amount, incomeSide) : null;
    return row;
  };
  const sectionIds = new Map<string, string[]>();
  for (const section of BUDGET_SECTIONS) {
    const lines = shown.filter((l) => section.types.includes(l.accountType));
    sectionIds.set(section.key, lines.flatMap((l) => (l.accountId ? [l.accountId] : [])));
    if (lines.length === 0 && !section.always) continue;
    rows.push(sectionRow(ctx, section.key, section.title));
    if (lines.length === 0) {
      rows.push(noteRow(ctx, `${section.key}:note`, section.incomeSide ? "No income budgeted or earned" : "No expenses budgeted or spent"));
    }
    for (const line of lines) {
      rows.push(
        budgetRow(
          {
            key: `${section.key}:a:${line.accountId}`,
            kind: "account",
            label: labelOf(line.accountCode, line.name),
            depth: 1,
            accountId: line.accountId,
            amounts: [line.current, line.prior],
            zoomIds: line.accountId ? [line.accountId] : null,
          },
          section.incomeSide,
        ),
      );
    }
    rows.push(
      budgetRow(
        {
          key: `${section.key}:total`,
          kind: "total",
          label: `Total ${section.title}`,
          amounts: [section.pick(bva.actual).total, section.pick(bva.budget).total],
          zoomIds: sectionIds.get(section.key),
        },
        section.incomeSide,
      ),
    );
    if (section.key === "cogs") {
      rows.push(
        budgetRow(
          {
            key: "gross",
            kind: "total",
            label: "Gross Profit",
            amounts: [bva.actual.grossProfit, bva.budget.grossProfit],
            zoomIds: [...(sectionIds.get("income") ?? []), ...(sectionIds.get("cogs") ?? [])],
          },
          true,
        ),
      );
    }
    rows.push(spacerRow(ctx, `s-${section.key}`));
  }
  rows.push(
    budgetRow(
      {
        key: "net-income",
        kind: "grand",
        label: "Net Income",
        amounts: [bva.actual.netIncome, bva.budget.netIncome],
        zoomIds: [...sectionIds.values()].flat(),
      },
      true,
    ),
  );
  return { title: "Budget vs Actual", columns, changeLabels: ["Variance", "%"], percent: false, rows, empty: shown.length === 0, outOfBalance: null };
}

/* ----------------------------------------------------- Statement of Equity */

export interface EquityStatementInput {
  soe: StatementOfEquity;
  from: string;
  to: string;
  accounts: AccountIndex;
}

/** The prototype has no such report; it takes the same paper and table. */
export function equityStatement(input: EquityStatementInput): Statement {
  const columns: StatementColumn[] = [{ key: "amount", label: "Amount", sub: "", from: input.from, to: input.to, isTotal: false }];
  const ctx: Ctx = { columns, accounts: input.accounts, percentBase: null, change: false };
  const all = [...input.accounts.values()];
  const equityIds = all.filter((a) => a.type === "equity").map((a) => a.id);
  const plIds = all.filter((a) => statementSectionOf(a.type) === "profit_and_loss").map((a) => a.id);
  const rows: StatementRow[] = [];
  for (const line of input.soe.lines) {
    switch (line.kind) {
      case "opening":
        rows.push(
          makeRow(ctx, {
            key: line.key,
            kind: "account",
            label: line.label,
            amounts: [line.amount],
            zoomIds: [...equityIds, ...plIds],
            zoomRange: () => ({ from: null, to: dayBefore(input.from) }),
          }),
        );
        break;
      case "activity":
        rows.push(
          makeRow(ctx, {
            key: line.key,
            kind: "account",
            label: line.label,
            depth: 1,
            accountId: line.accountId,
            amounts: [line.amount],
            zoomIds: line.accountId ? [line.accountId] : null,
          }),
        );
        break;
      case "income":
        rows.push(makeRow(ctx, { key: line.key, kind: "account", label: line.label, amounts: [line.amount], zoomIds: plIds }));
        break;
      case "closing":
        rows.push(spacerRow(ctx, "s-closing"));
        rows.push(
          makeRow(ctx, {
            key: line.key,
            kind: "grand",
            label: line.label,
            amounts: [line.amount],
            zoomIds: [...equityIds, ...plIds],
            zoomRange: () => ({ from: null, to: input.to }),
          }),
        );
        break;
    }
  }
  const soe = input.soe;
  return {
    title: "Statement of Equity",
    columns,
    changeLabels: null,
    percent: false,
    rows,
    empty: soe.openingEquity === 0 && soe.equityActivity === 0 && soe.netIncome === 0,
    outOfBalance: null,
  };
}

/* ------------------------------------------------------------ the export */

export interface StatementSheetMeta {
  companyName: string;
  currencyCode: string;
  decimals: number;
  /** The paper's range line. */
  subtitle: string;
  fileName: string;
}

/** The statement as one sheet for PDF, Excel, CSV and Copy — the rows on screen, spacers aside. */
export function statementSheet(statement: Statement, meta: StatementSheetMeta): ReportExportSheet {
  const columns: ReportExportColumn[] = [{ key: "account", header: "Account", width: 44 }];
  statement.columns.forEach((column, i) => {
    columns.push({ key: `c${i}`, header: column.label, kind: "money", width: 16 });
    if (statement.percent) columns.push({ key: `p${i}`, header: "% of income", kind: "percent", width: 12 });
  });
  if (statement.changeLabels) {
    columns.push(
      { key: "change", header: statement.changeLabels[0], kind: "money", width: 16 },
      { key: "changePct", header: statement.changeLabels[1], kind: "percent", width: 12 },
    );
  }
  const rows = statement.rows
    .filter((r) => r.kind !== "spacer")
    .map((r) => {
      const out: Record<string, string | number | null> = { account: `${"  ".repeat(r.depth)}${r.label}` };
      r.cells.forEach((cell, i) => {
        out[`c${i}`] = cell.amount === null ? null : fromMinor(cell.amount, meta.decimals);
        if (statement.percent) out[`p${i}`] = r.percent?.[i] ?? null;
      });
      if (statement.changeLabels) {
        out.change = r.change ? fromMinor(r.change.amount, meta.decimals) : null;
        out.changePct = r.change?.percent ?? null;
      }
      return out;
    });
  return {
    fileName: sanitizeExportFileName(meta.fileName),
    companyName: meta.companyName,
    title: statement.title,
    subtitle: meta.subtitle,
    currencyCode: meta.currencyCode,
    columns,
    rows,
  };
}
```

- [ ] **Step 5: Run the tests, including the other export tests**

Run: `npx vitest run tests/unit/statement.test.ts tests/unit/report-export-tsv.test.ts tests/unit/report-export.test.ts tests/unit/csv-report-identity.test.ts`
Expected: PASS — the last two already cover `csvFromExportSheet` and `csvWithReportIdentity`, and must still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add -- lib/domain/statement.ts lib/domain/report-export.ts tests/unit/statement.test.ts tests/unit/report-export-tsv.test.ts
printf '%s\n' "feat(statements): Budget vs Actual and the Statement of Equity, and one sheet for every export" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 5: QuickZoom — the lines behind a figure

**Files:**
- Create: `ctyhp-accounting/lib/domain/zoom.ts`
- Create: `ctyhp-accounting/lib/services/zoom.ts`
- Modify: `ctyhp-accounting/app/(app)/reports/actions.ts` (append `zoomAction`)
- Test: `ctyhp-accounting/tests/unit/zoom.test.ts`, `ctyhp-accounting/tests/unit/zoom-service.test.ts`

**Interfaces:**
- Consumes: `ZoomSpec` (Task 2); `normalBalanceOf`, `AccountType` (`@/lib/domain/accounts`); `entryDisplayName` (`@/lib/domain/entry-detail`); `dayBefore` (`@/lib/domain/fiscal`); `getLedgerBalances`, `getTransactionList` (`@/lib/services/reports`).
- Produces: domain `zoomSign(figure, raw, creditNatured): 1 | -1`; `buildZoom(input: BuildZoomInput): ZoomResult`; `zoomSpecProblem(spec: unknown): string | null`; `MAX_ZOOM_ACCOUNTS = 2000`; types `ZoomLineInput`, `ZoomAccount`, `ZoomRow { key; entryId; entryNumber; entryDate; sourceType; name; detail; amount; balance: number | null }`, `ZoomResult { spec; single; opening: number | null; rows; total; matches }`. Service `getZoom(sb, spec): Promise<ZoomResult>`, `class ZoomError`. Action `zoomAction(spec: ZoomSpec): Promise<ActionResult<ZoomResult>>`.

- [ ] **Step 1: Write the failing tests**

`ctyhp-accounting/tests/unit/zoom.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ZoomSpec } from "@/lib/domain/statement";
import { buildZoom, zoomSign, zoomSpecProblem, type ZoomAccount, type ZoomLineInput } from "@/lib/domain/zoom";

const ACCOUNTS = new Map<string, ZoomAccount>([
  ["sales", { id: "sales", code: "4000", name: "Sales", type: "income" }],
  ["rent", { id: "rent", code: "6100", name: "Rent", type: "expense" }],
  ["bank", { id: "bank", code: "1000", name: "Operating Bank", type: "bank" }],
  ["fees", { id: "fees", code: "6500", name: "Bank Fees", type: "expense" }],
]);
const LABELS = new Map([...ACCOUNTS.values()].map((a) => [a.id, `${a.code} ${a.name}`]));

const line = (over: Partial<ZoomLineInput>): ZoomLineInput => ({
  lineId: "l1",
  entryId: "e1",
  entryNumber: "JE-000001",
  entryDate: "2026-04-10",
  sourceType: "manual",
  accountId: "sales",
  debitBase: 0,
  creditBase: 0,
  name: "Harbour Property Ltd",
  ...over,
});

const spec = (over: Partial<ZoomSpec>): ZoomSpec => ({
  title: "Total Income",
  accountIds: ["sales"],
  from: "2026-04-01",
  to: "2026-06-30",
  figure: 0,
  ...over,
});

describe("zoomSign", () => {
  it("follows the figure when there is one to follow, and the accounts' side when there is not", () => {
    expect(zoomSign(1_200, -1_200, true)).toBe(-1);
    expect(zoomSign(-50, -50, false)).toBe(1);
    expect(zoomSign(0, 0, true)).toBe(-1);
    expect(zoomSign(0, 0, false)).toBe(1);
  });
});

describe("buildZoom", () => {
  const args = { accounts: ACCOUNTS, labels: LABELS, entryAccounts: new Map<string, string[]>(), openingRaw: null };

  it("adds up to the figure that opened it, for an income account shown as positive", () => {
    const z = buildZoom({
      ...args,
      spec: spec({ figure: 1_200, accountIds: ["sales", "rent"] }),
      lines: [
        line({ lineId: "a", creditBase: 1_000 }),
        line({ lineId: "b", entryId: "e2", entryNumber: "JE-000002", creditBase: 300 }),
        line({ lineId: "c", entryId: "e3", entryNumber: "JE-000003", debitBase: 100 }),
      ],
    });
    expect(z.rows.map((r) => r.amount)).toEqual([1_000, 300, -100]);
    expect(z.total).toBe(1_200);
    expect(z.matches).toBe(true);
    expect(z.rows[0].detail).toBe("4000 Sales");
    expect(z.single).toBe(false);
  });

  it("runs a balance from the account's balance on the day before, for one account", () => {
    const z = buildZoom({
      ...args,
      spec: spec({ title: "6100 Rent", accountIds: ["rent"], figure: 300 }),
      openingRaw: 5_000,
      lines: [
        line({ lineId: "b", entryId: "e2", entryNumber: "JE-000002", entryDate: "2026-05-01", accountId: "rent", debitBase: 100 }),
        line({ lineId: "a", entryId: "e1", entryDate: "2026-04-01", accountId: "rent", debitBase: 200 }),
      ],
    });
    expect(z.opening).toBe(5_000);
    expect(z.rows.map((r) => [r.entryDate, r.amount, r.balance])).toEqual([
      ["2026-04-01", 200, 5_200],
      ["2026-05-01", 100, 5_300],
    ]);
    expect(z.matches).toBe(true);
  });

  it("names the other side of one account's entry, or calls it a split", () => {
    const z = buildZoom({
      ...args,
      spec: spec({ title: "1000 Operating Bank", accountIds: ["bank"], from: null, figure: -80 }),
      entryAccounts: new Map([
        ["e1", ["bank", "rent"]],
        ["e2", ["bank", "rent", "fees"]],
      ]),
      lines: [
        line({ lineId: "a", entryId: "e1", accountId: "bank", creditBase: 50 }),
        line({ lineId: "b", entryId: "e2", entryNumber: "JE-000002", accountId: "bank", creditBase: 30 }),
      ],
    });
    expect(z.rows.map((r) => r.detail)).toEqual(["6100 Rent", "— Split —"]);
    expect(z.opening).toBeNull();
    expect(z.total).toBe(-80);
  });

  it("says so when the lines do not add up to the figure", () => {
    const z = buildZoom({ ...args, spec: spec({ figure: 999 }), lines: [line({ creditBase: 1_000 })] });
    expect(z.matches).toBe(false);
  });
});

describe("zoomSpecProblem", () => {
  const ok = {
    title: "Total Income",
    accountIds: ["3f2b8c1e-7a4d-4c2b-9e1f-0a1b2c3d4e5f"],
    from: "2026-04-01",
    to: "2026-06-30",
    figure: 1200,
  };

  it("accepts a figure from a statement", () => {
    expect(zoomSpecProblem(ok)).toBeNull();
    expect(zoomSpecProblem({ ...ok, from: null })).toBeNull();
  });

  it("refuses anything that is not one", () => {
    expect(zoomSpecProblem(null)).not.toBeNull();
    expect(zoomSpecProblem({ ...ok, accountIds: [] })).not.toBeNull();
    expect(zoomSpecProblem({ ...ok, accountIds: ["JE-000001"] })).not.toBeNull();
    expect(zoomSpecProblem({ ...ok, to: "June 30" })).not.toBeNull();
    expect(zoomSpecProblem({ ...ok, from: "2026-07-01" })).not.toBeNull();
    expect(zoomSpecProblem({ ...ok, figure: 1.5 })).not.toBeNull();
    expect(zoomSpecProblem({ ...ok, accountIds: new Array(2001).fill(ok.accountIds[0]) })).not.toBeNull();
  });

  it("imports nothing that could write to the books", () => {
    expect(readFileSync("lib/domain/zoom.ts", "utf8")).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
```

`ctyhp-accounting/tests/unit/zoom-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getZoom } from "@/lib/services/zoom";

type Row = Record<string, unknown>;
type Source = Row[] | Error;
const resultOf = (s: Source) => (s instanceof Error ? { data: null, error: { message: s.message } } : { data: s, error: null });
/** One page, the way `.range(from, to)` returns it: inclusive at both ends. */
const pageOf = (s: Source, from: number, to: number) => (s instanceof Error ? resultOf(s) : resultOf(s.slice(from, to + 1)));

interface Config {
  chart: Source;
  lines: Source;
  listed: Source;
  balances: Source;
}

function fakeClient(c: Partial<Config>, rpcCalls: string[] = [], inSizes: number[] = []): SupabaseClient {
  const cfg: Config = { chart: [], lines: [], listed: [], balances: [], ...c };
  const chain = (source: Source) => {
    const builder = {
      select: () => builder,
      in: (_column: string, values: unknown[]) => {
        inSizes.push(values.length);
        return builder;
      },
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      range: async (from: number, to: number) => pageOf(source, from, to),
    };
    return builder;
  };
  return {
    from(table: string) {
      if (table === "acc_account") return chain(cfg.chart);
      if (table === "acc_journal_line") return chain(cfg.lines);
      throw new Error(`fakeClient: unhandled table "${table}"`);
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push(`${name}:${String(args.p_from)}:${String(args.p_to)}`);
      const source = name === "acc_ledger_balances" ? cfg.balances : name === "acc_transaction_list" ? cfg.listed : new Error(name);
      return { range: async (from: number, to: number) => pageOf(source, from, to) };
    },
  } as unknown as SupabaseClient;
}

const CHART = [
  { id: "sales", account_code: "4000", name: "Sales", account_type: "income" },
  { id: "bank", account_code: "1000", name: "Operating Bank", account_type: "bank" },
];
const lineRow = (i: number, over: Row = {}): Row => ({
  id: `l${String(i).padStart(5, "0")}`,
  account_id: "sales",
  debit_minor: 0,
  credit_minor: 1,
  amount_base_minor: 1,
  acc_journal_entry: { id: `e${i}`, entry_number: `JE-${i}`, entry_date: "2026-04-10", source_type: "bank" },
  ...over,
});

describe("getZoom", () => {
  it("reads every line, past a thousand, and adds them up to the figure", async () => {
    const lines = Array.from({ length: 1_001 }, (_, i) => lineRow(i));
    const z = await getZoom(fakeClient({ chart: CHART, lines }), {
      title: "4000 Sales",
      accountIds: ["sales"],
      from: null,
      to: "2026-06-30",
      figure: 1_001,
    });
    expect(z.rows).toHaveLength(1_001);
    expect(z.total).toBe(1_001);
    expect(z.matches).toBe(true);
  });

  it("asks for a long list of accounts a hundred at a time", async () => {
    const sizes: number[] = [];
    const ids = Array.from({ length: 250 }, (_, i) => `a${i}`);
    await getZoom(fakeClient({ chart: CHART }, [], sizes), { title: "x", accountIds: ids, from: null, to: "2026-06-30", figure: 0 });
    expect(sizes).toEqual([100, 100, 50]);
  });

  it("reads the opening balance only for one account with a start date", async () => {
    const calls: string[] = [];
    await getZoom(fakeClient({ chart: CHART }, calls), { title: "x", accountIds: ["sales"], from: "2026-04-01", to: "2026-06-30", figure: 0 });
    expect(calls).toContain("acc_ledger_balances:null:2026-03-31");
    const many: string[] = [];
    await getZoom(fakeClient({ chart: CHART }, many), { title: "x", accountIds: ["sales", "bank"], from: "2026-04-01", to: "2026-06-30", figure: 0 });
    expect(many.some((c) => c.startsWith("acc_ledger_balances"))).toBe(false);
  });

  it("names each line as the transaction list does", async () => {
    const z = await getZoom(
      fakeClient({
        chart: CHART,
        lines: [lineRow(1)],
        listed: [{ entry_id: "e1", entry_number: "JE-1", entry_date: "2026-04-10", description: "Zelle payment", source_type: "bank", party_name: null, amount_minor: 1, currency_code: "USD", account_ids: ["sales", "bank"] }],
      }),
      { title: "4000 Sales", accountIds: ["sales"], from: "2026-04-01", to: "2026-06-30", figure: 1 },
    );
    expect(z.rows[0]).toMatchObject({ name: "Zelle payment", detail: "1000 Operating Bank" });
  });

  it("fails whole when the lines cannot be read", async () => {
    await expect(
      getZoom(fakeClient({ chart: CHART, lines: new Error("timeout") }), { title: "x", accountIds: ["sales"], from: null, to: "2026-06-30", figure: 0 }),
    ).rejects.toThrow("timeout");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/zoom.test.ts tests/unit/zoom-service.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/zoom"`.

- [ ] **Step 3: The domain module**

`ctyhp-accounting/lib/domain/zoom.ts`:

```ts
/**
 * QuickZoom: the posted lines behind one figure of a statement (the
 * prototype's `drillDetail`). The list must add up to the figure that opened
 * it; this is where that is decided, and checked.
 *
 * Pure: lines already read come in; rows, a running balance and the check come
 * out. Amounts are base-currency minor units.
 */

import { normalBalanceOf, type AccountType } from "@/lib/domain/accounts";
import type { ZoomSpec } from "@/lib/domain/statement";

export interface ZoomLineInput {
  lineId: string;
  entryId: string;
  entryNumber: string;
  entryDate: string;
  sourceType: string;
  accountId: string;
  /** Base currency, read as `acc_ledger_balances` reads it. */
  debitBase: number;
  creditBase: number;
  /** Who the entry was with, as the transaction list names it. */
  name: string;
}

export interface ZoomAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
}

export interface ZoomRow {
  key: string;
  entryId: string;
  entryNumber: string;
  entryDate: string;
  sourceType: string;
  name: string;
  /** The account, for a total; the other side of the entry, for one account. */
  detail: string;
  amount: number;
  /** For one account: its balance after this line. */
  balance: number | null;
}

export interface ZoomResult {
  spec: ZoomSpec;
  single: boolean;
  /** For one account with a start date: its balance the day before, on the statement's side. */
  opening: number | null;
  rows: ZoomRow[];
  total: number;
  /** Whether the rows add up to the figure that opened them. */
  matches: boolean;
}

/**
 * The sign the list is shown with, so it adds up to the figure: the
 * prototype's `dsign`. A statement shows income, liabilities and equity as
 * positive although the ledger holds them as credits.
 */
export function zoomSign(figure: number, raw: number, creditNatured: boolean): 1 | -1 {
  if (figure !== 0 && raw !== 0) return figure < 0 === raw < 0 ? 1 : -1;
  return creditNatured ? -1 : 1;
}

export interface BuildZoomInput {
  spec: ZoomSpec;
  lines: readonly ZoomLineInput[];
  accounts: ReadonlyMap<string, ZoomAccount>;
  /** Every account's "code name", to name the other side of an entry. */
  labels: ReadonlyMap<string, string>;
  /** Per entry, the accounts it touched. */
  entryAccounts: ReadonlyMap<string, readonly string[]>;
  /** For one account with a start date: its debit less credit before the start. */
  openingRaw: number | null;
}

function otherSide(input: BuildZoomInput, entryId: string, accountId: string): string {
  const others = [...new Set((input.entryAccounts.get(entryId) ?? []).filter((id) => id !== accountId))];
  if (others.length === 0) return "";
  if (others.length === 1) return input.labels.get(others[0]) ?? "";
  return "— Split —";
}

export function buildZoom(input: BuildZoomInput): ZoomResult {
  const { spec } = input;
  const single = spec.accountIds.length === 1;
  const raw = input.lines.reduce((sum, l) => sum + l.debitBase - l.creditBase, 0);
  const creditNatured = spec.accountIds.every((id) => {
    const account = input.accounts.get(id);
    return account ? normalBalanceOf(account.type) === "credit" : false;
  });
  const sign = zoomSign(spec.figure, raw, creditNatured);
  const sorted = [...input.lines].sort(
    (a, b) => a.entryDate.localeCompare(b.entryDate) || a.entryNumber.localeCompare(b.entryNumber) || a.lineId.localeCompare(b.lineId),
  );
  const opening = single && spec.from !== null && input.openingRaw !== null ? input.openingRaw * sign : null;
  let balance = opening ?? 0;
  const rows = sorted.map((l): ZoomRow => {
    const amount = (l.debitBase - l.creditBase) * sign;
    balance += amount;
    return {
      key: l.lineId,
      entryId: l.entryId,
      entryNumber: l.entryNumber,
      entryDate: l.entryDate,
      sourceType: l.sourceType,
      name: l.name,
      detail: single ? otherSide(input, l.entryId, l.accountId) : (input.labels.get(l.accountId) ?? ""),
      amount,
      balance: single ? balance : null,
    };
  });
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return { spec, single, opening, rows, total, matches: total === spec.figure };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A sanity bound on one request, far above any chart OneBook holds: the
 * service reads the accounts in batches, so the limit is not the URL's.
 */
export const MAX_ZOOM_ACCOUNTS = 2000;

/** Why a zoom request is not one a statement could have made, or null when it is. */
export function zoomSpecProblem(spec: unknown): string | null {
  if (!spec || typeof spec !== "object") return "That is not a figure on a report.";
  const s = spec as Partial<ZoomSpec>;
  if (typeof s.title !== "string" || s.title.length === 0 || s.title.length > 200) return "The figure has no name.";
  if (!Array.isArray(s.accountIds) || s.accountIds.length === 0) return "That figure has no accounts behind it.";
  if (s.accountIds.length > MAX_ZOOM_ACCOUNTS) {
    return `That figure draws on more than ${MAX_ZOOM_ACCOUNTS} accounts. Open one of its lines instead.`;
  }
  if (!s.accountIds.every((id) => typeof id === "string" && UUID.test(id))) return "That figure names an account that is not one.";
  if (s.from !== null && (typeof s.from !== "string" || !ISO_DATE.test(s.from))) return "The start date is not a date.";
  if (typeof s.to !== "string" || !ISO_DATE.test(s.to)) return "The end date is not a date.";
  if (s.from !== null && s.from > s.to) return "The start date is after the end date.";
  if (typeof s.figure !== "number" || !Number.isSafeInteger(s.figure)) return "The figure is not an amount.";
  return null;
}
```

Note: the `buildZoom` tests use short ids like `"sales"`; only `zoomSpecProblem` requires UUIDs, and the action is the only caller that applies it.

- [ ] **Step 4: The service**

`ctyhp-accounting/lib/services/zoom.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "@/lib/domain/accounts";
import { entryDisplayName } from "@/lib/domain/entry-detail";
import { dayBefore } from "@/lib/domain/fiscal";
import type { ZoomSpec } from "@/lib/domain/statement";
import { buildZoom, type ZoomAccount, type ZoomResult } from "@/lib/domain/zoom";
import { getLedgerBalances, getTransactionList } from "@/lib/services/reports";

/**
 * Reading the lines behind a statement figure. Every call here reads; nothing
 * writes, and any failed read fails the zoom — a list missing a page would not
 * add up, and would say the books are wrong when they are not.
 */
export class ZoomError extends Error {}

const PAGE = 1000;

type ChartRow = { id: string; account_code: string; name: string; account_type: AccountType };
type LineRow = {
  id: string;
  account_id: string;
  debit_minor: number;
  credit_minor: number;
  amount_base_minor: number;
  acc_journal_entry: { id: string; entry_number: string; entry_date: string; source_type: string };
};
type PageResult = { data: unknown; error: { message: string } | null };

async function readAll<T>(label: string, page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await page(start, start + PAGE - 1);
    if (error) throw new ZoomError(`Reading ${label} failed: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

function readChart(sb: SupabaseClient): Promise<ChartRow[]> {
  return readAll<ChartRow>("the chart of accounts", (f, t) =>
    sb.from("acc_account").select("id,account_code,name,account_type").order("account_code").range(f, t),
  );
}

/**
 * Accounts per request. A total can stand on every account in a section, and
 * each id is 37 characters of query string; a hundred keeps the URL well
 * inside what the API gateway accepts.
 */
const ACCOUNTS_PER_READ = 100;

async function readLines(sb: SupabaseClient, spec: ZoomSpec): Promise<LineRow[]> {
  const rows: LineRow[] = [];
  for (let i = 0; i < spec.accountIds.length; i += ACCOUNTS_PER_READ) {
    const ids = spec.accountIds.slice(i, i + ACCOUNTS_PER_READ);
    rows.push(
      ...(await readAll<LineRow>("the entries", (f, t) => {
        let q = sb
          .from("acc_journal_line")
          .select("id,account_id,debit_minor,credit_minor,amount_base_minor,acc_journal_entry!inner(id,entry_number,entry_date,source_type)")
          .in("account_id", ids)
          .eq("acc_journal_entry.status", "posted")
          .lte("acc_journal_entry.entry_date", spec.to);
        if (spec.from) q = q.gte("acc_journal_entry.entry_date", spec.from);
        return q.order("id").range(f, t);
      })),
    );
  }
  return rows;
}

export async function getZoom(sb: SupabaseClient, spec: ZoomSpec): Promise<ZoomResult> {
  const single = spec.accountIds.length === 1;
  const [chart, lines, before] = await Promise.all([
    readChart(sb),
    readLines(sb, spec),
    single && spec.from ? getLedgerBalances(sb, null, dayBefore(spec.from)) : Promise.resolve(null),
  ]);
  // Names and the other side of each entry, read only over the dates the lines span.
  const earliest = lines
    .map((l) => String(l.acc_journal_entry.entry_date).slice(0, 10))
    .reduce((min, date) => (date < min ? date : min), spec.to);
  const listed = lines.length > 0 ? await getTransactionList(sb, spec.from ?? earliest, spec.to) : [];
  const accounts = new Map<string, ZoomAccount>(
    chart.map((a) => [a.id, { id: a.id, code: a.account_code, name: a.name, type: a.account_type }]),
  );
  const labels = new Map(chart.map((a) => [a.id, `${a.account_code} ${a.name}`]));
  const names = new Map(listed.map((r) => [r.entryId, entryDisplayName(r)]));
  const entryAccounts = new Map(listed.map((r) => [r.entryId, r.accountIds]));
  const opening = before?.find((b) => b.accountId === spec.accountIds[0]);
  return buildZoom({
    spec,
    accounts,
    labels,
    entryAccounts,
    openingRaw: before ? (opening ? opening.debitBase - opening.creditBase : 0) : null,
    lines: lines.map((l) => ({
      lineId: l.id,
      entryId: l.acc_journal_entry.id,
      entryNumber: l.acc_journal_entry.entry_number,
      entryDate: String(l.acc_journal_entry.entry_date).slice(0, 10),
      sourceType: l.acc_journal_entry.source_type,
      accountId: l.account_id,
      // Base currency, read exactly as acc_ledger_balances reads it.
      debitBase: Number(l.debit_minor) > 0 ? Number(l.amount_base_minor) : 0,
      creditBase: Number(l.credit_minor) > 0 ? Number(l.amount_base_minor) : 0,
      name: names.get(l.acc_journal_entry.id) ?? "",
    })),
  });
}
```

- [ ] **Step 5: The action**

In `ctyhp-accounting/app/(app)/reports/actions.ts` add to the imports:

```ts
import type { ZoomSpec } from "@/lib/domain/statement";
import { zoomSpecProblem, type ZoomResult } from "@/lib/domain/zoom";
import { getZoom } from "@/lib/services/zoom";
```

and append:

```ts
/** The posted lines behind one figure of a statement. Reads only. */
export async function zoomAction(spec: ZoomSpec): Promise<ActionResult<ZoomResult>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  const problem = zoomSpecProblem(spec);
  if (problem) return { ok: false, error: problem };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getZoom(sb, spec) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The entries could not be read." };
  }
}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run tests/unit/zoom.test.ts tests/unit/zoom-service.test.ts` then `npm run typecheck`
Expected: PASS, 14 tests; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add -- lib/domain/zoom.ts lib/services/zoom.ts "app/(app)/reports/actions.ts" tests/unit/zoom.test.ts tests/unit/zoom-service.test.ts
printf '%s\n' "feat(statements): a QuickZoom that reads the lines behind a figure and proves they add up to it" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 6: The statement table, its styles, and printing

**Files:**
- Create: `ctyhp-accounting/components/reports/StatementTable.tsx`
- Create: `ctyhp-accounting/lib/client/print-report.ts`
- Modify: `ctyhp-accounting/components/reports/report-paper.module.css` (append)
- Modify: `ctyhp-accounting/app/globals.css` (append a print block)

**Interfaces:**
- Consumes: `Statement`, `StatementRow`, `ZoomSpec` (Task 2); `formatPercent` (`@/lib/format`).
- Produces: `StatementTable` default export, props `{ statement: Statement; money: (minor: number) => string; onZoom: (spec: ZoomSpec) => void }`; `printReport(): void`; the global class `report-print-area` (the element to print); CSS module classes `rptScroll rpt l r pct thSub rSection rClasshead rSub rTotal rGrand rSpacer rNote ind0 ind1 ind2 ind3 zoom zoomNeg favorable unfavorable outOfBalance zoomTotal`.

- [ ] **Step 1: Append the statement styles**

Append to `ctyhp-accounting/components/reports/report-paper.module.css`:

```css
/* ---------- a financial statement (the prototype's table.rpt) ----------
 * A statement is not a list: nothing on it is sorted, filtered or paged. So it
 * is a plain table, ruled the way a printed statement is ruled. */
.rptScroll {
  overflow-x: auto;
}

.rpt {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.rpt th {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--ob-text-secondary);
  text-align: right;
  padding: 0 0 6px 20px;
  border-bottom: 1px solid var(--ob-border-muted);
  vertical-align: bottom;
  white-space: nowrap;
}

.rpt th.l {
  text-align: left;
  padding-left: 0;
}

.thSub {
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  margin-top: 1px;
}

.rpt td {
  padding: 3px 0;
  vertical-align: top;
  color: var(--ob-text-body);
}

.rpt td.r {
  text-align: right;
  white-space: nowrap;
  padding-left: 20px;
}

.rpt td.pct {
  color: var(--ob-text-secondary);
  font-size: 11.5px;
  text-align: right;
  padding-left: 12px;
  white-space: nowrap;
}

.rpt td.ind0 {
  padding-left: 0;
}

.rpt td.ind1 {
  padding-left: 16px;
}

.rpt td.ind2 {
  padding-left: 32px;
}

.rpt td.ind3 {
  padding-left: 48px;
}

.rSection td {
  padding-top: 20px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--ob-text-heading);
}

.rClasshead td {
  padding-top: 10px;
  font-weight: 600;
  background: var(--ob-surface-subtle);
}

.rpt .rClasshead td:first-child {
  padding-left: 8px;
}

.rSub td {
  border-top: 1px solid var(--ob-border-default);
  font-weight: 600;
  padding-top: 4px;
}

.rTotal td {
  border-top: 1px solid var(--ob-border-muted);
  font-weight: 600;
  padding-top: 5px;
}

.rGrand td {
  border-top: 1px solid var(--ob-border-muted);
  border-bottom: 3px double var(--ob-border-muted);
  font-weight: 700;
  padding-top: 6px;
  padding-bottom: 6px;
  font-size: 13.5px;
}

.rSpacer td {
  height: 9px;
  padding: 0;
}

.rNote td {
  color: var(--ob-text-secondary);
}

/* Every figure is a QuickZoom (the prototype's .zoom). */
.zoom {
  background: none;
  border: 0;
  padding: 1px 3px;
  margin: -1px -3px -1px 0;
  cursor: pointer;
  font: inherit;
  color: var(--ob-intent-primary);
  border-radius: 3px;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--ob-intent-primary) 35%, transparent);
  text-underline-offset: 2.5px;
  text-decoration-thickness: 1px;
}

.zoom:hover {
  background: var(--ob-accent-wash);
  text-decoration-color: currentColor;
}

.zoom:focus-visible {
  outline: 2px solid var(--ob-intent-primary);
  outline-offset: 1px;
}

.zoomNeg {
  color: var(--ob-money-negative);
  text-decoration-color: color-mix(in srgb, var(--ob-money-negative) 35%, transparent);
}

.favorable {
  color: var(--ob-intent-success);
}

.unfavorable {
  color: var(--ob-intent-danger);
}

.outOfBalance {
  margin-top: 12px;
}

.zoomTotal {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  font-size: 13px;
  color: var(--ob-text-secondary);
}

.zoomTotal strong {
  color: var(--ob-text-heading);
}
```

- [ ] **Step 2: The print block**

Append to `ctyhp-accounting/app/globals.css`:

```css
/* Printing a report prints the report (lib/client/print-report.ts): everything
 * else on the page — navigation, toolbar, floating buttons — is hidden, and the
 * report starts at the top of the sheet. */
@media print {
  body.print-report * {
    visibility: hidden;
  }

  body.print-report .report-print-area,
  body.print-report .report-print-area * {
    visibility: visible;
  }

  body.print-report .report-print-area {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
  }
}
```

- [ ] **Step 3: `printReport`**

`ctyhp-accounting/lib/client/print-report.ts`:

```ts
/**
 * Print the report on screen and nothing else (the `@media print` block in
 * app/globals.css hides the rest of the page while `print-report` is set).
 *
 * A dark theme would print pale text on white paper, so the light theme is put
 * on for the print and the reader's own choice put back afterwards.
 */
export function printReport(): void {
  const body = document.body;
  const root = document.documentElement;
  const theme = root.getAttribute("data-theme");
  body.classList.add("print-report");
  root.setAttribute("data-theme", "light");
  const done = () => {
    body.classList.remove("print-report");
    if (theme === null) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
```

> **Changed in review (commit 1122712):** forcing `data-theme` raced `ThemeProvider`, which owns that attribute. `print-report.ts` now never touches the theme: it exports `printReport()` (sets the `print-report` body class around `window.print()`) and `watchReportPrinting()` (the same class on `beforeprint`/`afterprint`, for Ctrl+P). The paper takes the light palette while printing because `cssVariableBlock()` in `lib/design/tokens.ts` gives the light rule the selector `:root, body.print-report .report-print-area`. The table also colours a negative change or % of income in the danger colour.

- [ ] **Step 4: The table**

`ctyhp-accounting/components/reports/StatementTable.tsx`:

```tsx
"use client";

import { Fragment, type ReactNode } from "react";
import { formatPercent } from "@/lib/format";
import type { Statement, StatementRow, ZoomSpec } from "@/lib/domain/statement";
import styles from "./report-paper.module.css";

const ROW_CLASS: Record<StatementRow["kind"], string | undefined> = {
  section: styles.rSection,
  classhead: styles.rClasshead,
  account: undefined,
  subtotal: styles.rSub,
  total: styles.rTotal,
  grand: styles.rGrand,
  spacer: styles.rSpacer,
  note: styles.rNote,
};

const INDENT = [styles.ind0, styles.ind1, styles.ind2, styles.ind3];

const TONE_CLASS = { favorable: styles.favorable, unfavorable: styles.unfavorable } as const;

/** A percentage cell: blank when there is no percentage to give (nothing to divide by). */
const percentText = (value: number | null | undefined): string => (value == null ? "" : formatPercent(value));

/**
 * A statement as the client's prototype prints one (`table.rpt`): sections in
 * small capitals, accounts indented under their parent, a rule over each total
 * and a double rule under the last. Every figure with something behind it is a
 * QuickZoom; an account's name opens its General Ledger in a new tab.
 */
export default function StatementTable({
  statement,
  money,
  onZoom,
}: {
  statement: Statement;
  money: (minor: number) => string;
  onZoom: (spec: ZoomSpec) => void;
}) {
  const { columns, percent, changeLabels } = statement;
  const width = 1 + columns.length * (percent ? 2 : 1) + (changeLabels ? 2 : 0);
  const first = columns[0];
  const ledgerHref = (accountId: string) =>
    `/reports/general-ledger?account=${accountId}${first.from ? `&from=${first.from}` : ""}&to=${first.to}`;

  const amount = (row: StatementRow, i: number): ReactNode => {
    const cell = row.cells[i];
    if (cell.amount === null) return "";
    const text = money(cell.amount);
    const negative = cell.amount < 0;
    if (!cell.zoom) return <span className={negative ? styles.negative : undefined}>{text}</span>;
    const zoom = cell.zoom;
    return (
      <button
        type="button"
        className={`${styles.zoom}${negative ? ` ${styles.zoomNeg}` : ""}`}
        onClick={() => onZoom(zoom)}
        title="Open the entries behind this figure"
        aria-label={`${row.label}, ${columns[i].label}: ${text}. Open the entries behind it.`}
      >
        {text}
      </button>
    );
  };

  return (
    <div className={styles.rptScroll}>
      <table className={styles.rpt}>
        <thead>
          <tr>
            <th className={styles.l}>Account</th>
            {columns.map((c) => (
              <Fragment key={c.key}>
                <th>
                  {c.label}
                  {c.sub ? <div className={styles.thSub}>{c.sub}</div> : null}
                </th>
                {percent ? <th>%</th> : null}
              </Fragment>
            ))}
            {changeLabels ? (
              <>
                <th>{changeLabels[0]}</th>
                <th>{changeLabels[1]}</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {statement.rows.map((row) => {
            if (row.kind === "spacer") {
              return (
                <tr key={row.key} className={styles.rSpacer} aria-hidden>
                  <td colSpan={width} />
                </tr>
              );
            }
            if (row.kind === "section") {
              return (
                <tr key={row.key} className={styles.rSection}>
                  <td colSpan={width}>{row.label}</td>
                </tr>
              );
            }
            const label =
              row.kind === "account" && row.accountId ? (
                <a
                  className={styles.accountLink}
                  href={ledgerHref(row.accountId)}
                  target="_blank"
                  rel="noopener"
                  title="Open this account's ledger in a new tab"
                >
                  {row.label}
                </a>
              ) : (
                row.label
              );
            const tone = row.tone ? ` ${TONE_CLASS[row.tone]}` : "";
            return (
              <tr key={row.key} className={ROW_CLASS[row.kind]}>
                <td className={INDENT[row.depth]}>{label}</td>
                {columns.map((c, i) => (
                  <Fragment key={c.key}>
                    <td className={styles.r}>{amount(row, i)}</td>
                    {percent ? <td className={styles.pct}>{percentText(row.percent?.[i])}</td> : null}
                  </Fragment>
                ))}
                {changeLabels ? (
                  <>
                    <td className={`${styles.r}${tone}`}>{row.change ? money(row.change.amount) : ""}</td>
                    <td className={`${styles.pct}${tone}`}>{percentText(row.change?.percent)}</td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck, lint and the gates**

Run: `npm run typecheck`, `npx eslint components/reports/StatementTable.tsx lib/client/print-report.ts`, then `npx vitest run tests/unit/no-hardcoded-color.test.ts tests/unit/table-adoption.test.ts tests/unit/design-tokens.test.ts`
Expected: all exit 0 / PASS.

- [ ] **Step 6: Commit**

```bash
git add -- components/reports/StatementTable.tsx components/reports/report-paper.module.css lib/client/print-report.ts app/globals.css
printf '%s\n' "feat(statements): a statement ruled like a printed one, every figure a link, and a print that prints only it" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 7: The zoom sheet and the report toolbar

**Files:**
- Create: `ctyhp-accounting/components/reports/ZoomSheet.tsx`
- Create: `ctyhp-accounting/components/reports/ReportToolbar.tsx`

**Interfaces:**
- Consumes: `zoomAction` (Task 5); `ZoomResult`, `ZoomRow` (Task 5); `ZoomSpec` (Task 2); `COMPARE_OPTIONS`, `CompareMode` (Task 1); `printReport` (Task 6); `tsvFromExportSheet`, `csvFromExportSheet` (Task 4); existing `EntryDetailDrawer`, `SourceTag`/`reportPaperStyles` (`ReportPaper.tsx`), `DataTable`, `flexColumn`, `COLUMN`, `FilterBar`, `ReportAudienceToggle`, `ReportExportButtons`, `downloadTextFile`, `PERIOD_PRESETS`, `PERCENT_OF_INCOME_TOOLTIP`, `FiscalMonth`.
- Produces: `ZoomSheet` default export, props `{ spec: ZoomSpec | null; onClose: () => void; money: (minor: number) => string }`. `ReportToolbar` default export, props `ReportToolbarProps` (below); `REPORT_OPTIONS`.

- [ ] **Step 1: The zoom sheet**

`ctyhp-accounting/components/reports/ZoomSheet.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Alert, Drawer, Skeleton } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import EntryDetailDrawer from "@/components/reports/EntryDetailDrawer";
import { SourceTag, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import { COLUMN } from "@/lib/design/table-metrics";
import { dayBefore } from "@/lib/domain/fiscal";
import { longDate, rangeText, shortDate } from "@/lib/domain/report-presets";
import type { ZoomSpec } from "@/lib/domain/statement";
import type { ZoomResult, ZoomRow } from "@/lib/domain/zoom";
import { zoomAction } from "@/app/(app)/reports/actions";

/**
 * QuickZoom (the prototype's `drillDetail`): every posted line behind the
 * figure that was clicked, adding up to it. A line opens the whole entry on
 * top; closing that comes back here.
 */
export default function ZoomSheet({
  spec,
  onClose,
  money,
}: {
  spec: ZoomSpec | null;
  onClose: () => void;
  money: (minor: number) => string;
}) {
  const [loaded, setLoaded] = useState<{ spec: ZoomSpec; result: ZoomResult | null; error: string | null } | null>(null);
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    zoomAction(spec)
      .then((r) => {
        if (cancelled) return;
        setLoaded(
          r.ok && r.data
            ? { spec, result: r.data, error: null }
            : { spec, result: null, error: r.error ?? "The entries could not be read." },
        );
      })
      .catch(() => {
        // A dropped connection rejects rather than returning an error; say so instead of spinning.
        if (!cancelled) {
          setLoaded({ spec, result: null, error: "The entries could not be read. Check the connection and try again." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [spec]);

  // What was read for an earlier figure is not this one's.
  const current = loaded && loaded.spec === spec ? loaded : null;
  const result = current?.result ?? null;
  const error = current?.error ?? null;

  const dates = spec ? (spec.from ? rangeText(spec.from, spec.to) : `All dates through ${longDate(spec.to)}`) : "";
  const columns = [
    { title: "Date", key: "date", width: 108, render: (_: unknown, r: ZoomRow) => shortDate(r.entryDate) },
    {
      title: "Type",
      key: "type",
      width: 170,
      render: (_: unknown, r: ZoomRow) => <SourceTag sourceType={r.sourceType} number={r.entryNumber} />,
    },
    flexColumn<ZoomRow>({ title: "Name", key: "name", floor: 140, render: (_, r) => <span title={r.name}>{r.name || "—"}</span> }),
    flexColumn<ZoomRow>({
      title: result?.single ? "Split" : "Account",
      key: "detail",
      floor: 120,
      render: (_, r) => (
        <span className={styles.muted} title={r.detail}>
          {r.detail}
        </span>
      ),
    }),
    {
      title: "Amount",
      key: "amount",
      width: COLUMN.MONEY_WIDE,
      align: "right" as const,
      render: (_: unknown, r: ZoomRow) => <span className={r.amount < 0 ? styles.negative : undefined}>{money(r.amount)}</span>,
    },
    ...(result?.single
      ? [
          {
            title: "Balance",
            key: "balance",
            width: COLUMN.MONEY_WIDE,
            align: "right" as const,
            render: (_: unknown, r: ZoomRow) => (r.balance === null ? "" : money(r.balance)),
          },
        ]
      : []),
  ];

  return (
    <Drawer
      open={spec !== null}
      onClose={onClose}
      size={860}
      destroyOnHidden
      title={
        <div>
          <div className={styles.sheetTitle}>{spec?.title}</div>
          <div className={styles.sheetSub}>{dates} · Accrual basis</div>
        </div>
      }
    >
      {error ? (
        <Alert type="error" showIcon title={error} />
      ) : !result ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <>
          {!result.matches ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              title={`These lines add up to ${money(result.total)}, not the ${money(result.spec.figure)} on the statement.`}
              description="The books changed between the statement and this list. Run the report again."
            />
          ) : null}
          {result.opening !== null && spec?.from ? (
            <p className={styles.muted}>
              Balance on {shortDate(dayBefore(spec.from))}: {money(result.opening)}
            </p>
          ) : null}
          {/* `rows`: paged in the browser, since a total over all dates can stand on thousands of lines. */}
          <DataTable<ZoomRow>
            rowKey="key"
            rows={result.rows}
            columns={columns}
            rowClassName={() => styles.clickable}
            onRow={(r) => ({ onClick: () => setOpenEntry(r.entryId), title: "Open this entry" })}
            emptyTitle="No entries"
            emptyDescription="Nothing was posted to these accounts in these dates."
          />
          <div className={styles.zoomTotal}>
            <span>{result.rows.length.toLocaleString("en-US")} lines</span>
            <strong>Total {money(result.total)}</strong>
          </div>
        </>
      )}
      <EntryDetailDrawer entryId={openEntry} onClose={() => setOpenEntry(null)} />
    </Drawer>
  );
}
```

- [ ] **Step 2: The toolbar**

`ctyhp-accounting/components/reports/ReportToolbar.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { App, Button, DatePicker, InputNumber, Select, Space, Switch, Tooltip } from "antd";
import { CopyOutlined, PrinterOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import { ReportAudienceToggle } from "@/components/reports/ReportAudience";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import { reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import { downloadTextFile } from "@/lib/client/download";
import { printReport } from "@/lib/client/print-report";
import type { FiscalMonth } from "@/lib/domain/fiscal";
import type { InternalReportId } from "@/lib/domain/report-catalog";
import { csvFromExportSheet, tsvFromExportSheet, type ReportExportSheet } from "@/lib/domain/report-export";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/domain/report-presets";
import { PERCENT_OF_INCOME_TOOLTIP } from "@/lib/domain/reports";
import { COMPARE_OPTIONS, type CompareMode } from "@/lib/domain/statement-columns";

export const REPORT_OPTIONS: { value: InternalReportId; label: string }[] = [
  { value: "pnl", label: "Profit and Loss" },
  { value: "balance", label: "Balance Sheet" },
  { value: "trial", label: "Trial Balance" },
  { value: "budget", label: "Budget vs Actual" },
  { value: "equity", label: "Statement of Equity" },
];

export type ToolbarDates =
  | {
      /** "point": the To date is As of, and From is Columns from (shown only for a column per period). */
      kind: "range" | "point";
      preset: PeriodPreset;
      from: string;
      to: string;
      showFrom: boolean;
      onPreset: (preset: PeriodPreset) => void;
      onFrom: (date: string) => void;
      onTo: (date: string) => void;
    }
  | {
      /** A budget is kept by fiscal month. */
      kind: "budget";
      fiscalYear: number;
      months: FiscalMonth[];
      fromPeriod: number;
      toPeriod: number;
      onFiscalYear: (year: number) => void;
      onFromPeriod: (period: number) => void;
      onToPeriod: (period: number) => void;
    };

export interface ReportToolbarProps {
  report: InternalReportId;
  onReportChange: (next: InternalReportId) => void;
  dates: ToolbarDates;
  compare: { value: CompareMode; onChange: (mode: CompareMode) => void } | null;
  percent: { value: boolean; onChange: (show: boolean) => void } | null;
  extraActions?: ReactNode;
  onRun: () => void;
  loading: boolean;
  /** What the actions hand over; null while there is nothing to hand over. */
  sheet: ReportExportSheet | null;
}

/**
 * The report toolbar of the client's prototype (`renderReports`): which
 * statement, the period, the dates, Compare, then the actions — Copy this
 * report, CSV, PDF, Excel, Print.
 */
export default function ReportToolbar(props: ReportToolbarProps) {
  const { message } = App.useApp();
  const { dates, sheet, loading } = props;
  const idle = !sheet || loading;

  const copy = async () => {
    if (!sheet) return;
    try {
      await navigator.clipboard.writeText(tsvFromExportSheet(sheet));
      message.success("Copied. Paste it into a spreadsheet and the columns stay.");
    } catch {
      message.error("The browser would not let this page copy. Use CSV instead.");
    }
  };

  const label = (text: string) => <span className={styles.muted}>{text}</span>;

  return (
    <FilterBar
      ariaLabel="Report options and actions"
      actions={
        <Space wrap>
          {props.extraActions}
          <Button icon={<CopyOutlined />} disabled={idle} onClick={() => void copy()}>
            Copy this report
          </Button>
          <Button disabled={idle} onClick={() => sheet && downloadTextFile(`${sheet.fileName}.csv`, csvFromExportSheet(sheet))}>
            CSV
          </Button>
          {sheet ? <ReportExportButtons sheet={sheet} disabled={loading} /> : null}
          <Button icon={<PrinterOutlined />} disabled={idle} onClick={printReport}>
            Print
          </Button>
        </Space>
      }
    >
      <ReportAudienceToggle />
      <Select<InternalReportId>
        aria-label="Report"
        value={props.report}
        onChange={props.onReportChange}
        options={REPORT_OPTIONS}
        style={{ width: 190 }}
      />
      {dates.kind === "budget" ? (
        <>
          <InputNumber
            aria-label="Fiscal year"
            prefix={label("FY")}
            min={2000}
            max={2100}
            value={dates.fiscalYear}
            onChange={(value) => dates.onFiscalYear(Number(value ?? dates.fiscalYear))}
            style={{ width: 120 }}
          />
          <Select<number>
            aria-label="Budget start period"
            value={dates.fromPeriod}
            onChange={dates.onFromPeriod}
            options={dates.months.map((m) => ({ value: m.period, label: `From ${m.label}` }))}
            style={{ width: 145 }}
          />
          <Select<number>
            aria-label="Budget end period"
            value={dates.toPeriod}
            onChange={dates.onToPeriod}
            options={dates.months.map((m) => ({ value: m.period, label: `To ${m.label}` }))}
            style={{ width: 135 }}
          />
        </>
      ) : (
        <>
          <Select<PeriodPreset>
            aria-label="Period"
            value={dates.preset}
            onChange={dates.onPreset}
            options={PERIOD_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
            style={{ width: 150 }}
          />
          {dates.showFrom ? (
            <DatePicker
              aria-label={dates.kind === "point" ? "Columns from" : "From"}
              prefix={label(dates.kind === "point" ? "Columns from" : "From")}
              value={dayjs(dates.from)}
              allowClear={false}
              onChange={(d) => d && dates.onFrom(d.format("YYYY-MM-DD"))}
            />
          ) : null}
          <DatePicker
            aria-label={dates.kind === "point" ? "As of" : "To"}
            prefix={label(dates.kind === "point" ? "As of" : "To")}
            value={dayjs(dates.to)}
            allowClear={false}
            onChange={(d) => d && dates.onTo(d.format("YYYY-MM-DD"))}
          />
        </>
      )}
      {props.compare ? (
        <Select<CompareMode>
          aria-label="Compare"
          value={props.compare.value}
          onChange={props.compare.onChange}
          options={COMPARE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
          style={{ width: 180 }}
        />
      ) : null}
      {props.percent ? (
        <Tooltip title={PERCENT_OF_INCOME_TOOLTIP}>
          <Space size={6}>
            <Switch size="small" checked={props.percent.value} onChange={props.percent.onChange} aria-label="Show % of income" />
            {label("% of income")}
          </Space>
        </Tooltip>
      ) : null}
      <Button type="primary" onClick={props.onRun} loading={loading}>
        Run
      </Button>
    </FilterBar>
  );
}
```

- [ ] **Step 3: Typecheck, lint and the gates**

Run: `npm run typecheck`, `npx eslint components/reports/ZoomSheet.tsx components/reports/ReportToolbar.tsx`, `npx vitest run tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/no-hardcoded-color.test.ts`
Expected: all exit 0 / PASS.

- [ ] **Step 4: Commit**

```bash
git add -- components/reports/ZoomSheet.tsx components/reports/ReportToolbar.tsx
printf '%s\n' "feat(statements): the zoom sheet, and the prototype's report toolbar with copy, CSV, PDF, Excel and print" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 8: The report page, rebuilt around the statement

**Files:**
- Modify (rewrite): `ctyhp-accounting/app/(app)/reports/ReportsClient.tsx`
- Modify: `ctyhp-accounting/app/(app)/reports/page.tsx`
- Delete: `ctyhp-accounting/components/reports/PnlTrendView.tsx`, `BalanceSheetTrendView.tsx`, `BudgetVsActualView.tsx`, `StatementOfEquityView.tsx`
- Modify: `ctyhp-accounting/tests/unit/table-adoption.test.ts`, `ctyhp-accounting/tests/unit/table-fit-contract.test.ts`

**Interfaces:**
- Consumes: everything above; existing `getLedgerBalancesAction`, `getBudgetVsActualAction`, `getStatementOfEquityAction`; `BudgetEditorDrawer`; `ReportBody`; `ComparisonBars`, `chartColors`, `ComparisonBarDatum`; `ReportPaper`, `StatRow`, `ReportFoot`, `StatItem`; `presetRange`, `rangeText`, `longDate`; `fiscalMonths`, `fiscalYearForDate`, `dayBefore`; `listAccounts`, `postedEntryDateSpan`.
- Produces: the page at `/reports?report=…`; `ReportsClient` props gain `accounts: AccountRef[]`, `today: string`, `firstEntryDate: string | null`, `lastEntryDate: string | null`.

- [ ] **Step 1: Check who else uses the views being removed**

Run: `grep -rn "PnlTrendView\|BalanceSheetTrendView\|BudgetVsActualView\|StatementOfEquityView" app components lib --include=*.ts --include=*.tsx`
Expected: only `app/(app)/reports/ReportsClient.tsx`, and the four files themselves. If anything else imports one, stop and report NEEDS_CONTEXT.

- [ ] **Step 2: Rewrite `ReportsClient.tsx`**

Replace the whole of `ctyhp-accounting/app/(app)/reports/ReportsClient.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Spin } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { ComparisonBars, chartColors, type ComparisonBarDatum } from "@/components/charts/FinancialCharts";
import BudgetEditorDrawer from "@/components/reports/BudgetEditorDrawer";
import { ReportBody } from "@/components/reports/ReportAudience";
import { ReportFoot, ReportPaper, StatRow, reportPaperStyles as styles, type StatItem } from "@/components/reports/ReportPaper";
import ReportToolbar from "@/components/reports/ReportToolbar";
import StatementTable from "@/components/reports/StatementTable";
import ZoomSheet from "@/components/reports/ZoomSheet";
import { watchReportPrinting } from "@/lib/client/print-report";
import { formatMoney } from "@/lib/format";
import { dayBefore, fiscalMonths, fiscalYearForDate } from "@/lib/domain/fiscal";
import type { InternalReportId } from "@/lib/domain/report-catalog";
import { longDate, presetRange, rangeText, type PeriodPreset } from "@/lib/domain/report-presets";
import {
  buildBalanceSheet,
  buildProfitAndLoss,
  buildTrialBalance,
  netIncomeOf,
  sumProfitAndLoss,
  type BalanceSheet,
  type LedgerBalance,
  type ProfitAndLoss,
} from "@/lib/domain/reports";
import {
  balanceSheetStatement,
  budgetStatement,
  equityStatement,
  indexAccounts,
  pnlStatement,
  statementSheet,
  trialBalanceStatement,
  type AccountRef,
  type Statement,
  type StatementColumn,
  type ZoomSpec,
} from "@/lib/domain/statement";
import { fiscalYearStartOf, pointColumns, rangeColumns, type CompareMode } from "@/lib/domain/statement-columns";
import { getBudgetVsActualAction, getLedgerBalancesAction, getStatementOfEquityAction } from "./actions";

interface ReportsClientProps {
  initialReportType: InternalReportId;
  baseCurrency: string;
  baseDecimals: number;
  companyName: string;
  fiscalStartMonth: number;
  canManageBudget: boolean;
  /** The chart, for nesting accounts under their parent and for what a total opens. */
  accounts: AccountRef[];
  today: string;
  /** The first and last posted entry, for "All dates" and "Last 3 years". */
  firstEntryDate: string | null;
  lastEntryDate: string | null;
}

const TITLES: Record<InternalReportId, string> = {
  pnl: "Profit and Loss",
  balance: "Balance Sheet",
  trial: "Trial Balance",
  budget: "Budget vs Actual",
  equity: "Statement of Equity",
};

interface ChartSpec {
  title: string;
  description: string;
  data: ComparisonBarDatum[];
}

/** The Management view's chart for a Profit and Loss: as before, income and net per column, or net alone across many. */
function pnlChart(columns: readonly StatementColumn[], pnls: readonly ProfitAndLoss[]): ChartSpec {
  const shown = columns.map((c, i) => ({ c, p: pnls[i] })).filter(({ c }) => !c.isTotal);
  const net = (p: ProfitAndLoss) => (p.netIncome < 0 ? chartColors.negative : chartColors.net);
  if (shown.length <= 2) {
    return {
      title: "Period performance",
      description: "Income and net income for each column shown.",
      data: shown.flatMap(({ c, p }) => [
        { key: `${c.key}-income`, label: `${c.label} income`, value: p.income.total + p.otherIncome.total, color: chartColors.income },
        { key: `${c.key}-net`, label: `${c.label} net income`, value: p.netIncome, color: net(p) },
      ]),
    };
  }
  return {
    title: "Net income by period",
    description: "Net income for each column shown, oldest to newest.",
    data: shown.map(({ c, p }) => ({ key: c.key, label: c.label, value: p.netIncome, color: net(p) })),
  };
}

/** The Management view's chart for a Balance Sheet. */
function balanceChart(columns: readonly StatementColumn[], sheets: readonly BalanceSheet[]): ChartSpec {
  if (columns.length <= 2) {
    return {
      title: "Financial position",
      description: "Assets, liabilities and equity for each column shown.",
      data: columns.flatMap((c, i) => [
        { key: `${c.key}-assets`, label: `${c.label} assets`, value: sheets[i].totalAssets, color: chartColors.receivable },
        { key: `${c.key}-liabilities`, label: `${c.label} liabilities`, value: sheets[i].totalLiabilities, color: chartColors.expense },
        { key: `${c.key}-equity`, label: `${c.label} equity`, value: sheets[i].totalEquity, color: chartColors.net },
      ]),
    };
  }
  return {
    title: "Total assets over the periods shown",
    description: "Each bar is the balance sheet total for that date.",
    data: columns.map((c, i) => ({ key: c.key, label: c.label, value: sheets[i].totalAssets, color: chartColors.receivable })),
  };
}

/**
 * The five financial statements, laid out as the client's prototype lays a
 * statement out (`renderReports`, `reportPL`, `reportBS`, `reportTB`,
 * `reportBudget`): the toolbar, the report on paper, the statement, and a
 * footer saying every figure opens onto the entries behind it.
 *
 * Every figure comes from the builders in lib/domain/reports.ts, from the same
 * reads as before; lib/domain/statement.ts only arranges them.
 */
export default function ReportsClient({
  initialReportType: type,
  baseCurrency,
  baseDecimals,
  companyName,
  fiscalStartMonth,
  canManageBudget,
  accounts,
  today,
  firstEntryDate,
  lastEntryDate,
}: ReportsClientProps) {
  const { message } = App.useApp();
  const router = useRouter();
  const point = type === "balance" || type === "trial";
  const index = useMemo(() => indexAccounts(accounts), [accounts]);
  const presetContext = useMemo(
    () => ({ today, fiscalStartMonth, firstEntryDate, lastEntryDate }),
    [today, fiscalStartMonth, firstEntryDate, lastEntryDate],
  );
  const initialRange = useMemo(() => presetRange("year", presetContext), [presetContext]);

  const [preset, setPreset] = useState<PeriodPreset>("year");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  // What each statement has always opened with: the P&L and the Balance Sheet
  // beside the previous period, the Trial Balance on its own.
  const [compare, setCompare] = useState<CompareMode>(type === "pnl" || type === "balance" ? "prev" : "none");
  // % of income is on for one or two columns and off for a column per period —
  // until the reader flips it; from then on it is theirs (as `nextShowPercentOfIncome` has it).
  const [showPercent, setShowPercent] = useState(true);
  const [percentTouched, setPercentTouched] = useState(false);
  const changeCompare = (mode: CompareMode) => {
    setCompare(mode);
    if (!percentTouched) setShowPercent(mode === "none" || mode === "prev" || mode === "year");
  };

  const initialFiscalYear = fiscalYearForDate(today, fiscalStartMonth);
  const [fiscalYear, setFiscalYear] = useState(initialFiscalYear);
  const months = useMemo(() => fiscalMonths(fiscalYear, fiscalStartMonth), [fiscalYear, fiscalStartMonth]);
  const [budgetFromPeriod, setBudgetFromPeriod] = useState(1);
  const [budgetToPeriod, setBudgetToPeriod] = useState(() => {
    const current = fiscalMonths(initialFiscalYear, fiscalStartMonth).findIndex((m) => today >= m.start && today <= m.end);
    return current === -1 ? 12 : current + 1;
  });
  const [budgetEditorOpen, setBudgetEditorOpen] = useState(false);

  const [statement, setStatement] = useState<Statement | null>(null);
  const [chart, setChart] = useState<ChartSpec | null>(null);
  const [stats, setStats] = useState<StatItem[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ran, setRan] = useState(initialRange);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<ZoomSpec | null>(null);

  const money = useCallback((minor: number) => formatMoney(minor, baseCurrency, baseDecimals), [baseCurrency, baseDecimals]);

  const run = useCallback(async () => {
    const read = async (f: string | null, t: string): Promise<LedgerBalance[]> => {
      const result = await getLedgerBalancesAction(f, t);
      if (!result.ok || !result.data) throw new Error(result.error ?? "The ledger could not be read.");
      return result.data;
    };
    const show = (next: Statement, nextChart: ChartSpec | null, nextStats: StatItem[] | null, range: { from: string; to: string }) => {
      setStatement(next);
      setChart(nextChart);
      setStats(nextStats);
      setRan(range);
      setNotice(null);
    };
    const refuse = (text: string) => {
      setNotice(text);
      setStatement(null);
      setChart(null);
      setStats(null);
    };

    setLoading(true);
    try {
      if (type === "budget") {
        if (budgetFromPeriod > budgetToPeriod) return refuse("The first budget period is after the last.");
        const bFrom = months[budgetFromPeriod - 1].start;
        const bTo = months[budgetToPeriod - 1].end;
        const result = await getBudgetVsActualAction(fiscalYear, bFrom, bTo);
        if (!result.ok || !result.data) throw new Error(result.error ?? "Budget vs Actual could not be read.");
        const bva = result.data;
        const actualIncome = bva.actual.income.total + bva.actual.otherIncome.total;
        const budgetIncome = bva.budget.income.total + bva.budget.otherIncome.total;
        const actualExpenses = bva.actual.costOfGoodsSold.total + bva.actual.operatingExpenses.total + bva.actual.otherExpenses.total;
        const netVariance = bva.actual.netIncome - bva.budget.netIncome;
        show(
          budgetStatement({ bva, from: bFrom, to: bTo, accounts: index }),
          null,
          [
            { label: "Actual income", value: money(actualIncome) },
            { label: "Budget income", value: money(budgetIncome) },
            { label: "Actual expenses", value: money(actualExpenses) },
            { label: "Net income variance", value: money(netVariance), danger: netVariance < 0 },
          ],
          { from: bFrom, to: bTo },
        );
        return;
      }

      if (type === "equity") {
        if (from > to) return refuse("The start date is after the end date.");
        const result = await getStatementOfEquityAction(from, to);
        if (!result.ok || !result.data) throw new Error(result.error ?? "The Statement of Equity could not be read.");
        const soe = result.data;
        show(
          equityStatement({ soe, from, to, accounts: index }),
          {
            title: "Equity movement",
            description: "Beginning equity plus direct equity activity and net income equals ending equity.",
            data: [
              { key: "opening", label: "Beginning equity", value: soe.openingEquity, color: chartColors.neutral },
              { key: "activity", label: "Direct equity activity", value: soe.equityActivity, color: chartColors.payable },
              { key: "income", label: "Net income", value: soe.netIncome, color: soe.netIncome < 0 ? chartColors.negative : chartColors.income },
              { key: "closing", label: "Ending equity", value: soe.closingEquity, color: chartColors.net },
            ],
          },
          null,
          { from, to },
        );
        return;
      }

      if (type === "pnl") {
        const plan = rangeColumns(compare, from, to, fiscalStartMonth);
        if (!plan.ok) return refuse(plan.message);
        const detail = plan.columns.filter((c) => !c.isTotal);
        const detailPnls = (await Promise.all(detail.map((c) => read(c.from, c.to)))).map(buildProfitAndLoss);
        const pnls = plan.columns.map((c) => (c.isTotal ? sumProfitAndLoss(detailPnls) : detailPnls[detail.indexOf(c)]));
        show(
          pnlStatement({ columns: plan.columns, pnls, accounts: index, showPercent, change: plan.change }),
          pnlChart(plan.columns, pnls),
          null,
          { from, to },
        );
        return;
      }

      // The Balance Sheet and the Trial Balance: columns are dates.
      const plan = pointColumns(compare, to, from, fiscalStartMonth);
      if (!plan.ok) return refuse(plan.message);
      const balances = await Promise.all(plan.columns.map((c) => read(null, c.to)));
      if (type === "trial") {
        show(trialBalanceStatement({ columns: plan.columns, tbs: balances.map(buildTrialBalance), accounts: index }), null, null, { from, to });
        return;
      }
      const fiscalYearStarts = plan.columns.map((c) => fiscalYearStartOf(c.to, fiscalStartMonth));
      // Twelve month-end columns share one fiscal year: read each year's earlier profit once.
      const starts = [...new Set(fiscalYearStarts)];
      const earlier = new Map(
        await Promise.all(starts.map(async (start) => [start, netIncomeOf(await read(null, dayBefore(start)))] as const)),
      );
      const sheets = balances.map(buildBalanceSheet);
      show(
        balanceSheetStatement({
          columns: plan.columns,
          sheets,
          priorEarnings: fiscalYearStarts.map((start) => earlier.get(start) ?? 0),
          fiscalYearStarts,
          accounts: index,
          change: plan.change,
        }),
        balanceChart(plan.columns, sheets),
        null,
        { from, to },
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "The report could not be produced.");
    } finally {
      setLoading(false);
    }
  }, [
    type,
    from,
    to,
    compare,
    showPercent,
    fiscalYear,
    budgetFromPeriod,
    budgetToPeriod,
    months,
    index,
    fiscalStartMonth,
    money,
    message,
  ]);

  useEffect(() => {
    // Data-synchronization effect: a change of period or comparison reads the books again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [run]);

  // Ctrl+P prints the report alone too, not only the Print button.
  useEffect(() => watchReportPrinting(), []);

  const paperRange = point ? `As of ${longDate(ran.to)}` : rangeText(ran.from, ran.to);
  const sheet = useMemo(
    () =>
      statement && !statement.empty
        ? statementSheet(statement, {
            companyName,
            currencyCode: baseCurrency,
            decimals: baseDecimals,
            subtitle: paperRange,
            fileName: `${TITLES[type]} ${ran.from} to ${ran.to}`,
          })
        : null,
    [statement, companyName, baseCurrency, baseDecimals, paperRange, type, ran],
  );

  // A month-by-month request that is too wide may still fit by quarter.
  const quarterFits =
    compare === "month" &&
    (point ? pointColumns("quarter", to, from, fiscalStartMonth) : rangeColumns("quarter", from, to, fiscalStartMonth)).ok;

  const body = notice ? (
    <div className={styles.empty}>
      {notice}
      {quarterFits ? (
        <div style={{ marginTop: 12 }}>
          <Button size="small" onClick={() => changeCompare("quarter")}>
            Show it by quarter
          </Button>
        </div>
      ) : null}
    </div>
  ) : !statement ? (
    <div className={styles.empty}>{loading ? "Reading the books…" : "The report has not been run."}</div>
  ) : statement.empty ? (
    <div className={styles.empty}>
      No entries fall in this period.
      <br />
      Add entries on the <Link href="/journal">Journal screen</Link>, or widen the date range.
    </div>
  ) : (
    <>
      {stats ? <StatRow items={stats} /> : null}
      <StatementTable statement={statement} money={money} onZoom={setZoom} />
      {statement.outOfBalance !== null ? (
        <Alert
          type="error"
          showIcon
          className={styles.outOfBalance}
          title={`${type === "trial" ? "Debits and credits" : "Assets, and liabilities plus equity,"} differ by ${money(Math.abs(statement.outOfBalance))}.`}
          description="This should not happen while every entry balances. The General Ledger Posting report shows which document did not reach the ledger."
        />
      ) : null}
      <ReportFoot>
        <strong>Every figure is a QuickZoom.</strong> Click any amount to open the entries behind it, then click a line to
        open the full double entry.
      </ReportFoot>
    </>
  );

  const paper = (
    <div className="report-print-area">
      <ReportPaper companyName={companyName} title={TITLES[type]} range={paperRange} currencyCode={baseCurrency}>
        {body}
      </ReportPaper>
    </div>
  );

  return (
    <div>
      <ReportToolbar
        report={type}
        onReportChange={(next) => router.replace(`/reports?report=${next}`, { scroll: false })}
        dates={
          type === "budget"
            ? {
                kind: "budget",
                fiscalYear,
                months,
                fromPeriod: budgetFromPeriod,
                toPeriod: budgetToPeriod,
                onFiscalYear: setFiscalYear,
                onFromPeriod: setBudgetFromPeriod,
                onToPeriod: setBudgetToPeriod,
              }
            : {
                kind: point ? "point" : "range",
                preset,
                from,
                to,
                showFrom: !point || compare === "month" || compare === "quarter" || compare === "years",
                onPreset: (next) => {
                  setPreset(next);
                  if (next === "custom") return;
                  const range = presetRange(next, presetContext);
                  setFrom(range.from);
                  setTo(range.to);
                },
                onFrom: (date) => {
                  setFrom(date);
                  setPreset("custom");
                },
                onTo: (date) => {
                  setTo(date);
                  setPreset("custom");
                },
              }
        }
        compare={type === "pnl" || point ? { value: compare, onChange: changeCompare } : null}
        percent={
          type === "pnl"
            ? {
                value: showPercent,
                onChange: (show) => {
                  setShowPercent(show);
                  setPercentTouched(true);
                },
              }
            : null
        }
        extraActions={
          type === "budget" && canManageBudget ? (
            <Button icon={<EditOutlined />} onClick={() => setBudgetEditorOpen(true)}>
              Manage budget
            </Button>
          ) : null
        }
        onRun={() => void run()}
        loading={loading}
        sheet={sheet}
      />

      <Spin spinning={loading && statement !== null} description="Reading the books again…">
        <div aria-live="polite" aria-busy={loading}>
          {chart ? (
            <ReportBody
              numbers={paper}
              chart={<ComparisonBars title={chart.title} description={chart.description} formatMoney={money} data={chart.data} />}
            />
          ) : (
            paper
          )}
        </div>
      </Spin>

      <ZoomSheet spec={zoom} onClose={() => setZoom(null)} money={money} />

      {type === "budget" && canManageBudget ? (
        <BudgetEditorDrawer
          key={fiscalYear}
          open={budgetEditorOpen}
          onClose={() => setBudgetEditorOpen(false)}
          onSaved={() => {
            setBudgetEditorOpen(false);
            void run();
          }}
          fiscalYear={fiscalYear}
          months={months}
          baseCurrency={baseCurrency}
          baseDecimals={baseDecimals}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: The page passes the chart, today and the entry span**

In `ctyhp-accounting/app/(app)/reports/page.tsx`:

(a) add imports:

```ts
import { listAccounts } from "@/lib/services/accounts";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { postedEntryDateSpan } from "@/lib/services/exceptions";
```

(b) replace the `Promise.all` block with:

```ts
  const [currencies, company, canManageBudget, accountRows, span] = await Promise.all([
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
    hasPermission(sb, "budget.manage"),
    listAccounts(sb),
    // The first and last posted entry, for "All dates" and "Last 3 years".
    postedEntryDateSpan(sb),
  ]);
```

(c) add these props to `<ReportsClient`, after `canManageBudget={canManageBudget}`:

```tsx
        accounts={accountRows.map((a) => ({
          id: a.id,
          code: a.account_code,
          name: a.name,
          type: a.account_type,
          parentId: a.parent_account_id,
        }))}
        // The company's own day, as the dashboard reckons it: at 6 p.m. in New York
        // it is already tomorrow in UTC, and "This month" would run a day ahead.
        today={todayInTimeZone(company?.time_zone ?? "America/New_York")}
        firstEntryDate={span.first}
        lastEntryDate={span.last}
```

- [ ] **Step 4: Remove the four views**

Run: `git rm -- components/reports/PnlTrendView.tsx components/reports/BalanceSheetTrendView.tsx components/reports/BudgetVsActualView.tsx components/reports/StatementOfEquityView.tsx`

- [ ] **Step 5: Bring the two table gates up to date**

In `ctyhp-accounting/tests/unit/table-adoption.test.ts`:
- delete the two entries `"app/(app)/reports/ReportsClient.tsx",` and `"components/reports/BudgetVsActualView.tsx",` from `RAW_TABLE`;
- replace the sentence in the doc comment above `RAW_TABLE` that begins "Two of these — ReportsClient.tsx and BudgetVsActualView.tsx —" and the rest of that paragraph with: `ReportsClient.tsx and BudgetVsActualView.tsx were on this list for a hand-rolled Table.Summary; the financial statements now render through components/reports/StatementTable.tsx, a plain table, and both entries are gone (2026-09-28).`;
- change `expect(RAW_TABLE.size).toBeLessThanOrEqual(49);` to `expect(RAW_TABLE.size).toBeLessThanOrEqual(47);` and in the comment above the list change "49 as of 2026-08-14." to "49 as of 2026-08-14; 47 as of 2026-09-28."

In `ctyhp-accounting/tests/unit/table-fit-contract.test.ts`, replace the `MATRIX` constant with:

```ts
/**
 * Empty since 2026-09-28: the two per-period statements that were matrices
 * (PnlTrendView, BalanceSheetTrendView) became columns of the statement table,
 * a plain table that scrolls inside its own box. A table added here needs its
 * reason and `fit={false}` at its call site.
 */
const MATRIX = new Map<string, string>();
```

- [ ] **Step 6: Typecheck, lint, the gates and the report tests**

Run: `npm run typecheck`, `npx eslint "app/(app)/reports/ReportsClient.tsx" "app/(app)/reports/page.tsx"`, `npx vitest run tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/rsc-antd.test.ts tests/unit/no-hardcoded-color.test.ts tests/unit/reports.test.ts tests/unit/statement.test.ts tests/unit/statement-columns.test.ts`
Expected: all exit 0 / PASS.

- [ ] **Step 7: Commit**

```bash
git add -- "app/(app)/reports/ReportsClient.tsx" "app/(app)/reports/page.tsx" tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts
printf '%s\n' "feat(statements): the five statements on paper, the prototype's toolbar above them, and every figure a QuickZoom" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

(The `git rm` of Step 4 is already staged and goes into the same commit.)

---

### Task 9: Parity on the real books

**Files:**
- Create: `ctyhp-accounting/vitest.live.config.ts`
- Create: `ctyhp-accounting/tests/live/statement-parity.live.ts`

**Interfaces:**
- Consumes: the builders (Tasks 2–4), `rangeColumns`/`pointColumns`/`fiscalYearStartOf`/`COMPARE_OPTIONS` (Task 1), `getZoom` (Task 5), `smokeSession` (`scripts/smoke-environment.mjs`), `listAccounts`, `getCurrentCompanySettings`, `postedEntryDateSpan`, `getLedgerBalances`, `getBudgetAccountAmounts`.
- Produces: `node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts --pool=threads`, read-only.

- [ ] **Step 1: The config**

`ctyhp-accounting/vitest.live.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Read-only checks against the live books (tests/live). Never part of `npm test`:
 * they need `.env.local`, sign in as the smoke user, and take minutes.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Supplied by the Next.js bundler; unresolvable in a plain vitest run.
      "server-only": fileURLToPath(new URL("./tests/e2e/support/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/live/**/*.live.ts"],
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 120_000,
  },
});
```

- [ ] **Step 2: The test**

`ctyhp-accounting/tests/live/statement-parity.live.ts`:

```ts
/**
 * The five statements, checked against the books they are drawn from — read-only.
 *
 * For every company the smoke user belongs to, over three periods and every
 * Compare option, each statement is built from the same reads the screen makes
 * and held to the builders in lib/domain/reports.ts figure by figure. Then a
 * sample of figures is opened as a QuickZoom, and each list must add up to the
 * figure that opened it. Nothing is written: every call is a select or a
 * read-only RPC, and no server action runs, so no audit row is recorded.
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts --pool=threads
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import { dayBefore, fiscalMonths, fiscalYearForDate } from "@/lib/domain/fiscal";
import { presetRange, type PeriodPreset } from "@/lib/domain/report-presets";
import {
  buildBalanceSheet,
  buildBudgetVsActual,
  buildProfitAndLoss,
  buildStatementOfEquity,
  buildTrialBalance,
  compareReportLines,
  netIncomeOf,
  sumProfitAndLoss,
  type ProfitAndLoss,
} from "@/lib/domain/reports";
import {
  balanceSheetStatement,
  budgetStatement,
  equityStatement,
  indexAccounts,
  pnlStatement,
  trialBalanceStatement,
  type AccountIndex,
  type Statement,
  type ZoomSpec,
} from "@/lib/domain/statement";
import { COMPARE_OPTIONS, fiscalYearStartOf, pointColumns, rangeColumns } from "@/lib/domain/statement-columns";
import { listAccounts } from "@/lib/services/accounts";
import { getBudgetAccountAmounts } from "@/lib/services/budgets";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { postedEntryDateSpan } from "@/lib/services/exceptions";
import { getLedgerBalances } from "@/lib/services/reports";
import { getZoom } from "@/lib/services/zoom";

interface Company {
  name: string;
  sb: SupabaseClient;
  accounts: AccountIndex;
  fiscalStartMonth: number;
  today: string;
  first: string | null;
  last: string | null;
}

const companies: Company[] = [];
const PRESETS: Exclude<PeriodPreset, "custom">[] = ["year", "last3", "all"];

beforeAll(async () => {
  const s = await smokeSession();
  if (!s.session) throw new Error("The smoke sign-in returned no session.");
  const auth = { persistSession: false };
  const headers = { Authorization: `Bearer ${s.session.access_token}` };
  const control = createClient(s.supabaseUrl, s.anonKey, { db: { schema: "onebook" }, auth, global: { headers } });
  const { data, error } = await control.rpc("my_companies");
  if (error) throw new Error(`my_companies: ${error.message}`);
  for (const row of (data ?? []) as { legal_name: string; schema_name: string }[]) {
    const sb = createClient(s.supabaseUrl, s.anonKey, {
      db: { schema: row.schema_name },
      auth,
      global: { headers },
    }) as unknown as SupabaseClient;
    const [accounts, settings, span] = await Promise.all([listAccounts(sb), getCurrentCompanySettings(sb), postedEntryDateSpan(sb)]);
    companies.push({
      name: row.legal_name,
      sb,
      accounts: indexAccounts(
        accounts.map((a) => ({ id: a.id, code: a.account_code, name: a.name, type: a.account_type, parentId: a.parent_account_id })),
      ),
      fiscalStartMonth: settings?.fiscal_year_start_month ?? 1,
      today: todayInTimeZone(settings?.time_zone ?? "America/New_York"),
      first: span.first,
      last: span.last,
    });
  }
  expect(companies.length).toBeGreaterThan(0);
});

const rangeOf = (c: Company, preset: Exclude<PeriodPreset, "custom">) =>
  presetRange(preset, { today: c.today, fiscalStartMonth: c.fiscalStartMonth, firstEntryDate: c.first, lastEntryDate: c.last });
const byKey = (s: Statement, key: string) => s.rows.find((r) => r.key === key);
const accountRow = (s: Statement, accountId: string) => s.rows.find((r) => r.kind === "account" && r.accountId === accountId);
const sections = (p: ProfitAndLoss) => [p.income, p.costOfGoodsSold, p.operatingExpenses, p.otherIncome, p.otherExpenses];

function expectPnl(label: string, s: Statement, pnls: readonly ProfitAndLoss[], change: boolean) {
  pnls.forEach((p, i) => {
    expect(byKey(s, "income:total")?.cells[i].amount, `${label} income`).toBe(p.income.total);
    expect(byKey(s, "opex:total")?.cells[i].amount, `${label} opex`).toBe(p.operatingExpenses.total);
    expect(byKey(s, "net-income")?.cells[i].amount, `${label} net income`).toBe(p.netIncome);
    if (byKey(s, "gross")) expect(byKey(s, "gross")?.cells[i].amount, `${label} gross`).toBe(p.grossProfit);
    for (const section of sections(p)) {
      for (const line of section.lines) {
        expect(accountRow(s, line.accountId!)?.cells[i].amount, `${label} ${line.accountCode}`).toBe(line.amount);
      }
    }
  });
  if (change) {
    for (let k = 0; k < 5; k++) {
      for (const line of compareReportLines(sections(pnls[0])[k].lines, sections(pnls[1])[k].lines)) {
        const row = accountRow(s, line.accountId!);
        expect(row?.change?.amount, `${label} change ${line.accountCode}`).toBe(line.variance);
        expect(row?.change?.percent ?? null, `${label} change % ${line.accountCode}`).toBe(line.variancePercent);
      }
    }
  }
}

async function expectZoomsAddUp(c: Company, s: Statement, keys: string[]) {
  const specs: ZoomSpec[] = [];
  for (const key of keys) {
    const z = byKey(s, key)?.cells[0].zoom;
    if (z) specs.push(z);
  }
  for (const r of s.rows.filter((r) => r.kind === "account" && r.cells[0].zoom).slice(0, 3)) specs.push(r.cells[0].zoom!);
  for (const spec of specs) {
    const result = await getZoom(c.sb, spec);
    expect(result.total, `${c.name}: ${s.title} → ${spec.title}`).toBe(spec.figure);
  }
}

describe("the five statements agree with the books, figure for figure", () => {
  it("Profit and Loss, every period and Compare option", async () => {
    for (const c of companies) {
      for (const preset of PRESETS) {
        const range = rangeOf(c, preset);
        for (const { key: mode } of COMPARE_OPTIONS) {
          const plan = rangeColumns(mode, range.from, range.to, c.fiscalStartMonth);
          if (!plan.ok) continue;
          const detail = plan.columns.filter((col) => !col.isTotal);
          const detailPnls = (await Promise.all(detail.map((col) => getLedgerBalances(c.sb, col.from, col.to)))).map(buildProfitAndLoss);
          const pnls = plan.columns.map((col) => (col.isTotal ? sumProfitAndLoss(detailPnls) : detailPnls[detail.indexOf(col)]));
          const s = pnlStatement({ columns: plan.columns, pnls, accounts: c.accounts, showPercent: true, change: plan.change });
          expectPnl(`${c.name} ${preset} ${mode}`, s, pnls, plan.change);
        }
      }
    }
  });

  it("Balance Sheet and Trial Balance, every period and Compare option", async () => {
    for (const c of companies) {
      for (const preset of PRESETS) {
        const range = rangeOf(c, preset);
        for (const { key: mode } of COMPARE_OPTIONS) {
          const plan = pointColumns(mode, range.to, range.from, c.fiscalStartMonth);
          if (!plan.ok) continue;
          const label = `${c.name} ${preset} ${mode}`;
          const balances = await Promise.all(plan.columns.map((col) => getLedgerBalances(c.sb, null, col.to)));

          const tbs = balances.map(buildTrialBalance);
          const tb = trialBalanceStatement({ columns: plan.columns, tbs, accounts: c.accounts });
          tbs.forEach((t, i) => {
            expect(byKey(tb, "total")?.cells[2 * i].amount, `${label} TB debit`).toBe(t.totalDebit);
            expect(byKey(tb, "total")?.cells[2 * i + 1].amount, `${label} TB credit`).toBe(t.totalCredit);
            for (const line of t.lines) {
              const row = accountRow(tb, line.accountId);
              expect(row?.cells[2 * i].amount ?? 0, `${label} TB ${line.accountCode} debit`).toBe(line.debit);
              expect(row?.cells[2 * i + 1].amount ?? 0, `${label} TB ${line.accountCode} credit`).toBe(line.credit);
            }
          });

          const starts = plan.columns.map((col) => fiscalYearStartOf(col.to, c.fiscalStartMonth));
          const earlier = await Promise.all(starts.map((start) => getLedgerBalances(c.sb, null, dayBefore(start))));
          const sheets = balances.map(buildBalanceSheet);
          const bs = balanceSheetStatement({
            columns: plan.columns,
            sheets,
            priorEarnings: earlier.map(netIncomeOf),
            fiscalYearStarts: starts,
            accounts: c.accounts,
            change: plan.change,
          });
          sheets.forEach((sh, i) => {
            expect(byKey(bs, "assets:total")?.cells[i].amount, `${label} assets`).toBe(sh.totalAssets);
            expect(byKey(bs, "liabilities:total")?.cells[i].amount, `${label} liabilities`).toBe(sh.totalLiabilities);
            expect(byKey(bs, "equity:total")?.cells[i].amount, `${label} equity`).toBe(sh.totalEquity);
            expect(byKey(bs, "le:total")?.cells[i].amount, `${label} L+E`).toBe(sh.totalLiabilities + sh.totalEquity);
            for (const section of [sh.assets, sh.liabilities, sh.equity]) {
              for (const line of section.lines) {
                if (line.accountId === null) continue;
                expect(accountRow(bs, line.accountId)?.cells[i].amount, `${label} ${line.accountCode}`).toBe(line.amount);
              }
            }
            const earnings = sh.equity.lines.find((l) => l.accountId === null && l.name === "Current earnings")?.amount ?? 0;
            const retained = byKey(bs, "equity:retained")?.cells[i].amount ?? 0;
            const thisYear = byKey(bs, "equity:net-income")?.cells[i].amount ?? 0;
            expect(retained + thisYear, `${label} earnings split`).toBe(earnings);
            const groups = bs.rows.filter((r) => r.kind === "subtotal" && r.key.startsWith("assets:") && r.key.endsWith(":total"));
            expect(groups.reduce((sum, r) => sum + (r.cells[i].amount ?? 0), 0), `${label} asset groups`).toBe(sh.totalAssets);
          });
        }
      }
    }
  });

  it("Budget vs Actual and the Statement of Equity, this year", async () => {
    for (const c of companies) {
      const fy = fiscalYearForDate(c.today, c.fiscalStartMonth);
      const months = fiscalMonths(fy, c.fiscalStartMonth);
      const [actual, budget] = await Promise.all([
        getLedgerBalances(c.sb, months[0].start, months[11].end),
        getBudgetAccountAmounts(c.sb, fy, months[0].start, months[11].end),
      ]);
      const bva = buildBudgetVsActual(actual, budget);
      const b = budgetStatement({ bva, from: months[0].start, to: months[11].end, accounts: c.accounts });
      for (const line of bva.lines.filter((l) => l.current !== 0 || l.prior !== 0)) {
        const row = accountRow(b, line.accountId!);
        expect(row?.cells.map((cell) => cell.amount), `${c.name} budget ${line.accountCode}`).toEqual([line.current, line.prior]);
        expect(row?.change, `${c.name} budget variance ${line.accountCode}`).toEqual({ amount: line.variance, percent: line.variancePercent });
      }
      expect(byKey(b, "net-income")?.cells.map((cell) => cell.amount)).toEqual([bva.actual.netIncome, bva.budget.netIncome]);

      const range = rangeOf(c, "year");
      const [opening, period] = await Promise.all([
        getLedgerBalances(c.sb, null, dayBefore(range.from)),
        getLedgerBalances(c.sb, range.from, range.to),
      ]);
      const soe = buildStatementOfEquity(opening, period);
      const e = equityStatement({ soe, from: range.from, to: range.to, accounts: c.accounts });
      for (const line of soe.lines) expect(byKey(e, line.key)?.cells[0].amount, `${c.name} equity ${line.key}`).toBe(line.amount);
    }
  });

  it("a QuickZoom adds up to the figure that opened it", async () => {
    for (const c of companies) {
      const range = rangeOf(c, "year");
      const one = rangeColumns("none", range.from, range.to, c.fiscalStartMonth);
      if (!one.ok) continue;
      const pnl = pnlStatement({
        columns: one.columns,
        pnls: [buildProfitAndLoss(await getLedgerBalances(c.sb, range.from, range.to))],
        accounts: c.accounts,
        showPercent: false,
        change: false,
      });
      await expectZoomsAddUp(c, pnl, ["income:total", "opex:total", "net-income"]);

      const plan = pointColumns("none", range.to, range.from, c.fiscalStartMonth);
      if (!plan.ok) continue;
      const balances = await getLedgerBalances(c.sb, null, range.to);
      const start = fiscalYearStartOf(range.to, c.fiscalStartMonth);
      const bs = balanceSheetStatement({
        columns: plan.columns,
        sheets: [buildBalanceSheet(balances)],
        priorEarnings: [netIncomeOf(await getLedgerBalances(c.sb, null, dayBefore(start)))],
        fiscalYearStarts: [start],
        accounts: c.accounts,
        change: false,
      });
      await expectZoomsAddUp(c, bs, ["assets:total", "le:total", "equity:retained", "equity:net-income"]);
      const tb = trialBalanceStatement({ columns: plan.columns, tbs: [buildTrialBalance(balances)], accounts: c.accounts });
      await expectZoomsAddUp(c, tb, ["total"]);
    }
  });
});
```

- [ ] **Step 3: Typecheck and lint the new files**

Run: `npm run typecheck` and `npx eslint tests/live vitest.live.config.ts`
Expected: exit 0. (`npm test` does not pick up `tests/live`: `vitest.config.ts` includes only `tests/**/*.test.ts`.)

- [ ] **Step 4: Run it against the live books**

Run: `timeout 1200 node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts --pool=threads`
Expected: 4 tests PASS. If one fails, read the assertion label (company, period, Compare option, account) before changing anything: a failure is either a builder bug in Tasks 2–4 (fix it there, with a unit test that reproduces it) or a real disagreement in the books (report it; do not bend the test).

- [ ] **Step 5: Commit**

```bash
git add -- vitest.live.config.ts tests/live/statement-parity.live.ts
printf '%s\n' "test(statements): every figure of the five statements held to the builders on the live books, read-only" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 10: Changelog, and the four gates

**Files:**
- Modify: `ctyhp-accounting/lib/domain/changelog.ts` (a release at the top of `RELEASES`)

- [ ] **Step 1: Add release 1.66**

Insert as the first element of `RELEASES` (check `tests/unit/changelog.test.ts` for how a route is matched; `/reports` is the Report Center page and exists):

```ts
  {
    version: "1.66",
    date: "2026-09-28",
    headline: "The five financial statements, set out on paper, with every figure opening onto the entries behind it.",
    changes: [
      {
        kind: "changed",
        title: "Profit and Loss, Balance Sheet, Trial Balance, Budget vs Actual and Statement of Equity read like statements",
        detail:
          "Each is headed with the company, the dates and the basis, and set out the way an accountant sets one out: sections, accounts nested under their parent with a subtotal, a rule above each total and a double rule under the last. The Balance Sheet groups assets into cash and bank, receivables, other current and long-term, and shows earlier years' profit and this year's on separate lines. No figure changes.",
        route: "/reports",
      },
      {
        kind: "added",
        title: "Click any figure to see the entries behind it",
        detail:
          "Every amount on the five statements, totals included, opens a list of the posted lines that make it up — which always adds up to the figure you clicked. Click a line to see the whole transaction.",
        route: "/reports",
      },
      {
        kind: "changed",
        title: "One period picker and one Compare list",
        detail:
          "Pick This month through All dates, or your own dates, and compare with the previous period, the previous year, or a column per month, quarter or year. Copy the report, save it as CSV, PDF or Excel, or print it.",
        route: "/reports",
      },
    ],
  },
```

- [ ] **Step 2: Run the four gates, reading the whole output**

```bash
npm test > "$SCRATCH/gate-test.txt" 2>&1; echo "exit $?"
npm run typecheck > "$SCRATCH/gate-tsc.txt" 2>&1; echo "exit $?"
npm run lint > "$SCRATCH/gate-lint.txt" 2>&1; echo "exit $?"
npm run build > "$SCRATCH/gate-build.txt" 2>&1; echo "exit $?"
```

Read each file in full. Expected: `npm test` every file passes; typecheck, lint and build exit 0.

- [ ] **Step 3: Commit**

```bash
git add -- lib/domain/changelog.ts
printf '%s\n' "chore(changelog): 1.66, the financial statements on paper" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 11: Look at it, then hand it over (controller)

- [ ] Build and start the server detached (PowerShell `Start-Process npm.cmd -ArgumentList start -WindowStyle Hidden -RedirectStandardOutput … -RedirectStandardError …`).
- [ ] `node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000` — every page renders.
- [ ] Temporary read-only Playwright script (in `ctyhp-accounting/`, deleted before committing; `smokeSession()` sign-in, `onebook-company` cookie, a hard timeout): screenshot each of the five statements on the largest live company and Aurora (Aurora has nested accounts), light and dark, with Compare = Previous period and = Column per quarter; open one zoom on a total and then a line's Transaction detail; `page.emulateMedia({ media: "print" })` with `print-report` set, to see the print.
- [ ] In the same script, after Run stops loading, measure that the paper fits its box at 1280 and 1470 wide (`scrollWidth <= clientWidth` on the page, and on `.rptScroll` for up to three columns) — `verify:table-fit` measures before a report has loaded and reports "0 of 0".
- [ ] Review every picture beside the prototype's `reportPL` / `reportBS` / `reportTB` / `reportBudget`: centred paper head, small-capital sections, indentation, rules, double rule, Change columns, % column, colours in both themes, nothing cut or overlapping. Fix, rebuild, re-shoot.
- [ ] Show the client the screenshots before pushing. Push and open the PR after their approval, based on `feat/working-trial-balance` until that merges.
