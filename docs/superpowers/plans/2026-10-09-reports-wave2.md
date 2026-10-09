# Reports wave 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three reports from the client's mockup (Financial Ratios, Purchases and Inventory, Sales Tax Liability) and bring the 13 Week Cash Forecast and Budget vs Actual in line with it, as release 1.95, with no migration.

**Architecture:**
- **The three new reports.** Each gets its own page under `app/(app)/reports/<slug>/` on the wave 1 `SimpleReport` frame. Each also has a pure calculation module in `lib/domain/` with unit tests and a paged read service in `lib/services/`.
- **The forecast** is upgraded on its existing page.
- **Budget vs Actual** is upgraded inside `ReportsClient`, and gains a full-year budget grid. The grid saves through the existing `acc_save_budget_month`.
- **Catalog cards, release notes and the Guide** land last, together with a read-only live check across every company.

**Tech Stack:**
- Next.js 16 App Router, React 19
- Ant Design 6
- Zod 4
- Supabase/PostgREST, one schema per company
- vitest

**Source of truth:**
- Spec: `docs/superpowers/specs/2026-10-09-reports-wave2-design.md`, including its two amendment sections.
- Code: every file in this plan was built and run first on a local pre-build branch:
  - read-only against all six companies;
  - typecheck, lint, unit tests, build and bundle budget all green;
  - a browser smoke on the sample company, 23 of 23 checks passing.
- How the plan carries that code:
  - New files are given whole.
  - Edits to existing files are find/replace pairs that reproduce the pre-build exactly when applied in order.
  - A file rewritten by more than half is given whole.

**Do not "improve" the given code while transcribing it.** It has been verified against real ledgers. If something looks wrong, stop and report it instead of changing it.

## Global Constraints

- **No migration, no schema change, no new RPC.** The only write is budget figures, through the existing `acc_save_budget_month`. Nothing is posted to the books.
- **UI copy and figures.**
  - UI copy is in US English, and names are the mockup's.
  - Money is shown in the company's base currency.
  - Dates are in the company's time zone. Never use `new Date().toISOString()` for "today".
- **Reads.** Every list read pages past PostgREST's silent 1,000-row cap with a total order, ending in a unique column.
- **Who can use what.**
  - Every company member can open each report.
  - "Record a payment" is for writers only (`canWrite`).
  - Editing a budget needs `budget.manage`.
- **Proof lines.** Where a report states what its total ties to, it says so under the total. When the two sides disagree, it shows a warning with the difference rather than hiding it.
- **Tables.**
  - Every list goes through `DataTable` or `ReportTable`. Never import antd's `Table` in a screen, and never rename it to slip past `tests/unit/table-adoption.test.ts`.
  - Total rows use `ReportTable`'s `summary` with `SummaryRow` / `SummaryCell`.
  - Every report table passes `reportPagination(printing, …)`, so Print prints every row.
- **JSX and Server Components.**
  - In JSX text, never put an HTML entity (`&apos;`, `&quot;`) right after an element; the SWC build drops the leading space. Use the typographic ’ or a `{"…"}` expression.
  - Server Components (`page.tsx`) never read Ant Design sub-components (`Typography.Title`, `Form.Item`, …).
- **Data.** The repository is public: tests use invented data only, never real client names or figures.
- **Commits.**
  - Stage files by name; never use `git add -A` or `git add .`. Never stage `.claude/settings.json`, which carries an unrelated local change.
  - No Co-Authored-By trailer, and no mention of Claude or AI in commit messages.
- **Database.** Live tests are read-only and run alone, never two database scripts at once. Never write to a real company's books. The sample company PC-Test is the only place a budget may be saved, and only in the controller's smoke.
- **Gates.**
  - Run from `ctyhp-accounting/`.
  - If tsc complains about stale `.next/types`, delete `.next/types` and rerun.
  - Read the pass/fail lines in full. Never pipe them through `tail` or `head`.

---

### Task 1: Financial Ratios, and the shared inventory-account rule

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/inventory-accounts.test.ts`
- Test (create): `ctyhp-accounting/tests/unit/financial-ratios.test.ts`
- Create: `ctyhp-accounting/lib/domain/inventory-accounts.ts`
- Create: `ctyhp-accounting/lib/services/inventory-accounts.ts`
- Create: `ctyhp-accounting/lib/domain/financial-ratios.ts`
- Create: `ctyhp-accounting/lib/services/financial-ratios.ts`
- Create: `ctyhp-accounting/app/(app)/reports/financial-ratios/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/financial-ratios/FinancialRatiosClient.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/financial-ratios/page.tsx`

**Interfaces:**
- Consumes (existing): `getLedgerBalances` (`lib/services/reports.ts`), `buildBalanceSheet`, `buildProfitAndLoss` (`lib/domain/reports.ts`), `readAllPages` (`lib/services/paging.ts`), `SimpleReport`, `reportPagination` (`components/reports/SimpleReport.tsx`), `reportPageContext` (`lib/services/report-context.ts`), `checkWhen`, `reportFailure` (`lib/domain/report-run.ts`).
- Produces: `pickInventoryAccounts(...)` → `InventoryAccountPick`, `INVENTORY_CASH_FLOW_ROLE` (`lib/domain/inventory-accounts.ts`); `getInventoryAccounts(sb)` (`lib/services/inventory-accounts.ts`) — Task 2 reuses both. `buildFinancialRatios`, `RATIOS`, `RATIO_GROUPS`, `ratioArrow`, `financialRatiosSheet` (`lib/domain/financial-ratios.ts`); `getFinancialRatios(sb, from, to)` (`lib/services/financial-ratios.ts`); the page `/reports/financial-ratios`. Its catalog card arrives in Task 6.

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/inventory-accounts.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import { pickInventoryAccounts, type InventoryAccountCandidate } from "@/lib/domain/inventory-accounts";
import { getInventoryAccounts } from "@/lib/services/inventory-accounts";

const account = (over: Partial<InventoryAccountCandidate> & { id: string }): InventoryAccountCandidate => ({
  name: "Something",
  accountType: "current_asset",
  cashFlowRole: null,
  ...over,
});

describe("pickInventoryAccounts", () => {
  it("takes the accounts inventory items post to", () => {
    const pick = pickInventoryAccounts({
      itemInventoryAccountIds: ["a2", "a2", null],
      accounts: [account({ id: "a1", name: "Stock room" }), account({ id: "a2", name: "Goods" })],
    });
    expect(pick).toEqual({ accountIds: ["a2"], basis: "items-or-role" });
  });

  it("adds accounts whose cash-flow role is operating_inventory", () => {
    const pick = pickInventoryAccounts({
      itemInventoryAccountIds: ["a3"],
      accounts: [account({ id: "a1", cashFlowRole: "operating_inventory" }), account({ id: "a3" })],
    });
    expect(pick).toEqual({ accountIds: ["a1", "a3"], basis: "items-or-role" });
  });

  it("uses the role alone when no item names an account", () => {
    const pick = pickInventoryAccounts({
      itemInventoryAccountIds: [],
      accounts: [account({ id: "a1", name: "Goods", cashFlowRole: "operating_inventory" })],
    });
    expect(pick.accountIds).toEqual(["a1"]);
  });

  it("falls back to current assets named inventory or stock only when both are empty", () => {
    const accounts = [
      account({ id: "a1", name: "Inventory" }),
      account({ id: "a2", name: "Raw STOCK" }),
      account({ id: "a3", name: "Stockholder loan", accountType: "current_liability" }),
      account({ id: "a4", name: "Prepaid rent" }),
    ];
    expect(pickInventoryAccounts({ itemInventoryAccountIds: [], accounts })).toEqual({
      accountIds: ["a1", "a2"],
      basis: "name",
    });
    // The fallback is not consulted once the first rule finds something.
    expect(pickInventoryAccounts({ itemInventoryAccountIds: ["a4"], accounts })).toEqual({
      accountIds: ["a4"],
      basis: "items-or-role",
    });
  });

  it("finds nothing in a chart with no stock", () => {
    expect(pickInventoryAccounts({ itemInventoryAccountIds: [null], accounts: [account({ id: "a1", name: "Cash drawer", accountType: "bank" })] })).toEqual({
      accountIds: [],
      basis: "none",
    });
  });
});

/** A client whose tables answer with fixed rows and honour only the page range. */
function fakeClient(tables: Record<string, Record<string, unknown>[]>, seen: string[] = []) {
  return {
    from(table: string) {
      seen.push(table);
      const state = { range: [0, 999] as [number, number], filters: [] as string[] };
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.order = self;
      chain.eq = (column: string, value: unknown) => {
        state.filters.push(`${column}=${String(value)}`);
        return chain;
      };
      chain.not = (column: string) => {
        state.filters.push(`${column} not null`);
        return chain;
      };
      chain.range = (from: number, to: number) => {
        state.range = [from, to];
        return chain;
      };
      chain.then = (resolve: (v: unknown) => unknown) => {
        let rows = tables[table] ?? [];
        if (state.filters.includes("is_inventory=true")) rows = rows.filter((r) => r.is_inventory === true);
        if (state.filters.includes("inventory_account_id not null")) rows = rows.filter((r) => r.inventory_account_id !== null);
        return resolve({ data: rows.slice(state.range[0], state.range[1] + 1), error: null });
      };
      return chain;
    },
  };
}

describe("getInventoryAccounts", () => {
  it("reads items and the chart and applies the rule", async () => {
    const sb = fakeClient({
      acc_item: [
        { id: "i1", is_inventory: true, inventory_account_id: "a2" },
        { id: "i2", is_inventory: false, inventory_account_id: "a1" },
        { id: "i3", is_inventory: true, inventory_account_id: null },
      ],
      acc_account: [
        { id: "a1", name: "Inventory", account_type: "current_asset", cash_flow_role: null },
        { id: "a2", name: "Goods", account_type: "current_asset", cash_flow_role: null },
        { id: "a3", name: "Gold", account_type: "current_asset", cash_flow_role: "operating_inventory" },
      ],
    });
    const pick = await getInventoryAccounts(sb as never);
    expect(pick).toEqual({ accountIds: ["a2", "a3"], basis: "items-or-role" });
  });

  it("pages past 1,000 rows", async () => {
    const accounts = Array.from({ length: 2_300 }, (_, n) => ({
      id: `a${String(n).padStart(5, "0")}`,
      name: n === 2_250 ? "Inventory" : "Other",
      account_type: "current_asset",
      cash_flow_role: null,
    }));
    const pick = await getInventoryAccounts(fakeClient({ acc_item: [], acc_account: accounts }) as never);
    expect(pick).toEqual({ accountIds: ["a02250"], basis: "name" });
  });
});
```

- [ ] **Step 2: Create `ctyhp-accounting/tests/unit/financial-ratios.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import {
  RATIOS,
  RATIO_GROUPS,
  arrowText,
  buildFinancialRatios,
  buildRatioWorkings,
  daysInPeriod,
  financialRatiosSheet,
  formatRatio,
  ratioArrow,
  shiftBackOneYear,
  workingsRows,
  yearEarlierRange,
  type RatioWorkings,
} from "@/lib/domain/financial-ratios";
import type { LedgerBalance } from "@/lib/domain/reports";

const bal = (accountId: string, accountType: LedgerBalance["accountType"], debitBase: number, creditBase: number, name = accountId): LedgerBalance => ({
  accountId,
  accountCode: accountId,
  name,
  accountType,
  debitBase,
  creditBase,
});

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

/** Round numbers so each formula can be checked by hand. 100-day period. */
const W: RatioWorkings = {
  cashMinor: 20_000,
  receivablesMinor: 30_000,
  inventoryMinor: 10_000,
  currentAssetsMinor: 60_000,
  totalAssetsMinor: 100_000,
  currentLiabilitiesMinor: 30_000,
  totalLiabilitiesMinor: 50_000,
  accountsPayableMinor: 15_000,
  equityMinor: 50_000,
  incomeMinor: 200_000,
  costOfGoodsSoldMinor: 80_000,
  runningCostsMinor: 60_000,
  otherExpensesMinor: 10_000,
  grossProfitMinor: 120_000,
  operatingIncomeMinor: 60_000,
  netIncomeMinor: 50_000,
  interestMinor: 20_000,
  days: 100,
};

const ratio = (id: string, w: RatioWorkings = W) => RATIOS.find((r) => r.id === id)!.compute(w);

describe("buildRatioWorkings", () => {
  const balances = [
    bal("bank", "bank", 50_000, 10_000),
    bal("ar", "accounts_receivable", 30_000, 0),
    bal("inv", "current_asset", 12_000, 2_000),
    bal("prepaid", "current_asset", 3_000, 0),
    bal("fixed", "fixed_asset", 40_000, 0),
    bal("ap", "accounts_payable", 0, 20_000),
    bal("card", "credit_card", 0, 5_000),
    bal("tax", "current_liability", 0, 4_000),
    bal("loan", "long_term_liability", 0, 30_000),
    bal("cap", "equity", 0, 28_500),
    bal("sales", "income", 0, 90_000),
    bal("cogs", "cost_of_goods_sold", 30_000, 0),
    bal("rent", "expense", 20_000, 0),
    bal("interest", "expense", 5_000, 0, "Loan Interest"),
    bal("bankint", "other_expense", 1_000, 0, "Bank interest paid"),
    bal("bankfee", "other_expense", 500, 0, "Bank fees"),
    bal("gain", "other_income", 0, 2_000),
  ];
  // Total equity with current earnings: capital 28,500 + net income.
  const flow = balances.filter((r) => ["income", "cost_of_goods_sold", "expense", "other_expense", "other_income"].includes(r.accountType));
  const w = buildRatioWorkings({ balances, flow, inventoryAccountIds: new Set(["inv"]), from: "2026-01-01", to: "2026-03-31" });

  it("sorts balances into the workings by account type", () => {
    expect(w.cashMinor).toBe(40_000);
    expect(w.receivablesMinor).toBe(30_000);
    expect(w.inventoryMinor).toBe(10_000);
    expect(w.currentAssetsMinor).toBe(40_000 + 30_000 + 10_000 + 3_000);
    expect(w.totalAssetsMinor).toBe(w.currentAssetsMinor + 40_000);
    expect(w.accountsPayableMinor).toBe(20_000);
    expect(w.currentLiabilitiesMinor).toBe(29_000);
    expect(w.totalLiabilitiesMinor).toBe(59_000);
  });

  it("takes flow figures from the profit and loss, and interest by name from both expense kinds", () => {
    expect(w.incomeMinor).toBe(90_000);
    expect(w.costOfGoodsSoldMinor).toBe(30_000);
    expect(w.runningCostsMinor).toBe(25_000);
    expect(w.otherExpensesMinor).toBe(1_500);
    expect(w.grossProfitMinor).toBe(60_000);
    expect(w.operatingIncomeMinor).toBe(35_000);
    expect(w.netIncomeMinor).toBe(35_000 + 2_000 - 1_500);
    expect(w.interestMinor).toBe(6_000);
    expect(w.days).toBe(90);
  });

  it("includes profit to date in equity, so the sheet balances", () => {
    expect(w.equityMinor).toBe(28_500 + w.netIncomeMinor);
    expect(w.totalAssetsMinor).toBe(w.totalLiabilitiesMinor + w.equityMinor);
  });
});

describe("daysInPeriod", () => {
  it("counts both ends and never goes below 1", () => {
    expect(daysInPeriod("2026-01-01", "2026-01-31")).toBe(31);
    expect(daysInPeriod("2026-03-05", "2026-03-05")).toBe(1);
    expect(daysInPeriod("2024-01-01", "2024-12-31")).toBe(366);
  });
});

describe("the fifteen ratios", () => {
  it("has the spec's fifteen, four groups, in order", () => {
    expect(RATIOS).toHaveLength(15);
    expect(RATIO_GROUPS.map((g) => g.label)).toEqual([
      "Can it pay its bills",
      "Does it make money",
      "How fast money moves",
      "How much is borrowed",
    ]);
    expect(RATIOS.map((r) => r.name)).toEqual([
      "Current ratio",
      "Quick ratio",
      "Working capital",
      "Months of cash",
      "Gross margin",
      "Operating margin",
      "Net margin",
      "Return on assets, a year",
      "Return on equity, a year",
      "Days to get paid",
      "Days to pay suppliers",
      "Days of stock",
      "Debt to equity",
      "Debt ratio",
      "Interest cover",
    ]);
  });

  it("works each formula out", () => {
    expect(ratio("current-ratio")).toBe(2);
    expect(ratio("quick-ratio")).toBeCloseTo(50_000 / 30_000);
    expect(ratio("working-capital")).toBe(30_000);
    // spend 150,000 over 100 days = 150,000 / (100 / 30.44) a month
    expect(ratio("months-of-cash")).toBeCloseTo(20_000 / (150_000 / (100 / 30.44)));
    expect(ratio("gross-margin")).toBeCloseTo(0.6);
    expect(ratio("operating-margin")).toBeCloseTo(0.3);
    expect(ratio("net-margin")).toBeCloseTo(0.25);
    expect(ratio("return-on-assets")).toBeCloseTo((50_000 * 3.65) / 100_000);
    expect(ratio("return-on-equity")).toBeCloseTo((50_000 * 3.65) / 50_000);
    expect(ratio("days-to-get-paid")).toBeCloseTo(30_000 / (200_000 / 100));
    expect(ratio("days-to-pay-suppliers")).toBeCloseTo(15_000 / (140_000 / 100));
    expect(ratio("days-of-stock")).toBeCloseTo(10_000 / (80_000 / 100));
    expect(ratio("debt-to-equity")).toBe(1);
    expect(ratio("debt-ratio")).toBe(0.5);
    expect(ratio("interest-cover")).toBe(3);
  });

  it("is blank where there is nothing to divide by", () => {
    const empty: RatioWorkings = {
      ...W,
      currentLiabilitiesMinor: 0,
      incomeMinor: 0,
      costOfGoodsSoldMinor: 0,
      runningCostsMinor: 0,
      otherExpensesMinor: 0,
      totalAssetsMinor: 0,
    };
    for (const id of ["current-ratio", "quick-ratio", "months-of-cash", "gross-margin", "operating-margin", "net-margin", "return-on-assets", "days-to-get-paid", "days-to-pay-suppliers", "days-of-stock", "debt-ratio"]) {
      expect(ratio(id, empty), id).toBeNull();
    }
    // Working capital is a difference, so it always has a value.
    expect(ratio("working-capital", empty)).toBe(60_000);
  });

  it("blanks the equity ratios when equity is zero or negative", () => {
    for (const equityMinor of [0, -5_000]) {
      const w = { ...W, equityMinor };
      expect(ratio("return-on-equity", w)).toBeNull();
      expect(ratio("debt-to-equity", w)).toBeNull();
    }
  });

  it("blanks interest cover when there is no interest", () => {
    expect(ratio("interest-cover", { ...W, interestMinor: 0 })).toBeNull();
  });

  it("scales the yearly returns by the length of the period", () => {
    expect(ratio("return-on-assets", { ...W, days: 365 })).toBeCloseTo(0.5);
  });
});

describe("formatRatio", () => {
  it("formats each kind and dashes a blank", () => {
    expect(formatRatio("ratio", 1.5, money)).toBe("1.50");
    expect(formatRatio("money", 123_456, money)).toBe("$1234.56");
    expect(formatRatio("percent", 0.256, money)).toBe("25.6%");
    expect(formatRatio("months", 3.04, money)).toBe("3.0 months");
    expect(formatRatio("days", 41.6, money)).toBe("42 days");
    expect(formatRatio("ratio", null, money)).toBe("—");
  });
});

describe("ratioArrow", () => {
  it("is empty when either side is blank", () => {
    expect(ratioArrow(null, 1, "higher")).toBeNull();
    expect(ratioArrow(1, null, "higher")).toBeNull();
  });

  it("is steady under the larger of 0.005 and 1% of the earlier value", () => {
    // 1% of 2.00 = 0.02 beats 0.005.
    expect(ratioArrow(2.019, 2, "higher")).toEqual({ kind: "steady" });
    expect(ratioArrow(1.981, 2, "higher")).toEqual({ kind: "steady" });
    expect(ratioArrow(2.021, 2, "higher")).toEqual({ kind: "moved", up: true, verdict: "better" });
    // Near zero the 0.005 floor applies.
    expect(ratioArrow(0.004, 0, "higher")).toEqual({ kind: "steady" });
    expect(ratioArrow(0.006, 0, "higher")).toEqual({ kind: "moved", up: true, verdict: "better" });
    // 1% of a negative earlier value uses its size.
    expect(ratioArrow(-1.005, -1, "higher")).toEqual({ kind: "steady" });
  });

  it("judges better or worse by direction", () => {
    expect(ratioArrow(3, 2, "higher")).toEqual({ kind: "moved", up: true, verdict: "better" });
    expect(ratioArrow(1, 2, "higher")).toEqual({ kind: "moved", up: false, verdict: "worse" });
    expect(ratioArrow(30, 40, "lower")).toEqual({ kind: "moved", up: false, verdict: "better" });
    expect(ratioArrow(50, 40, "lower")).toEqual({ kind: "moved", up: true, verdict: "worse" });
  });

  it("calls a neutral ratio longer or shorter, never better or worse", () => {
    expect(ratioArrow(50, 40, "neutral")).toEqual({ kind: "moved", up: true, verdict: "longer" });
    expect(ratioArrow(30, 40, "neutral")).toEqual({ kind: "moved", up: false, verdict: "shorter" });
    expect(ratioArrow(40.1, 40, "neutral")).toEqual({ kind: "steady" });
  });

  it("words the arrow", () => {
    expect(arrowText(null)).toBe("");
    expect(arrowText({ kind: "steady" })).toBe("steady");
    expect(arrowText({ kind: "moved", up: true, verdict: "better" })).toBe("▲ better");
    expect(arrowText({ kind: "moved", up: false, verdict: "shorter" })).toBe("▼ shorter");
  });
});

describe("the year-earlier range", () => {
  it("shifts back one year", () => {
    expect(shiftBackOneYear("2026-10-09")).toBe("2025-10-09");
    expect(shiftBackOneYear("2026-01-01")).toBe("2025-01-01");
  });

  it("clamps Feb 29 to Feb 28, and leaves a leap day that exists alone", () => {
    expect(shiftBackOneYear("2024-02-29")).toBe("2023-02-28");
    expect(shiftBackOneYear("2025-02-28")).toBe("2024-02-28");
    expect(shiftBackOneYear("2028-02-29")).toBe("2027-02-28");
    expect(yearEarlierRange("2024-01-01", "2024-02-29")).toEqual({ from: "2023-01-01", to: "2023-02-28" });
  });
});

describe("buildFinancialRatios", () => {
  const before: RatioWorkings = { ...W, currentAssetsMinor: 40_000, currentLiabilitiesMinor: 40_000 };

  it("pairs each ratio with its year-earlier value and arrow", () => {
    const report = buildFinancialRatios({ from: "2026-01-01", to: "2026-04-10", current: W, earlier: before });
    expect(report.earlierFrom).toBe("2025-01-01");
    expect(report.earlierTo).toBe("2025-04-10");
    const current = report.rows.find((r) => r.id === "current-ratio")!;
    expect(current.current).toBe(2);
    expect(current.earlier).toBe(1);
    expect(current.arrow).toEqual({ kind: "moved", up: true, verdict: "better" });
    expect(report.rows).toHaveLength(15);
  });

  it("leaves the earlier column blank when that period had neither assets nor income", () => {
    const nothing: RatioWorkings = { ...W, totalAssetsMinor: 0, incomeMinor: 0 };
    const report = buildFinancialRatios({ from: "2026-01-01", to: "2026-04-10", current: W, earlier: nothing });
    expect(report.earlier).toBeNull();
    expect(report.rows.every((r) => r.earlier === null && r.arrow === null)).toBe(true);
    // Assets alone, or income alone, still count as activity.
    expect(buildFinancialRatios({ from: "2026-01-01", to: "2026-04-10", current: W, earlier: { ...nothing, incomeMinor: 5 } }).earlier).not.toBeNull();
    expect(buildFinancialRatios({ from: "2026-01-01", to: "2026-04-10", current: W, earlier: { ...nothing, totalAssetsMinor: 5 } }).earlier).not.toBeNull();
  });
});

describe("the export sheet", () => {
  const report = buildFinancialRatios({ from: "2026-01-01", to: "2026-04-10", current: W, earlier: { ...W, currentAssetsMinor: 40_000, currentLiabilitiesMinor: 40_000 } });
  const sheet = financialRatiosSheet(report, { companyName: "Example Co", currencyCode: "USD", money });

  it("carries the fifteen ratios by group, then the sixteen workings", () => {
    expect(sheet.fileName).toBe("financial-ratios-2026-01-01-to-2026-04-10");
    expect(sheet.title).toBe("Financial Ratios");
    expect(sheet.rows).toHaveLength(15 + 16);
    expect(sheet.rows[0]).toMatchObject({ section: "Can it pay its bills", item: "Current ratio", current: "2.00", earlier: "1.00", change: "▲ better" });
    expect(sheet.rows[15]).toMatchObject({ section: "The figures behind them", item: "Cash and bank", current: "$200.00" });
    expect(sheet.rows.at(-1)).toMatchObject({ item: "Days in the period", current: "100", earlier: "100" });
  });

  it("leaves the earlier cells empty when that column is blank", () => {
    const blank = buildFinancialRatios({ from: "2026-01-01", to: "2026-04-10", current: W, earlier: { ...W, totalAssetsMinor: 0, incomeMinor: 0 } });
    const rows = financialRatiosSheet(blank, { companyName: "Example Co", currencyCode: "USD", money }).rows;
    expect(rows.every((r) => r.earlier === "—" || r.earlier === "")).toBe(true);
    expect(workingsRows(blank.current, blank.earlier).every((r) => r.earlier === null)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

```bash
npx vitest run tests/unit/inventory-accounts.test.ts tests/unit/financial-ratios.test.ts
```

Expected: FAIL — `lib/domain/inventory-accounts.ts` and `lib/domain/financial-ratios.ts` do not exist yet ("Failed to resolve import").

- [ ] **Step 4: Create `ctyhp-accounting/lib/domain/inventory-accounts.ts`** with exactly this content:

```ts
/**
 * Which accounts hold a company's stock. One rule, shared by every report that
 * needs it (Financial Ratios, Purchases and Inventory), so two reports can
 * never disagree about what "inventory" is.
 *
 *  1. Accounts an inventory item posts its stock to (`acc_item.inventory_account_id`
 *     on items with `is_inventory`), plus accounts whose cash-flow role is
 *     `operating_inventory`.
 *  2. Only when that finds nothing: asset accounts of type `current_asset`
 *     whose name reads as stock ("Inventory", "Stock").
 */

/** The fields of an account this rule looks at. */
export interface InventoryAccountCandidate {
  id: string;
  name: string;
  accountType: string;
  cashFlowRole: string | null;
}

/** Which branch of the rule decided the answer. */
export type InventoryAccountBasis = "items-or-role" | "name" | "none";

export interface InventoryAccountPick {
  /** The inventory accounts' ids, in a stable (sorted) order. */
  accountIds: string[];
  basis: InventoryAccountBasis;
}

export const INVENTORY_CASH_FLOW_ROLE = "operating_inventory";
const INVENTORY_NAME = /inventory|stock/i;

export function pickInventoryAccounts(input: {
  /** `inventory_account_id` of every item with `is_inventory`; nulls are skipped. */
  itemInventoryAccountIds: readonly (string | null)[];
  accounts: readonly InventoryAccountCandidate[];
}): InventoryAccountPick {
  const chosen = new Set<string>();
  for (const id of input.itemInventoryAccountIds) if (id) chosen.add(id);
  for (const account of input.accounts) {
    if (account.cashFlowRole === INVENTORY_CASH_FLOW_ROLE) chosen.add(account.id);
  }
  if (chosen.size > 0) return { accountIds: [...chosen].sort(), basis: "items-or-role" };

  for (const account of input.accounts) {
    if (account.accountType === "current_asset" && INVENTORY_NAME.test(account.name)) chosen.add(account.id);
  }
  return { accountIds: [...chosen].sort(), basis: chosen.size > 0 ? "name" : "none" };
}
```

- [ ] **Step 5: Create `ctyhp-accounting/lib/services/inventory-accounts.ts`** with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pickInventoryAccounts,
  type InventoryAccountCandidate,
  type InventoryAccountPick,
} from "@/lib/domain/inventory-accounts";
import { readAllPages } from "./paging";

export class InventoryAccountsError extends Error {}

const fail = (message: string) => new InventoryAccountsError(message);

/**
 * The company's inventory accounts by the shared rule in
 * `lib/domain/inventory-accounts`. Reads inventory items' accounts and the
 * chart, both paged with the row id last in the order so no row can straddle
 * a page.
 */
export async function getInventoryAccounts(sb: SupabaseClient): Promise<InventoryAccountPick> {
  const [items, accounts] = await Promise.all([
    readAllPages<{ inventory_account_id: string | null }>(
      (from, to) =>
        sb
          .from("acc_item")
          .select("id,inventory_account_id")
          .eq("is_inventory", true)
          .not("inventory_account_id", "is", null)
          .order("id")
          .range(from, to),
      fail,
    ),
    readAllPages<{ id: string; name: string; account_type: string; cash_flow_role: string | null }>(
      (from, to) => sb.from("acc_account").select("id,name,account_type,cash_flow_role").order("id").range(from, to),
      fail,
    ),
  ]);
  const candidates: InventoryAccountCandidate[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    accountType: a.account_type,
    cashFlowRole: a.cash_flow_role,
  }));
  return pickInventoryAccounts({
    itemInventoryAccountIds: items.map((i) => i.inventory_account_id),
    accounts: candidates,
  });
}
```

- [ ] **Step 6: Create `ctyhp-accounting/lib/domain/financial-ratios.ts`** with exactly this content:

```ts
/**
 * Financial Ratios: fifteen ratios worked out from the statements, this period
 * beside the same period a year earlier. Pure: the service reads the ledger,
 * this turns balances into the workings, the ratios, the arrows and the export.
 *
 * Money is integer minor units of the base currency. A ratio is a plain
 * number (a margin is a fraction: 0.25 is 25%); `null` means there was nothing
 * to divide by, and the screen shows a dash.
 */
import { naturalBalance } from "./accounts";
import { buildBalanceSheet, buildProfitAndLoss, type LedgerBalance } from "./reports";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";

// --- The workings --------------------------------------------------------------

export interface RatioWorkings {
  cashMinor: number;
  receivablesMinor: number;
  inventoryMinor: number;
  currentAssetsMinor: number;
  totalAssetsMinor: number;
  currentLiabilitiesMinor: number;
  totalLiabilitiesMinor: number;
  accountsPayableMinor: number;
  /** Total equity including profit to date, as the Balance Sheet shows it. */
  equityMinor: number;
  incomeMinor: number;
  costOfGoodsSoldMinor: number;
  /** Operating expenses: the Profit and Loss's `expense` accounts. */
  runningCostsMinor: number;
  otherExpensesMinor: number;
  grossProfitMinor: number;
  operatingIncomeMinor: number;
  netIncomeMinor: number;
  interestMinor: number;
  /** From to To inclusive, at least 1. */
  days: number;
}

const INTEREST_NAME = /interest/i;

/** Days from `from` to `to` inclusive, at least 1. */
export function daysInPeriod(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 1;
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

/**
 * The figures behind the ratios.
 * - `balances`: the ledger cumulative to the To date (the Balance Sheet's input).
 * - `flow`: the ledger over From to To (the Profit and Loss's input).
 * - `inventoryAccountIds`: the company's inventory accounts.
 */
export function buildRatioWorkings(input: {
  balances: readonly LedgerBalance[];
  flow: readonly LedgerBalance[];
  inventoryAccountIds: ReadonlySet<string>;
  from: string;
  to: string;
}): RatioWorkings {
  const balances = [...input.balances];
  const sheet = buildBalanceSheet(balances);
  const pnl = buildProfitAndLoss([...input.flow]);

  const sumOf = (types: readonly string[]) =>
    balances
      .filter((r) => types.includes(r.accountType))
      .reduce((sum, r) => sum + naturalBalance(r.accountType, r.debitBase, r.creditBase), 0);

  const cash = sumOf(["bank"]);
  const receivables = sumOf(["accounts_receivable"]);
  const currentAssets = sumOf(["bank", "accounts_receivable", "current_asset"]);
  const accountsPayable = sumOf(["accounts_payable"]);
  const currentLiabilities = sumOf(["accounts_payable", "credit_card", "current_liability"]);
  const inventory = balances
    .filter((r) => input.inventoryAccountIds.has(r.accountId))
    .reduce((sum, r) => sum + naturalBalance(r.accountType, r.debitBase, r.creditBase), 0);

  const interest = [...pnl.operatingExpenses.lines, ...pnl.otherExpenses.lines]
    .filter((line) => INTEREST_NAME.test(line.name))
    .reduce((sum, line) => sum + line.amount, 0);

  return {
    cashMinor: cash,
    receivablesMinor: receivables,
    inventoryMinor: inventory,
    currentAssetsMinor: currentAssets,
    totalAssetsMinor: sheet.totalAssets,
    currentLiabilitiesMinor: currentLiabilities,
    totalLiabilitiesMinor: sheet.totalLiabilities,
    accountsPayableMinor: accountsPayable,
    equityMinor: sheet.totalEquity,
    incomeMinor: pnl.income.total,
    costOfGoodsSoldMinor: pnl.costOfGoodsSold.total,
    runningCostsMinor: pnl.operatingExpenses.total,
    otherExpensesMinor: pnl.otherExpenses.total,
    grossProfitMinor: pnl.grossProfit,
    operatingIncomeMinor: pnl.grossProfit - pnl.operatingExpenses.total,
    netIncomeMinor: pnl.netIncome,
    interestMinor: interest,
    days: daysInPeriod(input.from, input.to),
  };
}

// --- The year-earlier period -----------------------------------------------------

/** The same day one year earlier; Feb 29 becomes Feb 28 (the end is clamped to the month's end). */
export function shiftBackOneYear(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const year = y - 1;
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(m)}-${pad(Math.min(d, lastDay))}`;
}

export function yearEarlierRange(from: string, to: string): { from: string; to: string } {
  return { from: shiftBackOneYear(from), to: shiftBackOneYear(to) };
}

/** An earlier period with neither assets nor income has nothing to compare: its column is left blank. */
export function hasActivity(w: RatioWorkings): boolean {
  return w.totalAssetsMinor !== 0 || w.incomeMinor !== 0;
}

// --- The fifteen ratios ----------------------------------------------------------

export type RatioGroupId = "pay-bills" | "make-money" | "money-moves" | "borrowed";
export type RatioFormat = "ratio" | "money" | "percent" | "months" | "days";
export type RatioDirection = "higher" | "lower" | "neutral";

export const RATIO_GROUPS: ReadonlyArray<{ id: RatioGroupId; label: string }> = [
  { id: "pay-bills", label: "Can it pay its bills" },
  { id: "make-money", label: "Does it make money" },
  { id: "money-moves", label: "How fast money moves" },
  { id: "borrowed", label: "How much is borrowed" },
];

export interface RatioDefinition {
  id: string;
  group: RatioGroupId;
  name: string;
  /** One line under the name, in plain words. */
  meaning: string;
  format: RatioFormat;
  better: RatioDirection;
  compute: (w: RatioWorkings) => number | null;
}

const divide = (top: number, bottom: number): number | null => (bottom === 0 ? null : top / bottom);
const yearly = (w: RatioWorkings) => (w.netIncomeMinor * 365) / w.days;
const DAYS_PER_MONTH = 30.44;

export const RATIOS: readonly RatioDefinition[] = [
  {
    id: "current-ratio",
    group: "pay-bills",
    name: "Current ratio",
    meaning: "Current assets for each dollar of current liabilities.",
    format: "ratio",
    better: "higher",
    compute: (w) => divide(w.currentAssetsMinor, w.currentLiabilitiesMinor),
  },
  {
    id: "quick-ratio",
    group: "pay-bills",
    name: "Quick ratio",
    meaning: "Cash and receivables for each dollar of current liabilities.",
    format: "ratio",
    better: "higher",
    compute: (w) => divide(w.cashMinor + w.receivablesMinor, w.currentLiabilitiesMinor),
  },
  {
    id: "working-capital",
    group: "pay-bills",
    name: "Working capital",
    meaning: "What is left of current assets after current liabilities.",
    format: "money",
    better: "higher",
    compute: (w) => w.currentAssetsMinor - w.currentLiabilitiesMinor,
  },
  {
    id: "months-of-cash",
    group: "pay-bills",
    name: "Months of cash",
    meaning: "How long cash on hand covers the period’s spending.",
    format: "months",
    better: "higher",
    compute: (w) => {
      const spend = w.costOfGoodsSoldMinor + w.runningCostsMinor + w.otherExpensesMinor;
      return divide(w.cashMinor, spend / (w.days / DAYS_PER_MONTH));
    },
  },
  {
    id: "gross-margin",
    group: "make-money",
    name: "Gross margin",
    meaning: "Share of income left after the cost of goods sold.",
    format: "percent",
    better: "higher",
    compute: (w) => divide(w.grossProfitMinor, w.incomeMinor),
  },
  {
    id: "operating-margin",
    group: "make-money",
    name: "Operating margin",
    meaning: "Share of income left after running costs.",
    format: "percent",
    better: "higher",
    compute: (w) => divide(w.operatingIncomeMinor, w.incomeMinor),
  },
  {
    id: "net-margin",
    group: "make-money",
    name: "Net margin",
    meaning: "Share of income that ends up as net income.",
    format: "percent",
    better: "higher",
    compute: (w) => divide(w.netIncomeMinor, w.incomeMinor),
  },
  {
    id: "return-on-assets",
    group: "make-money",
    name: "Return on assets, a year",
    meaning: "Net income for a year at this pace, for each dollar of assets.",
    format: "percent",
    better: "higher",
    compute: (w) => divide(yearly(w), w.totalAssetsMinor),
  },
  {
    id: "return-on-equity",
    group: "make-money",
    name: "Return on equity, a year",
    meaning: "Net income for a year at this pace, for each dollar of equity.",
    format: "percent",
    better: "higher",
    compute: (w) => (w.equityMinor <= 0 ? null : divide(yearly(w), w.equityMinor)),
  },
  {
    id: "days-to-get-paid",
    group: "money-moves",
    name: "Days to get paid",
    meaning: "How long customers take to pay, on average.",
    format: "days",
    better: "lower",
    compute: (w) => divide(w.receivablesMinor, w.incomeMinor / w.days),
  },
  {
    id: "days-to-pay-suppliers",
    group: "money-moves",
    name: "Days to pay suppliers",
    meaning: "How long the business takes to pay what it owes.",
    format: "days",
    better: "neutral",
    compute: (w) => divide(w.accountsPayableMinor, (w.costOfGoodsSoldMinor + w.runningCostsMinor) / w.days),
  },
  {
    id: "days-of-stock",
    group: "money-moves",
    name: "Days of stock",
    meaning: "How long the stock on hand would last at the cost of goods sold.",
    format: "days",
    better: "lower",
    compute: (w) => divide(w.inventoryMinor, w.costOfGoodsSoldMinor / w.days),
  },
  {
    id: "debt-to-equity",
    group: "borrowed",
    name: "Debt to equity",
    meaning: "Liabilities for each dollar of equity.",
    format: "ratio",
    better: "lower",
    compute: (w) => (w.equityMinor <= 0 ? null : divide(w.totalLiabilitiesMinor, w.equityMinor)),
  },
  {
    id: "debt-ratio",
    group: "borrowed",
    name: "Debt ratio",
    meaning: "Share of assets that is owed to others.",
    format: "percent",
    better: "lower",
    compute: (w) => divide(w.totalLiabilitiesMinor, w.totalAssetsMinor),
  },
  {
    id: "interest-cover",
    group: "borrowed",
    name: "Interest cover",
    meaning: "How many times operating income covers the interest.",
    format: "ratio",
    better: "higher",
    compute: (w) => divide(w.operatingIncomeMinor, w.interestMinor),
  },
];

/** Show a ratio the way its format says; a blank is a dash. */
export function formatRatio(format: RatioFormat, value: number | null, money: (minor: number) => string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  switch (format) {
    case "ratio":
      return value.toFixed(2);
    case "money":
      return money(Math.round(value));
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "months":
      return `${value.toFixed(1)} months`;
    case "days":
      return `${Math.round(value).toLocaleString("en-US")} days`;
  }
}

// --- The arrow --------------------------------------------------------------------

export type RatioArrow =
  | { kind: "steady" }
  | { kind: "moved"; up: boolean; verdict: "better" | "worse" | "longer" | "shorter" };

/** The smallest change that counts: the larger of 0.005 and 1% of the earlier value. */
export function arrowThreshold(previous: number): number {
  return Math.max(0.005, Math.abs(previous) * 0.01);
}

/**
 * How a ratio moved. Null when either side is blank. "Steady" when the change is
 * under the threshold; otherwise the direction, judged better or worse by the
 * ratio's own direction (a neutral ratio is only longer or shorter).
 */
export function ratioArrow(current: number | null, previous: number | null, better: RatioDirection): RatioArrow | null {
  if (current === null || previous === null) return null;
  const change = current - previous;
  if (Math.abs(change) < arrowThreshold(previous)) return { kind: "steady" };
  const up = change > 0;
  if (better === "neutral") return { kind: "moved", up, verdict: up ? "longer" : "shorter" };
  const good = better === "higher" ? up : !up;
  return { kind: "moved", up, verdict: good ? "better" : "worse" };
}

// --- The report -------------------------------------------------------------------

export interface RatioRow {
  id: string;
  group: RatioGroupId;
  name: string;
  meaning: string;
  format: RatioFormat;
  better: RatioDirection;
  current: number | null;
  /** Null for every row when the earlier column is blank. */
  earlier: number | null;
  arrow: RatioArrow | null;
}

export interface FinancialRatiosReport {
  from: string;
  to: string;
  earlierFrom: string;
  earlierTo: string;
  current: RatioWorkings;
  /** Null when the earlier period had neither assets nor income. */
  earlier: RatioWorkings | null;
  rows: RatioRow[];
}

export function buildFinancialRatios(input: {
  from: string;
  to: string;
  current: RatioWorkings;
  /** The year-earlier workings, as read; this decides itself whether they are blank. */
  earlier: RatioWorkings;
}): FinancialRatiosReport {
  const range = yearEarlierRange(input.from, input.to);
  const earlier = hasActivity(input.earlier) ? input.earlier : null;
  return {
    from: input.from,
    to: input.to,
    earlierFrom: range.from,
    earlierTo: range.to,
    current: input.current,
    earlier,
    rows: RATIOS.map((def) => {
      const current = def.compute(input.current);
      const before = earlier ? def.compute(earlier) : null;
      return {
        id: def.id,
        group: def.group,
        name: def.name,
        meaning: def.meaning,
        format: def.format,
        better: def.better,
        current,
        earlier: before,
        arrow: ratioArrow(current, before, def.better),
      };
    }),
  };
}

/** The words an arrow cell shows. */
export function arrowText(arrow: RatioArrow | null): string {
  if (arrow === null) return "";
  if (arrow.kind === "steady") return "steady";
  return `${arrow.up ? "▲" : "▼"} ${arrow.verdict}`;
}

// --- The workings table -------------------------------------------------------------

export interface WorkingsRow {
  label: string;
  kind: "money" | "days";
  /** Money in minor units, or a day count. */
  current: number;
  earlier: number | null;
}

export function workingsRows(current: RatioWorkings, earlier: RatioWorkings | null): WorkingsRow[] {
  const line = (label: string, key: keyof RatioWorkings, kind: "money" | "days" = "money"): WorkingsRow => ({
    label,
    kind,
    current: current[key],
    earlier: earlier ? earlier[key] : null,
  });
  return [
    line("Cash and bank", "cashMinor"),
    line("Receivables", "receivablesMinor"),
    line("Inventory", "inventoryMinor"),
    line("Current assets", "currentAssetsMinor"),
    line("Total assets", "totalAssetsMinor"),
    line("Current liabilities", "currentLiabilitiesMinor"),
    line("Total liabilities", "totalLiabilitiesMinor"),
    line("Accounts payable", "accountsPayableMinor"),
    line("Equity including profit to date", "equityMinor"),
    line("Income", "incomeMinor"),
    line("Cost of goods sold", "costOfGoodsSoldMinor"),
    line("Running costs", "runningCostsMinor"),
    line("Operating income", "operatingIncomeMinor"),
    line("Net income", "netIncomeMinor"),
    line("Interest", "interestMinor"),
    line("Days in the period", "days", "days"),
  ];
}

// --- Export ---------------------------------------------------------------------------

/**
 * One sheet: the ratios by group, then the figures behind them. Every cell is text
 * formatted as the screen shows it, because one column holds money, percentages and days.
 */
export function financialRatiosSheet(
  report: FinancialRatiosReport,
  ctx: { companyName: string; currencyCode: string; money: (minor: number) => string },
): ReportExportSheet {
  const rows: ReportExportSheet["rows"] = [];
  for (const group of RATIO_GROUPS) {
    for (const row of report.rows.filter((r) => r.group === group.id)) {
      rows.push({
        section: group.label,
        item: row.name,
        current: formatRatio(row.format, row.current, ctx.money),
        earlier: formatRatio(row.format, row.earlier, ctx.money),
        change: arrowText(row.arrow),
      });
    }
  }
  const shown = (kind: "money" | "days", value: number | null) =>
    value === null ? "" : kind === "money" ? ctx.money(value) : String(value);
  for (const w of workingsRows(report.current, report.earlier)) {
    rows.push({
      section: "The figures behind them",
      item: w.label,
      current: shown(w.kind, w.current),
      earlier: shown(w.kind, w.earlier),
      change: "",
    });
  }
  return {
    fileName: sanitizeExportFileName(`financial-ratios-${report.from}-to-${report.to}`),
    companyName: ctx.companyName,
    title: "Financial Ratios",
    subtitle: `${report.from} to ${report.to}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "section", header: "Group", kind: "text", width: 26 },
      { key: "item", header: "Ratio", kind: "text", width: 34 },
      { key: "current", header: "This period", kind: "text", width: 18 },
      { key: "earlier", header: "A year earlier", kind: "text", width: 18 },
      { key: "change", header: "Change", kind: "text", width: 16 },
    ],
    rows,
  };
}
```

- [ ] **Step 7: Create `ctyhp-accounting/lib/services/financial-ratios.ts`** with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildFinancialRatios,
  buildRatioWorkings,
  yearEarlierRange,
  type FinancialRatiosReport,
  type RatioWorkings,
} from "@/lib/domain/financial-ratios";
import { getInventoryAccounts } from "./inventory-accounts";
import { getLedgerBalances } from "./reports";

/** The workings for one period: balances cumulative to the To date, flows over From to To. */
async function workingsFor(
  sb: SupabaseClient,
  from: string,
  to: string,
  inventoryAccountIds: ReadonlySet<string>,
): Promise<RatioWorkings> {
  const [balances, flow] = await Promise.all([getLedgerBalances(sb, null, to), getLedgerBalances(sb, from, to)]);
  return buildRatioWorkings({ balances, flow, inventoryAccountIds, from, to });
}

/**
 * Financial Ratios for From to To and for the same dates a year earlier. Reads
 * the same ledger balances the Balance Sheet and the Profit and Loss read, so
 * the workings agree with both. Read-only.
 */
export async function getFinancialRatios(sb: SupabaseClient, from: string, to: string): Promise<FinancialRatiosReport> {
  const inventory = new Set((await getInventoryAccounts(sb)).accountIds);
  const earlierRange = yearEarlierRange(from, to);
  const [current, earlier] = await Promise.all([
    workingsFor(sb, from, to, inventory),
    workingsFor(sb, earlierRange.from, earlierRange.to, inventory),
  ]);
  return buildFinancialRatios({ from, to, current, earlier });
}
```

- [ ] **Step 8: Create `ctyhp-accounting/app/(app)/reports/financial-ratios/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { FinancialRatiosReport } from "@/lib/domain/financial-ratios";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getFinancialRatios } from "@/lib/services/financial-ratios";

/** Financial Ratios: read-only. Nothing this action can be asked to do changes a figure. */
export async function financialRatiosAction(when: ReportWhen): Promise<ReportRunResult<FinancialRatiosReport>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getFinancialRatios(sb, checked.from as string, checked.to) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 9: Create `ctyhp-accounting/app/(app)/reports/financial-ratios/FinancialRatiosClient.tsx`** with exactly this content:

```tsx
"use client";

import { Fragment, useCallback } from "react";
import { ReportFoot, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import {
  RATIO_GROUPS,
  arrowText,
  financialRatiosSheet,
  formatRatio,
  workingsRows,
  type FinancialRatiosReport,
  type RatioArrow,
} from "@/lib/domain/financial-ratios";
import { formatMoney } from "@/lib/format";
import { rangeText, type PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";

function arrowClass(arrow: RatioArrow | null): string {
  if (arrow?.kind !== "moved") return "";
  if (arrow.verdict === "better") return styles.favorable;
  if (arrow.verdict === "worse") return styles.unfavorable;
  return "";
}

/**
 * Financial Ratios: fifteen ratios in four groups, this period beside the
 * same dates a year earlier, with an arrow for how each moved, then the
 * figures every ratio is worked out from.
 */
export default function FinancialRatiosClient({
  companyName,
  currencyCode,
  decimals,
  presets,
  load,
}: {
  companyName: string;
  currencyCode: string;
  decimals: number;
  presets: PresetContext;
  load: (when: ReportWhen) => Promise<ReportRunResult<FinancialRatiosReport>>;
}) {
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const sheet = useCallback(
    (report: FinancialRatiosReport) => financialRatiosSheet(report, { companyName, currencyCode, money }),
    [companyName, currencyCode, money],
  );

  return (
    <SimpleReport<FinancialRatiosReport>
      companyName={companyName}
      title="Financial Ratios"
      currencyCode={currencyCode}
      period={{ kind: "range", ctx: presets, preset: "year" }}
      load={load}
      sheet={sheet}
      runningText="Working out the ratios…"
      render={(report) => {
        const earlierText = rangeText(report.earlierFrom, report.earlierTo);
        return (
          <>
            <div className={styles.rptScroll}>
              <table className={styles.rpt} aria-label="Ratios">
                <thead>
                  <tr>
                    <th className={styles.l}>Ratio</th>
                    <th>
                      This period
                      <div className={styles.thSub}>{rangeText(report.from, report.to)}</div>
                    </th>
                    <th>
                      A year earlier
                      <div className={styles.thSub}>{earlierText}</div>
                    </th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {RATIO_GROUPS.map((group) => (
                    <Fragment key={group.id}>
                      <tr className={styles.rSection}>
                        <td colSpan={4}>{group.label}</td>
                      </tr>
                      {report.rows
                        .filter((row) => row.group === group.id)
                        .map((row) => (
                          <tr key={row.id}>
                            <td>
                              {row.name}
                              <div className={styles.muted}>{row.meaning}</div>
                            </td>
                            <td className={styles.r}>{formatRatio(row.format, row.current, money)}</td>
                            <td className={styles.r}>{formatRatio(row.format, row.earlier, money)}</td>
                            <td className={`${styles.r} ${arrowClass(row.arrow)}`}>
                              {row.arrow ? (
                                row.arrow.kind === "steady" ? (
                                  <span className={styles.muted}>steady</span>
                                ) : (
                                  arrowText(row.arrow)
                                )
                              ) : null}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.rptScroll} style={{ marginTop: 24 }}>
              <table className={styles.rpt} aria-label="The figures behind them">
                <thead>
                  <tr>
                    <th className={styles.l}>The figures behind them</th>
                    <th>This period</th>
                    <th>A year earlier</th>
                  </tr>
                </thead>
                <tbody>
                  {workingsRows(report.current, report.earlier).map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td className={styles.r}>{row.kind === "money" ? money(row.current) : row.current.toLocaleString("en-US")}</td>
                      <td className={styles.r}>
                        {row.earlier === null ? "—" : row.kind === "money" ? money(row.earlier) : row.earlier.toLocaleString("en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ReportFoot>
              {report.earlier === null ? (
                <>
                  <strong>No year-earlier column.</strong> The same dates a year earlier have no assets and no income on
                  the books, so there is nothing to compare with.{" "}
                </>
              ) : null}
              <strong>How it counts.</strong> Balances are taken at the To date, and income and costs over the period.
              Current and long-term follow the account type, as on the Balance Sheet. Treat it as a first read, not a
              covenant test. A dash means nothing to divide by.
            </ReportFoot>
          </>
        );
      }}
    />
  );
}
```

- [ ] **Step 10: Create `ctyhp-accounting/app/(app)/reports/financial-ratios/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import FinancialRatiosClient from "./FinancialRatiosClient";
import { financialRatiosAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FinancialRatiosPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Financial Ratios"
        description="Liquidity, leverage and margin, worked out from the statements."
      />
      <FinancialRatiosClient
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        presets={ctx.presets}
        load={financialRatiosAction}
      />
    </div>
  );
}
```

- [ ] **Step 11: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/inventory-accounts.test.ts" "tests/unit/financial-ratios.test.ts" "lib/domain/inventory-accounts.ts" "lib/services/inventory-accounts.ts" "lib/domain/financial-ratios.ts" "lib/services/financial-ratios.ts" "app/(app)/reports/financial-ratios/actions.ts" "app/(app)/reports/financial-ratios/FinancialRatiosClient.tsx" "app/(app)/reports/financial-ratios/page.tsx"
npx vitest run tests/unit/inventory-accounts.test.ts tests/unit/financial-ratios.test.ts tests/unit/rsc-antd.test.ts tests/unit/report-frame-contract.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; inventory-accounts + financial-ratios: 29 tests passing; rsc-antd and report-frame-contract pass.

- [ ] **Step 12: Commit**

```bash
git add "ctyhp-accounting/tests/unit/inventory-accounts.test.ts" "ctyhp-accounting/tests/unit/financial-ratios.test.ts" "ctyhp-accounting/lib/domain/inventory-accounts.ts" "ctyhp-accounting/lib/services/inventory-accounts.ts" "ctyhp-accounting/lib/domain/financial-ratios.ts" "ctyhp-accounting/lib/services/financial-ratios.ts" "ctyhp-accounting/app/(app)/reports/financial-ratios/actions.ts" "ctyhp-accounting/app/(app)/reports/financial-ratios/FinancialRatiosClient.tsx" "ctyhp-accounting/app/(app)/reports/financial-ratios/page.tsx"
git commit -m "feat(reports): Financial Ratios, with a shared rule for a company's inventory accounts"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 2: Purchases and Inventory, and total rows through ReportTable

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/purchases-inventory.test.ts`
- Modify: `ctyhp-accounting/components/ui/ReportTable.tsx`
- Modify: `ctyhp-accounting/lib/services/party-reports.ts`
- Create: `ctyhp-accounting/lib/domain/purchases-inventory.ts`
- Create: `ctyhp-accounting/lib/services/purchases-inventory.ts`
- Create: `ctyhp-accounting/app/(app)/reports/purchases-inventory/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/purchases-inventory/PurchasesInventoryClient.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/purchases-inventory/page.tsx`

**Interfaces:**
- Consumes: Task 1's `getInventoryAccounts(sb)` / `pickInventoryAccounts`; existing `lib/domain/fiscal.ts`, `readAllPages`, `SimpleReport`, `reportPagination`.
- Produces: `SummaryRow`, `SummaryCell` exported from `components/ui/ReportTable.tsx` (thin wrappers over antd's `Table.Summary.Row/Cell`, so no screen imports antd's Table) — Task 3 uses them too; `partyOfDocuments`, `partyNames` now exported from `lib/services/party-reports.ts`; `buildPurchasesInventory`, `isOpeningEntry`, `lineKind`, `ADJUSTMENT_ACCOUNT_NAME`, `purchasesInventorySheet` (`lib/domain/purchases-inventory.ts`); `getPurchasesInventory(sb, from, to)`; the page `/reports/purchases-inventory`.

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/purchases-inventory.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import { NO_VENDOR } from "@/lib/domain/party-activity";
import {
  buildPurchasesInventory,
  isOpeningEntry,
  purchasesInventorySheet,
  yearProofText,
  type PurchaseLedgerLine,
  type PurchasesInventoryInput,
} from "@/lib/domain/purchases-inventory";

const ACCOUNTS = [
  { id: "inv", name: "Inventory", accountType: "current_asset" },
  { id: "cogs", name: "Cost of Goods Sold", accountType: "cost_of_goods_sold" },
  { id: "count", name: "Inventory Adjustments", accountType: "cost_of_goods_sold" },
  { id: "wd", name: "Inventory Write-down", accountType: "expense" },
  { id: "spoil", name: "Spoilage", accountType: "expense" },
  { id: "eq", name: "Owner Equity", accountType: "equity" },
  { id: "ap", name: "Accounts Payable", accountType: "accounts_payable" },
];

function line(entryId: string, entryDate: string, accountId: string, signedMinor: number, over: Partial<PurchaseLedgerLine> = {}): PurchaseLedgerLine {
  return { entryId, entryDate, sourceType: "manual", description: "x", sourceId: null, accountId, signedMinor, ...over };
}

function run(lines: PurchaseLedgerLine[], over: Partial<PurchasesInventoryInput> = {}) {
  return buildPurchasesInventory({
    lines,
    accounts: ACCOUNTS,
    inventoryAccountIds: new Set(["inv"]),
    equityEntryIds: new Set(),
    vendorOfSource: new Map(),
    fiscalStartMonth: 1,
    from: "2026-01-01",
    to: "2026-12-31",
    ...over,
  });
}

describe("a periodic book: purchases to cost of sales, a year-end count", () => {
  // Opening 1,000 brought in, 500 bought (a return of 50 later), count puts closing at 1,200.
  const lines = [
    line("o", "2026-01-01", "inv", 100_000, { sourceType: "opening_balance" }),
    line("o", "2026-01-01", "eq", -100_000, { sourceType: "opening_balance" }),
    line("b1", "2026-02-10", "cogs", 50_000, { sourceId: "bill1" }),
    line("b1", "2026-02-10", "ap", -50_000, { sourceId: "bill1" }),
    line("r1", "2026-03-05", "cogs", -5_000, { sourceId: "vc1" }),
    line("r1", "2026-03-05", "ap", 5_000, { sourceId: "vc1" }),
    // Year-end count: closing stock 120,000 against 100,000 opening.
    line("c", "2026-12-31", "inv", 20_000, { sourceType: "inventory_adjustment" }),
    line("c", "2026-12-31", "count", -20_000, { sourceType: "inventory_adjustment" }),
  ];
  const report = run(lines, {
    vendorOfSource: new Map([
      ["bill1", { id: "v1", name: "Example Supply" }],
      ["vc1", { id: "v1", name: "Example Supply" }],
    ]),
  });

  it("gives one year that adds up", () => {
    expect(report.years).toHaveLength(1);
    const y = report.years[0];
    expect(y).toMatchObject({
      label: "2026",
      openingMinor: 100_000,
      boughtMinor: 45_000,
      countAdjustmentMinor: 20_000,
      costOfSalesMinor: 45_000,
      closingMinor: 120_000,
      offByMinor: 0,
    });
    expect(report.offByYears).toEqual([]);
    expect(yearProofText(report, String)).toBe("That holds in every year shown.");
  });

  it("nets the return into what was bought, and counts entries", () => {
    expect(report.boughtMinor).toBe(45_000);
    expect(report.purchases).toBe(2);
    expect(report.suppliers).toBe(1);
    expect(report.onShelfMinor).toBe(120_000);
    expect(report.neverBought).toBe(false);
  });

  it("groups by supplier and by month, with shares", () => {
    expect(report.supplierRows).toEqual([
      { vendorId: "v1", name: "Example Supply", purchases: 2, amountMinor: 45_000, sharePercent: 100 },
    ]);
    expect(report.months.map((m) => [m.label, m.amountMinor])).toEqual([
      ["Feb 2026", 50_000],
      ["Mar 2026", -5_000],
    ]);
  });
});

describe("a perpetual book: a receipt to inventory, then a sale that nets out", () => {
  const lines = [
    line("g", "2026-04-01", "inv", 80_000, { sourceType: "goods_receipt", sourceId: "gr1" }),
    line("g", "2026-04-01", "ap", -80_000, { sourceType: "goods_receipt", sourceId: "gr1" }),
    // The sale's cost: cost of sales against inventory, in one entry.
    line("s", "2026-05-01", "cogs", 30_000, { sourceType: "invoice", sourceId: "inv1" }),
    line("s", "2026-05-01", "inv", -30_000, { sourceType: "invoice", sourceId: "inv1" }),
  ];
  const report = run(lines, { vendorOfSource: new Map([["gr1", { id: "v2", name: "Beta Wholesale" }]]) });

  it("counts only the receipt as a purchase", () => {
    expect(report.purchases).toBe(1);
    expect(report.boughtMinor).toBe(80_000);
    expect(report.supplierRows.map((r) => r.name)).toEqual(["Beta Wholesale"]);
  });

  it("still adds up, the sale reducing stock through cost of sales", () => {
    const y = report.years[0];
    expect(y.boughtMinor).toBe(80_000);
    expect(y.costOfSalesMinor).toBe(30_000);
    expect(y.closingMinor).toBe(50_000);
    expect(y.offByMinor).toBe(0);
  });
});

describe("an opening entry, caught by each of the three rules", () => {
  const cases: [string, Partial<PurchaseLedgerLine>, string[]][] = [
    ["its source", { sourceType: "opening_balance", description: "Start" }, []],
    ["its description", { description: "OPENING BALANCES as of 1 Jan" }, []],
    ["an equity line", { description: "Take on stock" }, ["o"]],
  ];
  for (const [name, over, equity] of cases) {
    it(`by ${name}`, () => {
      const report = run([line("o", "2026-01-01", "inv", 70_000, over), line("o", "2026-01-01", "cogs", 0, over)], {
        equityEntryIds: new Set(equity),
      });
      expect(report.neverBought).toBe(true);
      expect(report.boughtMinor).toBe(0);
      expect(report.years[0]).toMatchObject({ openingMinor: 70_000, boughtMinor: 0, closingMinor: 70_000, offByMinor: 0 });
    });
  }

  it("is not an opening entry when none of them holds", () => {
    expect(isOpeningEntry({ id: "e", sourceType: "bill", description: "Reopening balance" }, new Set())).toBe(false);
  });

  it("carries an earlier year's closing forward as the next opening", () => {
    const report = run(
      [
        line("a", "2025-03-01", "cogs", 10_000),
        line("c", "2025-12-31", "inv", 10_000, { sourceType: "inventory_adjustment" }),
        line("c", "2025-12-31", "count", -10_000, { sourceType: "inventory_adjustment" }),
        line("b", "2026-03-01", "cogs", 5_000),
      ],
      { from: "2025-01-01" },
    );
    expect(report.years.map((y) => [y.label, y.openingMinor, y.closingMinor])).toEqual([
      ["2025", 0, 10_000],
      ["2026", 10_000, 10_000],
    ]);
  });
});

describe("returns as credits", () => {
  it("reduce the total and the supplier's amount, and a net-zero entry is not a purchase", () => {
    const report = run([
      line("b", "2026-02-01", "cogs", 20_000, { sourceId: "bill1" }),
      line("r", "2026-02-15", "cogs", -8_000, { sourceId: "vc1" }),
      // Bought and returned in one entry: nets to zero, so not a purchase.
      line("z", "2026-02-20", "cogs", 5_000),
      line("z", "2026-02-20", "inv", -5_000),
    ]);
    expect(report.boughtMinor).toBe(12_000);
    expect(report.purchases).toBe(2);
  });
});

describe("an off-by year", () => {
  it("is flagged when cost of sales sits in an entry that brought stock in, and names the year", () => {
    const report = run([
      line("o", "2026-01-01", "inv", 100_000, { sourceType: "opening_balance" }),
      line("o", "2026-01-01", "cogs", 4_000, { sourceType: "opening_balance" }),
    ]);
    const y = report.years[0];
    expect(y.offByMinor).toBe(-4_000);
    expect(report.offByYears).toHaveLength(1);
    expect(yearProofText(report, (m) => `$${m / 100}`)).toBe(
      "One year is off by $40 in 2026, usually stock bought or written off through neither account.",
    );
  });

  it("does not trip on a write-down to a non-cost-of-sales account: the write-down is a count entry", () => {
    const report = run([
      line("b", "2026-02-01", "cogs", 50_000),
      line("w", "2026-12-31", "wd", 7_000),
      line("w", "2026-12-31", "inv", -7_000),
    ]);
    const y = report.years[0];
    expect(y.countAdjustmentMinor).toBe(-7_000);
    expect(y.offByMinor).toBe(0);
    expect(report.purchases).toBe(1);
  });

  it("treats an unnamed loss to inventory as a purchase credit, and still adds up", () => {
    const report = run([line("b", "2026-02-01", "cogs", 50_000), line("l", "2026-03-01", "spoil", 7_000), line("l", "2026-03-01", "inv", -7_000)]);
    expect(report.boughtMinor).toBe(43_000);
    expect(report.years[0].offByMinor).toBe(0);
  });

  it("says how many years when several are off", () => {
    const off = (year: number) => [
      line(`o${year}`, `${year}-01-01`, "inv", 1_000, { sourceType: "opening_balance" }),
      line(`o${year}`, `${year}-01-01`, "cogs", 100, { sourceType: "opening_balance" }),
    ];
    const report = run([...off(2025), ...off(2026)], { from: "2025-01-01" });
    expect(yearProofText(report, String)).toMatch(/^2 years are off by /);
  });
});

describe("the supplier fallback", () => {
  const report = run(
    [
      line("a", "2026-02-01", "cogs", 30_000, { sourceId: "bill1" }),
      line("b", "2026-02-02", "cogs", 10_000, { sourceId: "unknown-doc" }),
      line("c", "2026-02-03", "inv", 10_000),
    ],
    { vendorOfSource: new Map([["bill1", { id: "v1", name: "Example Supply" }]]) },
  );

  it("sends entries with no vendor document to (No vendor), largest supplier first", () => {
    expect(report.supplierRows.map((r) => [r.name, r.purchases, r.amountMinor])).toEqual([
      ["Example Supply", 1, 30_000],
      [NO_VENDOR, 2, 20_000],
    ]);
    expect(report.suppliers).toBe(1);
    expect(report.supplierTotal).toEqual({ purchases: 3, amountMinor: 50_000 });
  });

  it("gives shares that add to 100", () => {
    expect(report.supplierRows.reduce((s, r) => s + (r.sharePercent ?? 0), 0)).toBeCloseTo(100);
  });
});

describe("the period and the empty states", () => {
  const lines = [line("a", "2025-06-01", "cogs", 10_000), line("b", "2026-06-01", "cogs", 20_000)];

  it("limits the stat figures, suppliers and months to the range, but the year table to the books", () => {
    const report = run(lines, { from: "2026-01-01", to: "2026-12-31" });
    expect(report.boughtMinor).toBe(20_000);
    expect(report.months).toHaveLength(1);
    expect(report.years.map((y) => y.label)).toEqual(["2025", "2026"]);
  });

  it("is empty for a period with nothing bought, without saying nothing was ever bought", () => {
    const report = run(lines, { from: "2024-01-01", to: "2024-12-31" });
    expect(report.neverBought).toBe(false);
    expect(report.supplierRows).toEqual([]);
    expect(report.months).toEqual([]);
    expect(report.purchases).toBe(0);
  });

  it("says nothing was ever bought when the books have no purchase line", () => {
    const report = run([]);
    expect(report.neverBought).toBe(true);
    expect(report.years).toEqual([]);
    expect(yearProofText(report, String)).toBe("That holds in every year shown.");
  });

  it("follows a July fiscal year", () => {
    const report = run([line("a", "2026-06-30", "cogs", 1_000), line("b", "2026-07-01", "cogs", 2_000)], { fiscalStartMonth: 7 });
    expect(report.years.map((y) => y.label)).toEqual(["Jul 2025 – Jun 2026", "Jul 2026 – Jun 2027"]);
  });
});

describe("the export sheet", () => {
  it("stacks the three tables and ends the supplier table with a Total", () => {
    const report = run([line("a", "2026-02-01", "cogs", 30_000, { sourceId: "bill1" })], {
      vendorOfSource: new Map([["bill1", { id: "v1", name: "Example Supply" }]]),
    });
    const sheet = purchasesInventorySheet(report, { companyName: "Test Co", currencyCode: "USD", money: (m) => `$${(m / 100).toFixed(2)}` });
    expect(sheet.fileName).toBe("purchases-and-inventory-2026-01-01-to-2026-12-31");
    expect(sheet.rows.map((r) => `${r.section}|${r.item}`)).toEqual([
      "Year by year|2026",
      "Who it was bought from|Example Supply",
      "Who it was bought from|Total",
      "Month by month|Feb 2026",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run tests/unit/purchases-inventory.test.ts
```

Expected: FAIL — `lib/domain/purchases-inventory.ts` does not exist yet.

- [ ] **Step 3: Edit `ctyhp-accounting/components/ui/ReportTable.tsx`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```tsx

import type { ReactNode } from "react";
import { Table } from "antd";
```

replace with:

```tsx

import type { ComponentProps, ReactNode } from "react";
import { Table } from "antd";
```

Edit 2 of 2 — find:

```tsx
  );
}
```

replace with:

```tsx
  );
}

/** A row of a report's summary. Callers use this so no screen reaches for antd's Table. */
export function SummaryRow(props: ComponentProps<typeof Table.Summary.Row>) {
  return <Table.Summary.Row {...props} />;
}

/** A cell of a summary row (`index`, `colSpan`, `align`, `className`). Callers use this so no screen reaches for antd's Table. */
export function SummaryCell(props: ComponentProps<typeof Table.Summary.Cell>) {
  return <Table.Summary.Cell {...props} />;
}
```

- [ ] **Step 4: Edit `ctyhp-accounting/lib/services/party-reports.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
/** id → the customer (or vendor) on it, for one document table, every row. */
async function partyOfDocuments(
  sb: SupabaseClient,
```

replace with:

```ts
/** id → the customer (or vendor) on it, for one document table, every row. */
export async function partyOfDocuments(
  sb: SupabaseClient,
```

Edit 2 of 2 — find:

```ts

async function partyNames(sb: SupabaseClient, table: "acc_customer" | "acc_vendor"): Promise<Map<string, string>> {
  const rows = await readAllPages<Record<string, unknown>>(
```

replace with:

```ts

export async function partyNames(sb: SupabaseClient, table: "acc_customer" | "acc_vendor"): Promise<Map<string, string>> {
  const rows = await readAllPages<Record<string, unknown>>(
```

- [ ] **Step 5: Create `ctyhp-accounting/lib/domain/purchases-inventory.ts`** with exactly this content:

```ts
import { dayBefore, fiscalMonths, fiscalYearForDate } from "./fiscal";
import { NO_VENDOR } from "./party-activity";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";

/**
 * Purchases and Inventory: what was bought, from whom, and whether the stock
 * adds up year by year.
 *
 * Pure calculation. The service reads the posted lines on the inventory,
 * cost-of-goods-sold and adjustment accounts (plus which entries have an equity
 * line) and hands them here. Amounts are base-currency minor units, debit
 * positive: a purchase is positive and a return is negative.
 */

/** One posted line on an inventory, cost-of-goods-sold or adjustment account, with its entry's facts. */
export interface PurchaseLedgerLine {
  entryId: string;
  entryDate: string;
  sourceType: string | null;
  description: string | null;
  sourceId: string | null;
  accountId: string;
  /** Base currency, debit positive. */
  signedMinor: number;
}

/** What the rules need to know about an account. */
export interface PurchaseAccount {
  id: string;
  name: string;
  accountType: string;
}

export interface PurchasesInventoryInput {
  lines: readonly PurchaseLedgerLine[];
  /** Every account, so a line's kind can be told. Only the ones with lines in `lines` matter. */
  accounts: readonly PurchaseAccount[];
  /** The company's inventory accounts (see `lib/domain/inventory-accounts`). */
  inventoryAccountIds: ReadonlySet<string>;
  /** Ids of the posted entries that have a line on an `equity` account. */
  equityEntryIds: ReadonlySet<string>;
  /** Source document id (bill, expense, vendor credit, bill payment, goods receipt) → its vendor. */
  vendorOfSource: ReadonlyMap<string, { id: string; name: string }>;
  fiscalStartMonth: number;
  from: string;
  to: string;
}

/** An inventory-adjustment or write-down account, by its name. */
export const ADJUSTMENT_ACCOUNT_NAME = /inventory\s*adjust|write[- ]?down|shrink/i;

const OPENING_DESCRIPTION = /^\s*opening balance/i;

export type LineKind = "inventory" | "cogs" | "adjustment" | "other";

export function lineKind(
  account: PurchaseAccount | undefined,
  inventoryAccountIds: ReadonlySet<string>,
): LineKind {
  if (!account) return "other";
  if (inventoryAccountIds.has(account.id)) return "inventory";
  if (ADJUSTMENT_ACCOUNT_NAME.test(account.name)) return "adjustment";
  return account.accountType === "cost_of_goods_sold" ? "cogs" : "other";
}

/** An entry that brings stock in rather than buying it: any one of three marks. */
export function isOpeningEntry(entry: {
  id: string;
  sourceType: string | null;
  description: string | null;
}, equityEntryIds: ReadonlySet<string>): boolean {
  return (
    entry.sourceType === "opening_balance" ||
    OPENING_DESCRIPTION.test(entry.description ?? "") ||
    equityEntryIds.has(entry.id)
  );
}

interface ClassifiedLine extends PurchaseLedgerLine {
  kind: LineKind;
  opening: boolean;
  count: boolean;
}

export interface PurchaseYearRow {
  /** The calendar year the fiscal year starts in. */
  fiscalYear: number;
  label: string;
  start: string;
  end: string;
  openingMinor: number;
  boughtMinor: number;
  countAdjustmentMinor: number;
  costOfSalesMinor: number;
  closingMinor: number;
  /** Opening + bought + count adjustment − cost of sales − closing; 0 when the year adds up. */
  offByMinor: number;
}

export interface SupplierRow {
  /** Vendor id, or null for the "(No vendor)" row. */
  vendorId: string | null;
  name: string;
  /** Entries, not posting lines. */
  purchases: number;
  amountMinor: number;
  /** Percent of the period's total, or null when that total is zero. */
  sharePercent: number | null;
}

export interface MonthRow {
  /** "2026-03". */
  month: string;
  label: string;
  amountMinor: number;
  sharePercent: number | null;
}

export interface PurchasesInventoryReport {
  from: string;
  to: string;
  /** No purchase entry anywhere in the books. */
  neverBought: boolean;
  years: PurchaseYearRow[];
  /** Years whose columns do not add up. */
  offByYears: PurchaseYearRow[];
  boughtMinor: number;
  /** Entries in the period whose purchase lines do not net to zero. */
  purchases: number;
  /** Vendors with a purchase in the period; "(No vendor)" is not one. */
  suppliers: number;
  onShelfMinor: number;
  supplierRows: SupplierRow[];
  supplierTotal: { purchases: number; amountMinor: number };
  months: MonthRow[];
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${year}`;
}

function percentOf(part: number, total: number): number | null {
  return total === 0 ? null : (part / total) * 100;
}

function yearLabel(year: number, fiscalStartMonth: number): string {
  if (fiscalStartMonth === 1) return String(year);
  const months = fiscalMonths(year, fiscalStartMonth);
  const first = months[0];
  const last = months[11];
  return `${monthLabel(first.start.slice(0, 7))} – ${monthLabel(last.end.slice(0, 7))}`;
}

/** Inventory balance of the given classified lines on or before a date. */
function balanceUpTo(lines: readonly ClassifiedLine[], date: string): number {
  let sum = 0;
  for (const l of lines) if (l.kind === "inventory" && l.entryDate <= date) sum += l.signedMinor;
  return sum;
}

export function buildPurchasesInventory(input: PurchasesInventoryInput): PurchasesInventoryReport {
  const { fiscalStartMonth, from, to } = input;
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));

  // Entry-level marks first: one adjustment line makes the whole entry a count entry.
  const adjustmentEntries = new Set<string>();
  const kinds = new Map<string, LineKind>();
  for (const l of input.lines) {
    let kind = kinds.get(l.accountId);
    if (kind === undefined) {
      kind = lineKind(accountById.get(l.accountId), input.inventoryAccountIds);
      kinds.set(l.accountId, kind);
    }
    if (kind === "adjustment") adjustmentEntries.add(l.entryId);
  }
  const lines: ClassifiedLine[] = input.lines.map((l) => {
    return {
      ...l,
      kind: kinds.get(l.accountId) ?? "other",
      opening: isOpeningEntry({ id: l.entryId, sourceType: l.sourceType, description: l.description }, input.equityEntryIds),
      count: l.sourceType === "inventory_adjustment" || adjustmentEntries.has(l.entryId),
    };
  });

  // A purchase line: inventory, or cost of goods sold (not an adjustment account), in an
  // entry that neither brings stock in nor counts it.
  const isPurchaseLine = (l: ClassifiedLine) =>
    !l.opening && !l.count && (l.kind === "inventory" || l.kind === "cogs");

  // --- Year by year, over all the books ---
  const yearsSeen = new Set<number>();
  for (const l of lines) {
    if (l.kind === "inventory" || l.kind === "cogs") yearsSeen.add(fiscalYearForDate(l.entryDate, fiscalStartMonth));
  }
  const years: PurchaseYearRow[] = [...yearsSeen]
    .sort((a, b) => a - b)
    .map((fiscalYear) => {
      const months = fiscalMonths(fiscalYear, fiscalStartMonth);
      const start = months[0].start;
      const end = months[11].end;
      let broughtIn = 0;
      let bought = 0;
      let countAdjustment = 0;
      let costOfSales = 0;
      for (const l of lines) {
        if (l.entryDate < start || l.entryDate > end) continue;
        if (l.kind === "inventory" && l.opening) broughtIn += l.signedMinor;
        if (isPurchaseLine(l)) bought += l.signedMinor;
        if (l.kind === "inventory" && l.count && !l.opening) countAdjustment += l.signedMinor;
        if (l.kind === "cogs" && !l.count) costOfSales += l.signedMinor;
      }
      const openingMinor = balanceUpTo(lines, dayBefore(start)) + broughtIn;
      const closingMinor = balanceUpTo(lines, end);
      return {
        fiscalYear,
        label: yearLabel(fiscalYear, fiscalStartMonth),
        start,
        end,
        openingMinor,
        boughtMinor: bought,
        countAdjustmentMinor: countAdjustment,
        costOfSalesMinor: costOfSales,
        closingMinor,
        offByMinor: openingMinor + bought + countAdjustment - costOfSales - closingMinor,
      };
    });

  // --- Purchases: one figure per entry, so a perpetual sale (cost of sales against inventory) nets out ---
  interface PurchaseEntry {
    entryDate: string;
    sourceId: string | null;
    netMinor: number;
  }
  const perEntry = new Map<string, PurchaseEntry>();
  for (const l of lines) {
    if (!isPurchaseLine(l)) continue;
    const row = perEntry.get(l.entryId);
    if (row) row.netMinor += l.signedMinor;
    else perEntry.set(l.entryId, { entryDate: l.entryDate, sourceId: l.sourceId, netMinor: l.signedMinor });
  }
  const purchaseEntries = [...perEntry.values()].filter((e) => e.netMinor !== 0);
  const inPeriod = purchaseEntries.filter((e) => e.entryDate >= from && e.entryDate <= to);

  const boughtMinor = inPeriod.reduce((sum, e) => sum + e.netMinor, 0);

  const bySupplier = new Map<string, SupplierRow>();
  for (const e of inPeriod) {
    const vendor = e.sourceId ? input.vendorOfSource.get(e.sourceId) : undefined;
    const key = vendor ? vendor.id : "";
    const row = bySupplier.get(key) ?? {
      vendorId: vendor ? vendor.id : null,
      name: vendor ? vendor.name : NO_VENDOR,
      purchases: 0,
      amountMinor: 0,
      sharePercent: null,
    };
    row.purchases += 1;
    row.amountMinor += e.netMinor;
    bySupplier.set(key, row);
  }
  const supplierRows = [...bySupplier.values()]
    .map((r) => ({ ...r, sharePercent: percentOf(r.amountMinor, boughtMinor) }))
    .sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name));

  const byMonth = new Map<string, number>();
  for (const e of inPeriod) {
    const month = e.entryDate.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + e.netMinor);
  }
  const months: MonthRow[] = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amountMinor]) => ({
      month,
      label: monthLabel(month),
      amountMinor,
      sharePercent: percentOf(amountMinor, boughtMinor),
    }));

  return {
    from,
    to,
    neverBought: purchaseEntries.length === 0,
    years,
    offByYears: years.filter((y) => y.offByMinor !== 0),
    boughtMinor,
    purchases: inPeriod.length,
    suppliers: supplierRows.filter((r) => r.vendorId !== null).length,
    onShelfMinor: balanceUpTo(lines, to),
    supplierRows,
    supplierTotal: { purchases: inPeriod.length, amountMinor: boughtMinor },
    months,
  };
}

/** The footnote under the year-by-year table: either it holds everywhere or it names the years that do not. */
export function yearProofText(
  report: Pick<PurchasesInventoryReport, "offByYears">,
  money: (minor: number) => string,
): string {
  const off = report.offByYears;
  if (off.length === 0) return "That holds in every year shown.";
  const detail = off.map((y) => `${money(Math.abs(y.offByMinor))} in ${y.label}`).join(", ");
  return `${off.length === 1 ? "One year is" : `${off.length} years are`} off by ${detail}, usually stock bought or written off through neither account.`;
}

export const NOTHING_BOUGHT_TITLE = "Nothing has been bought in these books yet.";
export const NOTHING_BOUGHT_HINT = "Anything coded to cost of sales or straight to inventory shows up here.";
export const NOTHING_IN_PERIOD = "Nothing bought in this period.";

/** The report as one flat export: the three tables stacked under a section column. */
export function purchasesInventorySheet(
  report: PurchasesInventoryReport,
  ctx: { companyName: string; currencyCode: string; money: (minor: number) => string },
): ReportExportSheet {
  const percent = (value: number | null) => (value === null ? "" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);
  const blank = { opening: "", bought: "", adjustment: "", costOfSales: "", closing: "", note: "" };
  const rows: ReportExportSheet["rows"] = [];

  for (const y of report.years) {
    rows.push({
      section: "Year by year",
      item: y.label,
      count: "",
      opening: ctx.money(y.openingMinor),
      bought: ctx.money(y.boughtMinor),
      adjustment: ctx.money(y.countAdjustmentMinor),
      costOfSales: ctx.money(y.costOfSalesMinor),
      closing: ctx.money(y.closingMinor),
      note: y.offByMinor === 0 ? "" : `Off by ${ctx.money(Math.abs(y.offByMinor))}`,
    });
  }
  for (const s of report.supplierRows) {
    rows.push({ section: "Who it was bought from", item: s.name, count: String(s.purchases), ...blank, bought: ctx.money(s.amountMinor), note: percent(s.sharePercent) });
  }
  if (report.supplierRows.length > 0) {
    rows.push({
      section: "Who it was bought from",
      item: "Total",
      count: String(report.supplierTotal.purchases),
      ...blank,
      bought: ctx.money(report.supplierTotal.amountMinor),
      note: "",
    });
  }
  for (const m of report.months) {
    rows.push({ section: "Month by month", item: m.label, count: "", ...blank, bought: ctx.money(m.amountMinor), note: percent(m.sharePercent) });
  }

  return {
    fileName: sanitizeExportFileName(`purchases-and-inventory-${report.from}-to-${report.to}`),
    companyName: ctx.companyName,
    title: "Purchases and Inventory",
    subtitle: `${report.from} to ${report.to}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "section", header: "Table", kind: "text", width: 24 },
      { key: "item", header: "Year, supplier or month", kind: "text", width: 32 },
      { key: "count", header: "Purchases", kind: "text", width: 11 },
      { key: "opening", header: "Opening stock", kind: "text", width: 16 },
      { key: "bought", header: "Bought net of returns", kind: "text", width: 20 },
      { key: "adjustment", header: "Count adjustment", kind: "text", width: 16 },
      { key: "costOfSales", header: "Cost of sales", kind: "text", width: 16 },
      { key: "closing", header: "Closing stock", kind: "text", width: 16 },
      { key: "note", header: "Share or note", kind: "text", width: 18 },
    ],
    rows,
  };
}
```

- [ ] **Step 6: Create `ctyhp-accounting/lib/services/purchases-inventory.ts`** with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ADJUSTMENT_ACCOUNT_NAME,
  buildPurchasesInventory,
  type PurchaseAccount,
  type PurchaseLedgerLine,
  type PurchasesInventoryReport,
} from "@/lib/domain/purchases-inventory";
import { getCurrentCompanySettings } from "./company";
import { getInventoryAccounts } from "./inventory-accounts";
import { partyNames, partyOfDocuments } from "./party-reports";
import { readAllPages } from "./paging";

export class PurchasesInventoryError extends Error {}

const fail = (message: string) => new PurchasesInventoryError(message);

type EntryFacts = { entry_date: string; source_type: string | null; description: string | null; source_id: string | null };

/**
 * Every posted line on the given accounts, with its entry's date, source and
 * description. Paged in line-id order: the id is unique, so no line can
 * straddle a page.
 */
async function postedLines(sb: SupabaseClient, accountIds: readonly string[]): Promise<PurchaseLedgerLine[]> {
  if (accountIds.length === 0) return [];
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_journal_line")
        .select(
          "id,account_id,debit_minor,amount_base_minor,journal_entry_id,acc_journal_entry!inner(entry_date,status,source_type,description,source_id)",
        )
        .in("account_id", accountIds as string[])
        .eq("acc_journal_entry.status", "posted")
        .order("id")
        .range(from, to),
    fail,
  );
  return rows.map((r) => {
    const entry = r.acc_journal_entry as EntryFacts;
    const base = Number(r.amount_base_minor);
    return {
      entryId: r.journal_entry_id as string,
      entryDate: entry.entry_date,
      sourceType: entry.source_type ?? null,
      description: entry.description ?? null,
      sourceId: entry.source_id ?? null,
      accountId: r.account_id as string,
      signedMinor: Number(r.debit_minor) > 0 ? base : -base,
    };
  });
}

/** The ids of the posted entries that have a line on one of the equity accounts. */
async function entriesWithEquityLine(sb: SupabaseClient, equityAccountIds: readonly string[]): Promise<Set<string>> {
  if (equityAccountIds.length === 0) return new Set();
  const rows = await readAllPages<{ journal_entry_id: string }>(
    (from, to) =>
      sb
        .from("acc_journal_line")
        .select("id,journal_entry_id,acc_journal_entry!inner(status)")
        .in("account_id", equityAccountIds as string[])
        .eq("acc_journal_entry.status", "posted")
        .order("id")
        .range(from, to),
    fail,
  );
  return new Set(rows.map((r) => r.journal_entry_id));
}

/**
 * Purchases and Inventory for From to To, with the year-by-year table over all
 * the books. Reads the lines on the inventory and cost-of-goods-sold accounts
 * (and accounts named for an adjustment or write-down) once, and which entries
 * have an equity line. A purchase entry's vendor comes from its source document
 * as in Expenses by Vendor, plus goods receipts. Read-only.
 */
export async function getPurchasesInventory(sb: SupabaseClient, from: string, to: string): Promise<PurchasesInventoryReport> {
  const [settings, inventory, accountRows] = await Promise.all([
    getCurrentCompanySettings(sb),
    getInventoryAccounts(sb),
    readAllPages<{ id: string; name: string; account_type: string }>(
      (start, end) => sb.from("acc_account").select("id,name,account_type").order("id").range(start, end),
      fail,
    ),
  ]);
  const accounts: PurchaseAccount[] = accountRows.map((a) => ({ id: a.id, name: a.name, accountType: a.account_type }));
  const inventoryIds = new Set(inventory.accountIds);
  const readIds = accounts
    .filter((a) => inventoryIds.has(a.id) || a.accountType === "cost_of_goods_sold" || ADJUSTMENT_ACCOUNT_NAME.test(a.name))
    .map((a) => a.id);
  const equityIds = accounts.filter((a) => a.accountType === "equity").map((a) => a.id);

  const [lines, equityEntryIds, bills, expenses, vendorCredits, billPayments, receipts, names] = await Promise.all([
    postedLines(sb, readIds),
    entriesWithEquityLine(sb, equityIds),
    partyOfDocuments(sb, "acc_bill", "vendor_id"),
    partyOfDocuments(sb, "acc_expense", "vendor_id"),
    partyOfDocuments(sb, "acc_vendor_credit", "vendor_id"),
    partyOfDocuments(sb, "acc_bill_payment", "vendor_id"),
    partyOfDocuments(sb, "acc_goods_receipt", "vendor_id"),
    partyNames(sb, "acc_vendor"),
  ]);

  // Only the sources of the lines read need a vendor; document ids are uuids, so one map serves every table.
  const vendorOfSource = new Map<string, { id: string; name: string }>();
  for (const l of lines) {
    const source = l.sourceId;
    if (!source || vendorOfSource.has(source)) continue;
    const ref = bills.get(source) ?? expenses.get(source) ?? vendorCredits.get(source) ?? billPayments.get(source) ?? receipts.get(source);
    if (ref?.partyId) vendorOfSource.set(source, { id: ref.partyId, name: names.get(ref.partyId) ?? "A vendor no longer on file" });
  }

  return buildPurchasesInventory({
    lines,
    accounts,
    inventoryAccountIds: inventoryIds,
    equityEntryIds,
    vendorOfSource,
    fiscalStartMonth: settings?.fiscal_year_start_month ?? 1,
    from,
    to,
  });
}
```

- [ ] **Step 7: Create `ctyhp-accounting/app/(app)/reports/purchases-inventory/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { PurchasesInventoryReport } from "@/lib/domain/purchases-inventory";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getPurchasesInventory } from "@/lib/services/purchases-inventory";

/** Purchases and Inventory: read-only. Nothing this action can be asked to do changes a figure. */
export async function purchasesInventoryAction(when: ReportWhen): Promise<ReportRunResult<PurchasesInventoryReport>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getPurchasesInventory(sb, checked.from as string, checked.to) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 8: Create `ctyhp-accounting/app/(app)/reports/purchases-inventory/PurchasesInventoryClient.tsx`** with exactly this content:

```tsx
"use client";

import { useCallback, useState } from "react";
import { Empty, Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import ReportTable, { SummaryCell, SummaryRow } from "@/components/ui/ReportTable";
import { flexColumn } from "@/components/ui/columns";
import { ReportFoot, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport, { reportPagination } from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import {
  NOTHING_BOUGHT_HINT,
  NOTHING_BOUGHT_TITLE,
  NOTHING_IN_PERIOD,
  purchasesInventorySheet,
  yearProofText,
  type MonthRow,
  type PurchaseYearRow,
  type PurchasesInventoryReport,
  type SupplierRow,
} from "@/lib/domain/purchases-inventory";
import type { PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";

const PAGE_SIZE = 50;

const percent = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);

/**
 * Purchases and Inventory: what was bought over the period, from whom and in
 * which months, and — over all the books — whether each year's stock adds up:
 * opening stock plus what was bought plus any count adjustment, less cost of
 * sales, is the closing stock.
 */
export default function PurchasesInventoryClient({
  companyName,
  currencyCode,
  decimals,
  presets,
  load,
}: {
  companyName: string;
  currencyCode: string;
  decimals: number;
  presets: PresetContext;
  load: (when: ReportWhen) => Promise<ReportRunResult<PurchasesInventoryReport>>;
}) {
  const [yearPageSize, setYearPageSize] = useState(PAGE_SIZE);
  const [supplierPageSize, setSupplierPageSize] = useState(PAGE_SIZE);
  const [monthPageSize, setMonthPageSize] = useState(PAGE_SIZE);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const sheet = useCallback(
    (report: PurchasesInventoryReport) => purchasesInventorySheet(report, { companyName, currencyCode, money }),
    [companyName, currencyCode, money],
  );
  const moneyCell = (minor: number) => <span className={minor < 0 ? styles.negative : undefined}>{money(minor)}</span>;

  return (
    <SimpleReport<PurchasesInventoryReport>
      companyName={companyName}
      title="Purchases and Inventory"
      currencyCode={currencyCode}
      period={{ kind: "range", ctx: presets, preset: "year" }}
      load={load}
      sheet={sheet}
      runningText="Adding up the purchases…"
      render={(report, _when, { printing }) => (
        <>
          <StatRow
            items={[
              { label: "Bought in this period", value: money(report.boughtMinor) },
              { label: "Purchases", value: report.purchases.toLocaleString("en-US") },
              { label: "Suppliers", value: report.suppliers.toLocaleString("en-US") },
              { label: "On the shelf at the To date", value: money(report.onShelfMinor) },
            ]}
          />

          {report.neverBought ? (
            <Empty description={<><strong>{NOTHING_BOUGHT_TITLE}</strong><div className={styles.muted}>{NOTHING_BOUGHT_HINT}</div></>} />
          ) : (
            <>
              <h3 className={styles.sectionTitle} style={{ margin: "16px 0 8px" }}>
                Year by year
              </h3>
              <DataTable<PurchaseYearRow>
                rowKey={(row) => String(row.fiscalYear)}
                dataSource={report.years}
                pagination={reportPagination(printing, yearPageSize, setYearPageSize, PAGE_SIZE)}
                emptyTitle="No years to show"
                emptyDescription="Nothing has been posted to cost of sales or inventory."
                columns={[
                  flexColumn<PurchaseYearRow>({ title: "Year", dataIndex: "label" }),
                  { title: "Opening stock", dataIndex: "openingMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  { title: "Bought net of returns", dataIndex: "boughtMinor", width: COLUMN.MONEY_WIDE + 20, align: "right", render: moneyCell },
                  { title: "Count adjustment", dataIndex: "countAdjustmentMinor", width: COLUMN.MONEY_WIDE + 8, align: "right", render: moneyCell },
                  { title: "Cost of sales", dataIndex: "costOfSalesMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  {
                    title: "Closing stock",
                    dataIndex: "closingMinor",
                    width: COLUMN.MONEY_WIDE + 60,
                    align: "right",
                    render: (minor: number, row: PurchaseYearRow) => (
                      <>
                        {row.offByMinor !== 0 ? (
                          <Tag color="red" style={{ marginInlineEnd: 6 }}>
                            off by {money(Math.abs(row.offByMinor))}
                          </Tag>
                        ) : null}
                        {moneyCell(minor)}
                      </>
                    ),
                  },
                ]}
              />
              <div className={styles.foot}>{yearProofText(report, money)}</div>

              <h3 className={styles.sectionTitle} style={{ margin: "24px 0 8px" }}>
                Who it was bought from
              </h3>
              <ReportTable<SupplierRow>
                rowKey={(row) => row.vendorId ?? "none"}
                dataSource={report.supplierRows}
                pagination={reportPagination(printing, supplierPageSize, setSupplierPageSize, PAGE_SIZE)}
                emptyTitle={NOTHING_IN_PERIOD}
                emptyDescription="Widen the dates."
                summary={() =>
                  report.supplierRows.length === 0 ? null : (
                    <SummaryRow>
                      <SummaryCell index={0}>
                        <b>Total</b>
                      </SummaryCell>
                      <SummaryCell index={1} align="right">
                        <b>{report.supplierTotal.purchases.toLocaleString("en-US")}</b>
                      </SummaryCell>
                      <SummaryCell index={2} align="right">
                        <b>{money(report.supplierTotal.amountMinor)}</b>
                      </SummaryCell>
                      <SummaryCell index={3} align="right">
                        <b>{report.supplierTotal.purchases === 0 ? "—" : "100%"}</b>
                      </SummaryCell>
                    </SummaryRow>
                  )
                }
                columns={[
                  flexColumn<SupplierRow>({
                    title: "Supplier",
                    key: "supplier",
                    render: (_: unknown, row: SupplierRow) => (row.vendorId ? row.name : <span className={styles.muted}>{row.name}</span>),
                  }),
                  { title: "Purchases", dataIndex: "purchases", width: COLUMN.QTY + 20, align: "right" },
                  { title: "Amount", dataIndex: "amountMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  {
                    title: "Share",
                    dataIndex: "sharePercent",
                    width: COLUMN.QTY + 12,
                    align: "right",
                    render: (value: number | null) => <span className={styles.muted}>{percent(value)}</span>,
                  },
                ]}
              />

              {report.months.length > 0 ? (
                <>
                  <h3 className={styles.sectionTitle} style={{ margin: "24px 0 8px" }}>
                    Month by month
                  </h3>
                  <DataTable<MonthRow>
                    rowKey={(row) => row.month}
                    dataSource={report.months}
                    pagination={reportPagination(printing, monthPageSize, setMonthPageSize, PAGE_SIZE)}
                    columns={[
                      flexColumn<MonthRow>({ title: "Month", dataIndex: "label" }),
                      { title: "Bought", dataIndex: "amountMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                      {
                        title: "Share",
                        dataIndex: "sharePercent",
                        width: COLUMN.QTY + 12,
                        align: "right",
                        render: (value: number | null) => <span className={styles.muted}>{percent(value)}</span>,
                      },
                    ]}
                  />
                </>
              ) : null}
            </>
          )}

          <ReportFoot>
            <strong>How it counts.</strong> A purchase is a posting to a cost of sales account or an inventory account,
            in an entry that is neither an opening balance nor a stock count or adjustment; returns come off. Purchases
            counts entries, and an entry whose postings net to nothing, such as a sale in a perpetual book, is not one.
            Each year reads opening stock + bought + count adjustment − cost of sales = closing stock. The supplier is
            the one on the bill, expense, vendor credit, bill payment or goods receipt behind the entry; anything else
            is on the line {"“(No vendor)”"}. The year table covers every fiscal year in the books; the other figures
            cover the dates chosen.
          </ReportFoot>
        </>
      )}
    />
  );
}
```

- [ ] **Step 9: Create `ctyhp-accounting/app/(app)/reports/purchases-inventory/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import PurchasesInventoryClient from "./PurchasesInventoryClient";
import { purchasesInventoryAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PurchasesInventoryPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Purchases and Inventory"
        description="What was bought over the period and what is still in stock."
      />
      <PurchasesInventoryClient
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        presets={ctx.presets}
        load={purchasesInventoryAction}
      />
    </div>
  );
}
```

- [ ] **Step 10: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/purchases-inventory.test.ts" "components/ui/ReportTable.tsx" "lib/services/party-reports.ts" "lib/domain/purchases-inventory.ts" "lib/services/purchases-inventory.ts" "app/(app)/reports/purchases-inventory/actions.ts" "app/(app)/reports/purchases-inventory/PurchasesInventoryClient.tsx" "app/(app)/reports/purchases-inventory/page.tsx"
npx vitest run tests/unit/purchases-inventory.test.ts tests/unit/table-adoption.test.ts tests/unit/rsc-antd.test.ts tests/unit/report-frame-contract.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; purchases-inventory: 22 tests passing; table-adoption, rsc-antd and report-frame-contract pass.

- [ ] **Step 11: Commit**

```bash
git add "ctyhp-accounting/tests/unit/purchases-inventory.test.ts" "ctyhp-accounting/components/ui/ReportTable.tsx" "ctyhp-accounting/lib/services/party-reports.ts" "ctyhp-accounting/lib/domain/purchases-inventory.ts" "ctyhp-accounting/lib/services/purchases-inventory.ts" "ctyhp-accounting/app/(app)/reports/purchases-inventory/actions.ts" "ctyhp-accounting/app/(app)/reports/purchases-inventory/PurchasesInventoryClient.tsx" "ctyhp-accounting/app/(app)/reports/purchases-inventory/page.tsx"
git commit -m "feat(reports): Purchases and Inventory, with total rows through ReportTable"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 3: Sales Tax Liability, and the shared Record tax payment dialog

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/sales-tax-liability.test.ts`
- Modify: `ctyhp-accounting/components/reports/SimpleReport.tsx`
- Create: `ctyhp-accounting/components/sales-tax/RecordTaxPaymentModal.tsx`
- Modify: `ctyhp-accounting/app/(app)/sales-tax/SalesTaxClient.tsx`
- Create: `ctyhp-accounting/lib/domain/sales-tax-liability.ts`
- Create: `ctyhp-accounting/lib/services/sales-tax-liability.ts`
- Create: `ctyhp-accounting/app/(app)/reports/sales-tax-liability/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/sales-tax-liability/SalesTaxLiabilityClient.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/sales-tax-liability/page.tsx`

**Interfaces:**
- Consumes: Task 2's `SummaryRow`, `SummaryCell` and `ReportTable`; existing `recordTaxPaymentAction` (`app/(app)/sales-tax/actions.ts`), `getLedgerBalances`, `buildProfitAndLoss`, `readAllPages`.
- Produces: `SimpleReport`'s optional `refreshKey?: number` (re-runs the report over the dates last run when it changes); `RecordTaxPaymentModal` (default export) with `TaxPaymentAccountOption`, `TaxPaymentPrefill`, used by both the Sales Tax Center (no prefill, behaviour unchanged) and the new report; `readsAsSalesTax(name)`, `resolveTaxAccounts`, `classifyEntries`, `buildPeriods`, `buildSalesTaxLiability`, `fiscalYearLabel`, `LIABILITY_REPORT_LINK_LABEL` ("Sales Tax Liability by period") (`lib/domain/sales-tax-liability.ts`); `getSalesTaxLiabilityData(sb, from, to)`; the page `/reports/sales-tax-liability`, linked from the Sales Tax Center's Liability tab.

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/sales-tax-liability.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import {
  buildPeriods,
  buildSalesTaxLiability,
  classifyEntries,
  fiscalYearLabel,
  readsAsSalesTax,
  resolveTaxAccounts,
  salesTaxLiabilitySheet,
  unlinkedWarning,
  type SalesTaxLiabilityData,
  type TaxLedgerLine,
} from "@/lib/domain/sales-tax-liability";

const tax = (entryId: string, entryDate: string, creditMinor: number): TaxLedgerLine => ({ entryId, entryDate, kind: "tax", creditMinor });
const income = (entryId: string, entryDate: string, creditMinor: number): TaxLedgerLine => ({ entryId, entryDate, kind: "income", creditMinor });

describe("classifying entries", () => {
  it("counts a taxed sale as taxable and collected", () => {
    const [day] = classifyEntries([income("a", "2026-01-05", 100_00), tax("a", "2026-01-05", 8_00)]);
    expect(day).toMatchObject({ taxableMinor: 100_00, collectedMinor: 8_00, exemptMinor: 0, paidMinor: 0, adjustmentMinor: 0 });
  });

  it("counts a sale with no tax line as exempt", () => {
    const [day] = classifyEntries([income("a", "2026-01-05", 50_00)]);
    expect(day).toMatchObject({ taxableMinor: 0, exemptMinor: 50_00, collectedMinor: 0 });
  });

  it("takes a credit memo off taxable and collected, both being debits", () => {
    const days = classifyEntries([
      income("a", "2026-01-05", 100_00),
      tax("a", "2026-01-05", 8_00),
      income("m", "2026-01-06", -25_00),
      tax("m", "2026-01-06", -2_00),
    ]);
    const taxable = days.reduce((s, d) => s + d.taxableMinor, 0);
    const collected = days.reduce((s, d) => s + d.collectedMinor, 0);
    expect(taxable).toBe(75_00);
    expect(collected).toBe(6_00);
  });

  it("counts a debit to the tax account with no income as paid over", () => {
    const [day] = classifyEntries([tax("p", "2026-02-10", -30_00)]);
    expect(day).toMatchObject({ paidMinor: 30_00, adjustmentMinor: 0 });
  });

  it("counts a credit to the tax account with no income as an adjustment", () => {
    const [day] = classifyEntries([tax("j", "2026-02-10", 4_00)]);
    expect(day).toMatchObject({ paidMinor: 0, adjustmentMinor: 4_00, collectedMinor: 0 });
  });

  it("adds entries up by day, in date order", () => {
    const days = classifyEntries([income("b", "2026-03-02", 10_00), income("a", "2026-03-01", 20_00), income("c", "2026-03-02", 5_00)]);
    expect(days.map((d) => [d.date, d.exemptMinor])).toEqual([
      ["2026-03-01", 20_00],
      ["2026-03-02", 15_00],
    ]);
  });
});

describe("periods", () => {
  it("builds calendar months, clipping the first and last", () => {
    const p = buildPeriods("2026-01-15", "2026-03-10", "monthly", 1);
    expect(p.map((x) => [x.label, x.start, x.end])).toEqual([
      ["Jan 2026", "2026-01-15", "2026-01-31"],
      ["Feb 2026", "2026-02-01", "2026-02-28"],
      ["Mar 2026", "2026-03-01", "2026-03-10"],
    ]);
  });

  it("builds calendar quarters, clipping the first and last", () => {
    const p = buildPeriods("2025-11-20", "2026-05-05", "quarterly", 7);
    expect(p.map((x) => [x.label, x.start, x.end])).toEqual([
      ["Q4 2025", "2025-11-20", "2025-12-31"],
      ["Q1 2026", "2026-01-01", "2026-03-31"],
      ["Q2 2026", "2026-04-01", "2026-05-05"],
    ]);
  });

  it("builds fiscal years labelled by the year they start in, FY when the year does not start in January", () => {
    const p = buildPeriods("2025-09-01", "2026-08-31", "yearly", 7);
    expect(p.map((x) => [x.label, x.start, x.end])).toEqual([
      ["FY2025", "2025-09-01", "2026-06-30"],
      ["FY2026", "2026-07-01", "2026-08-31"],
    ]);
    expect(fiscalYearLabel(2026, 7)).toBe("FY2026");
    expect(fiscalYearLabel(2026, 1)).toBe("2026");
    const calendar = buildPeriods("2025-03-01", "2026-02-01", "yearly", 1);
    expect(calendar.map((x) => [x.label, x.start, x.end])).toEqual([
      ["2025", "2025-03-01", "2025-12-31"],
      ["2026", "2026-01-01", "2026-02-01"],
    ]);
  });

  it("gives one period for a one-day range", () => {
    expect(buildPeriods("2026-02-28", "2026-02-28", "quarterly", 1)).toHaveLength(1);
  });
});

describe("the report", () => {
  const data = (over: Partial<SalesTaxLiabilityData> = {}): SalesTaxLiabilityData => ({
    from: "2026-01-01",
    to: "2026-06-30",
    fiscalStartMonth: 1,
    basis: "codes",
    openingMinor: 0,
    ledgerClosingMinor: 0,
    unlinked: [],
    days: [],
    ...over,
  });

  it("runs the owed figure on from the opening balance", () => {
    const days = classifyEntries([
      income("a", "2026-01-10", 1000_00),
      tax("a", "2026-01-10", 80_00),
      income("b", "2026-02-10", 500_00),
      income("c", "2026-04-02", 200_00),
      tax("c", "2026-04-02", 16_00),
      tax("p", "2026-04-20", -90_00),
      tax("j", "2026-05-01", 3_00),
    ]);
    const report = buildSalesTaxLiability(data({ days, openingMinor: 20_00, ledgerClosingMinor: 29_00 }), "quarterly");
    expect(report.periods.map((p) => p.label)).toEqual(["Q1 2026", "Q2 2026"]);
    const [q1, q2] = report.periods;
    expect(q1).toMatchObject({ grossMinor: 1500_00, taxableMinor: 1000_00, exemptMinor: 500_00, collectedMinor: 80_00, paidMinor: 0, owedMinor: 100_00 });
    expect(q1.ratePercent).toBeCloseTo(8);
    expect(q2).toMatchObject({ grossMinor: 200_00, collectedMinor: 16_00, paidMinor: 90_00, adjustmentMinor: 3_00, owedMinor: 29_00 });
    expect(report.total).toMatchObject({ grossMinor: 1700_00, taxableMinor: 1200_00, exemptMinor: 500_00, collectedMinor: 96_00, paidMinor: 90_00, owedMinor: 29_00 });
    expect(report.collectedMinor).toBe(96_00);
    expect(report.paidMinor).toBe(90_00);
    expect(report.owedAtEndMinor).toBe(29_00);
    expect(report.effectiveRatePercent).toBeCloseTo(8);
    expect(report.openingMinor).toBe(20_00);
    expect(report.proof.agrees).toBe(true);
  });

  it("reports the same totals whatever the period size", () => {
    const days = classifyEntries([income("a", "2026-01-10", 100_00), tax("a", "2026-01-10", 7_00), tax("p", "2026-05-20", -4_00)]);
    for (const g of ["monthly", "quarterly", "yearly"] as const) {
      const report = buildSalesTaxLiability(data({ days }), g);
      expect(report.total.collectedMinor, g).toBe(7_00);
      expect(report.owedAtEndMinor, g).toBe(3_00);
    }
    expect(buildSalesTaxLiability(data({ days }), "monthly").periods).toHaveLength(6);
  });

  it("states the difference when the closing figure is not the ledger balance", () => {
    const days = classifyEntries([income("a", "2026-01-10", 100_00), tax("a", "2026-01-10", 7_00)]);
    const report = buildSalesTaxLiability(data({ days, ledgerClosingMinor: 9_00 }), "yearly");
    expect(report.proof).toEqual({ expectedMinor: 9_00, differenceMinor: -2_00, agrees: false });
  });

  it("has no rate where nothing was taxable, and ignores days outside the range", () => {
    const days = classifyEntries([income("a", "2026-01-10", 100_00), income("z", "2025-12-31", 900_00)]);
    const report = buildSalesTaxLiability(data({ days }), "quarterly");
    expect(report.periods[0].ratePercent).toBeNull();
    expect(report.effectiveRatePercent).toBeNull();
    expect(report.total.exemptMinor).toBe(100_00);
  });

  it("exports the opening row only when it is not zero, then a total", () => {
    const money = (m: number) => (m / 100).toFixed(2);
    const base = buildSalesTaxLiability(data(), "yearly");
    const plain = salesTaxLiabilitySheet(base, { companyName: "Acme", currencyCode: "USD", money });
    expect(plain.rows.map((r) => r.period)).toEqual(["2026", "Total"]);
    const opened = salesTaxLiabilitySheet(buildSalesTaxLiability(data({ openingMinor: 5_00, ledgerClosingMinor: 5_00 }), "yearly"), {
      companyName: "Acme",
      currencyCode: "USD",
      money,
    });
    expect(opened.rows[0]).toMatchObject({ period: "Owed before this range", owed: "5.00" });
    expect(opened.rows.at(-1)).toMatchObject({ period: "Total", rate: "" });
  });
});

describe("finding the tax accounts", () => {
  const accounts = [
    { id: "pay", name: "Sales Tax Payable", accountType: "current_liability" },
    { id: "other", name: "State tax payable (old)", accountType: "current_liability" },
    { id: "ap", name: "Accounts Payable", accountType: "accounts_payable" },
    { id: "bank", name: "Sales tax payable account", accountType: "bank" },
    { id: "payroll", name: "Payroll Liabilities", accountType: "current_liability" },
  ];

  it("reads names letters only", () => {
    expect(readsAsSalesTax("2200 - Sales-Tax Payable")).toBe(true);
    expect(readsAsSalesTax("Tax (State) Payable")).toBe(true);
    expect(readsAsSalesTax("Payroll Liabilities")).toBe(false);
    expect(readsAsSalesTax("Payable tax")).toBe(false);
    expect(readsAsSalesTax("Income Tax Payable")).toBe(false);
    expect(readsAsSalesTax("Payroll Tax Payable")).toBe(false);
    expect(readsAsSalesTax("Taxes Payable")).toBe(true);
    expect(readsAsSalesTax("Sales Tax Payable")).toBe(true);
    expect(readsAsSalesTax("State sales tax")).toBe(true);
  });

  it("uses the accounts sales codes post to, and ignores other directions", () => {
    const found = resolveTaxAccounts(accounts, [
      { direction: "sales", taxAccountId: "pay" },
      { direction: "purchase", taxAccountId: "ap" },
      { direction: "sales", taxAccountId: null },
    ]);
    expect(found.basis).toBe("codes");
    expect(found.accountIds).toEqual(["pay"]);
  });

  it("warns of a liability account that reads as sales tax but no rate posts to", () => {
    const found = resolveTaxAccounts(accounts, [{ direction: "sales", taxAccountId: "pay" }]);
    expect(found.unlinked).toEqual([{ id: "other", name: "State tax payable (old)" }]);
    expect(unlinkedWarning(found.unlinked)).toBe(
      "“State tax payable (old)” reads as sales tax, but no tax rate posts to it, so it is not in these figures.",
    );
    expect(unlinkedWarning([])).toBeNull();
    const linked = resolveTaxAccounts(accounts, [
      { direction: "sales", taxAccountId: "pay" },
      { direction: "sales", taxAccountId: "other" },
    ]);
    expect(linked.unlinked).toEqual([]);
    expect(linked.accountIds.sort()).toEqual(["other", "pay"]);
  });

  it("falls back to liability accounts named for sales tax when no sales code has an account", () => {
    const found = resolveTaxAccounts(accounts, [{ direction: "purchase", taxAccountId: "ap" }]);
    expect(found.basis).toBe("names");
    expect(found.accountIds.sort()).toEqual(["other", "pay"]);
    expect(found.unlinked).toEqual([]);
  });

  it("has no tax account when nothing qualifies", () => {
    const found = resolveTaxAccounts([{ id: "x", name: "Loans", accountType: "long_term_liability" }], []);
    expect(found).toEqual({ accountIds: [], basis: "none", unlinked: [] });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run tests/unit/sales-tax-liability.test.ts
```

Expected: FAIL — `lib/domain/sales-tax-liability.ts` does not exist yet.

- [ ] **Step 3: Edit `ctyhp-accounting/components/reports/SimpleReport.tsx`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```tsx
  runningText?: string;
}
```

replace with:

```tsx
  runningText?: string;
  /** Changing this runs the report again over the dates it last ran, for a page whose own action changed its figures. */
  refreshKey?: number;
}
```

Edit 2 of 2 — find:

```tsx
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => (data === null ? null : view ? view(data) : data), [data, view]);
```

replace with:

```tsx
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshKey = props.refreshKey;
  const lastRefresh = useRef(refreshKey);
  useEffect(() => {
    if (lastRefresh.current === refreshKey) return;
    lastRefresh.current = refreshKey;
    void run(ran);
    // Only a new key runs it again, over the dates last run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const shown = useMemo(() => (data === null ? null : view ? view(data) : data), [data, view]);
```

- [ ] **Step 4: Create `ctyhp-accounting/components/sales-tax/RecordTaxPaymentModal.tsx`** with exactly this content:

```tsx
"use client";
import { useState } from "react";
import { App, DatePicker, Form, Input, InputNumber, Modal, Select } from "antd";
import dayjs from "dayjs";
import { recordTaxPaymentAction } from "@/app/(app)/sales-tax/actions";
import { toMinorUnits } from "@/lib/format";

export interface TaxPaymentAccountOption {
  id: string;
  account_code: string;
  name: string;
}

/** What the dialog opens with: the Sales Tax Center opens it empty, a report may hand it an amount and a range. */
export interface TaxPaymentPrefill {
  amountMinor: number;
  from: string;
  to: string;
}

/**
 * The Record tax payment dialog, shared by the Sales Tax Center and the Sales
 * Tax Liability report. Posts through `recordTaxPaymentAction`
 * (`acc_record_tax_payment`); `onRecorded` runs after a payment is saved, so
 * the screen behind it can read its figures again.
 */
export default function RecordTaxPaymentModal({
  open,
  onClose,
  onRecorded,
  taxPayableAccounts,
  bankAccounts,
  baseCurrency,
  decimals,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  onRecorded: () => void;
  taxPayableAccounts: readonly TaxPaymentAccountOption[];
  bankAccounts: readonly TaxPaymentAccountOption[];
  baseCurrency: string;
  decimals: number;
  prefill?: TaxPaymentPrefill;
}) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  async function submit() {
    const v = await form.validateFields();
    setSaving(true);
    const res = await recordTaxPaymentAction({
      tax_account_id: v.tax_account_id,
      bank_account_id: v.bank_account_id,
      currency_code: baseCurrency,
      amount_minor: toMinorUnits(Number(v.amount ?? 0), decimals),
      payment_date: v.payment_date ? v.payment_date.format("YYYY-MM-DD") : undefined,
      period_start: v.period ? v.period[0].format("YYYY-MM-DD") : null,
      period_end: v.period ? v.period[1].format("YYYY-MM-DD") : null,
      memo: v.memo ?? null,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Tax payment recorded");
      onClose();
      form.resetFields();
      onRecorded();
    } else {
      message.error(res.error ?? "Failed to record payment");
    }
  }

  // Applied when the form mounts, which is each time the dialog opens: the
  // prefill is what the screen showed at that moment.
  const initialValues = prefill
    ? {
        amount: prefill.amountMinor / 10 ** decimals,
        period: [dayjs(prefill.from), dayjs(prefill.to)],
        tax_account_id: taxPayableAccounts.length === 1 ? taxPayableAccounts[0].id : undefined,
      }
    : undefined;

  return (
    <Modal
      title="Record tax payment"
      open={open}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Record"
      destroyOnHidden={prefill !== undefined}
    >
      <Form form={form} layout="vertical" initialValues={initialValues}>
        <Form.Item name="tax_account_id" label="Sales Tax Payable account" rules={[{ required: true, message: "Select the tax account" }]}>
          <Select showSearch optionFilterProp="label" options={taxPayableAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
        </Form.Item>
        <Form.Item name="bank_account_id" label="Pay from" rules={[{ required: true, message: "Select a bank account" }]}>
          <Select showSearch optionFilterProp="label" options={bankAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
        </Form.Item>
        <Form.Item name="amount" label="Amount" rules={[{ required: true, message: "Enter an amount" }]}>
          <InputNumber min={0} precision={decimals} prefix="$" style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="payment_date" label="Payment date"><DatePicker /></Form.Item>
        <Form.Item name="period" label="Period covered"><DatePicker.RangePicker /></Form.Item>
        <Form.Item name="memo" label="Memo"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 5: Edit `ctyhp-accounting/app/(app)/sales-tax/SalesTaxClient.tsx`** — apply these 7 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 7 — find:

```tsx
import { useState } from "react";
import {
```

replace with:

```tsx
import { useState } from "react";
import Link from "next/link";
import {
```

Edit 2 of 7 — find:

```tsx
} from "@/lib/domain/tax-jurisdiction";
import { formatMoney, toMinorUnits } from "@/lib/format";
import {
```

replace with:

```tsx
} from "@/lib/domain/tax-jurisdiction";
import { formatMoney } from "@/lib/format";
import {
```

Edit 3 of 7 — find:

```tsx
import {
  liabilityAction, recordTaxPaymentAction, voidTaxPaymentAction,
  createTaxCodeAction, updateTaxCodeAction, setTaxCodeActiveAction,
```

replace with:

```tsx
import {
  liabilityAction, voidTaxPaymentAction,
  createTaxCodeAction, updateTaxCodeAction, setTaxCodeActiveAction,
```

Edit 4 of 7 — find:

```tsx
} from "./actions";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
```

replace with:

```tsx
} from "./actions";
import RecordTaxPaymentModal from "@/components/sales-tax/RecordTaxPaymentModal";
import { LIABILITY_REPORT_LINK_LABEL } from "@/lib/domain/sales-tax-liability";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
```

Edit 5 of 7 — find:

```tsx
  const [payOpen, setPayOpen] = useState(false);
  const [paySaving, setPaySaving] = useState(false);
  const [payForm] = Form.useForm();

  async function submitPayment() {
    const v = await payForm.validateFields();
    setPaySaving(true);
    const res = await recordTaxPaymentAction({
      tax_account_id: v.tax_account_id,
      bank_account_id: v.bank_account_id,
      currency_code: baseCurrency,
      amount_minor: toMinorUnits(Number(v.amount ?? 0), decimalsOf(baseCurrency)),
      payment_date: v.payment_date ? v.payment_date.format("YYYY-MM-DD") : undefined,
      period_start: v.period ? v.period[0].format("YYYY-MM-DD") : null,
      period_end: v.period ? v.period[1].format("YYYY-MM-DD") : null,
      memo: v.memo ?? null,
    });
    setPaySaving(false);
    if (res.ok) {
      message.success("Tax payment recorded");
      setPayOpen(false);
      payForm.resetFields();
      reloadLiability(range);
    } else {
      message.error(res.error ?? "Failed to record payment");
    }
  }

```

replace with:

```tsx
  const [payOpen, setPayOpen] = useState(false);

```

Edit 6 of 7 — find:

```tsx
                )}
              </Space>
```

replace with:

```tsx
                )}
                <Link href="/reports/sales-tax-liability">{LIABILITY_REPORT_LINK_LABEL}</Link>
              </Space>
```

Edit 7 of 7 — find:

```tsx
        <>
          {/* Record payment modal */}
          <Modal title="Record tax payment" open={payOpen} onOk={submitPayment} onCancel={() => setPayOpen(false)} confirmLoading={paySaving} okText="Record">
            <Form form={payForm} layout="vertical">
              <Form.Item name="tax_account_id" label="Sales Tax Payable account" rules={[{ required: true, message: "Select the tax account" }]}>
                <Select showSearch optionFilterProp="label" options={props.taxPayableAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
              </Form.Item>
              <Form.Item name="bank_account_id" label="Pay from" rules={[{ required: true, message: "Select a bank account" }]}>
                <Select showSearch optionFilterProp="label" options={props.bankAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
              </Form.Item>
              <Form.Item name="amount" label="Amount" rules={[{ required: true, message: "Enter an amount" }]}>
                <InputNumber min={0} precision={decimalsOf(baseCurrency)} prefix="$" style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="payment_date" label="Payment date"><DatePicker /></Form.Item>
              <Form.Item name="period" label="Period covered"><DatePicker.RangePicker /></Form.Item>
              <Form.Item name="memo" label="Memo"><Input.TextArea rows={2} /></Form.Item>
            </Form>
          </Modal>

```

replace with:

```tsx
        <>
          <RecordTaxPaymentModal
            open={payOpen}
            onClose={() => setPayOpen(false)}
            onRecorded={() => reloadLiability(range)}
            taxPayableAccounts={props.taxPayableAccounts}
            bankAccounts={props.bankAccounts}
            baseCurrency={baseCurrency}
            decimals={decimalsOf(baseCurrency)}
          />

```

- [ ] **Step 6: Create `ctyhp-accounting/lib/domain/sales-tax-liability.ts`** with exactly this content:

```ts
import { dayBefore, fiscalYearForDate } from "./fiscal";
import { monthLabel } from "./purchases-inventory";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { shortDate } from "./report-presets";
import { tieOut, type TieOut } from "./tie-out";

/**
 * Sales Tax Liability: what was charged and what was paid over, period by
 * period, read from the ledger rather than from invoices.
 *
 * Pure calculation. The service reads the posted lines on the tax accounts and
 * on income accounts and hands them here. Amounts are base-currency minor
 * units. Lines are signed credit-positive, as the spec words it: a sale puts
 * income and tax on the credit side, a credit memo puts both on the debit side.
 */

export type Granularity = "monthly" | "quarterly" | "yearly";

export const GRANULARITIES: readonly { value: Granularity; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export const DEFAULT_GRANULARITY: Granularity = "quarterly";

// --- Which accounts are the tax accounts -----------------------------------

export interface TaxAccountCandidate {
  id: string;
  name: string;
  accountType: string;
}

export interface TaxCodeLink {
  direction: string;
  taxAccountId: string | null;
}

const LIABILITY_TYPES: ReadonlySet<string> = new Set(["current_liability", "long_term_liability"]);

/** Taxes that are not sales tax: a name carrying one of these words never reads as sales tax. */
const OTHER_TAX = /payroll|income|withholding|employ|federal|property|corporate|franchise|excise|vat/;

/** Whether a name, letters only, reads as sales tax: "salestax" or "tax…payable", and not another kind of tax. */
export function readsAsSalesTax(name: string): boolean {
  const letters = name.toLowerCase().replace(/[^a-z]/g, "");
  return (/salestax/.test(letters) || /tax.*payable/.test(letters)) && !OTHER_TAX.test(letters);
}

export type TaxAccountBasis = "codes" | "names" | "none";

export interface TaxAccounts {
  accountIds: string[];
  basis: TaxAccountBasis;
  /** Liability accounts that read as sales tax but no tax rate posts to; they are not in the figures. */
  unlinked: { id: string; name: string }[];
}

/**
 * The accounts the report reads. The ones sales-direction tax codes post to;
 * if the company has none, the liability accounts whose names read as sales
 * tax. With codes in use, any other liability account that reads as sales tax
 * is named in `unlinked`, because it holds what looks like sales tax the
 * report is not counting.
 */
export function resolveTaxAccounts(accounts: readonly TaxAccountCandidate[], codes: readonly TaxCodeLink[]): TaxAccounts {
  const known = new Set(accounts.map((a) => a.id));
  const sales = new Set(
    codes.filter((c) => c.direction === "sales" && c.taxAccountId && known.has(c.taxAccountId)).map((c) => c.taxAccountId as string),
  );
  const looksLikeIt = accounts.filter((a) => LIABILITY_TYPES.has(a.accountType) && readsAsSalesTax(a.name));
  if (sales.size === 0) {
    return { accountIds: looksLikeIt.map((a) => a.id), basis: looksLikeIt.length > 0 ? "names" : "none", unlinked: [] };
  }
  const linked = new Set(codes.map((c) => c.taxAccountId).filter((id): id is string => !!id));
  return {
    accountIds: [...sales],
    basis: "codes",
    unlinked: looksLikeIt.filter((a) => !linked.has(a.id)).map((a) => ({ id: a.id, name: a.name })),
  };
}

// --- Classifying the entries -------------------------------------------------

/** One posted line on a tax account or an income account. Credit-positive, base currency. */
export interface TaxLedgerLine {
  entryId: string;
  entryDate: string;
  kind: "tax" | "income";
  creditMinor: number;
}

/** What one day's entries added up to, by how each was classified. */
export interface TaxDay {
  date: string;
  taxableMinor: number;
  exemptMinor: number;
  collectedMinor: number;
  paidMinor: number;
  adjustmentMinor: number;
}

/**
 * Classify every entry and add the entries up by day.
 *
 * - Income and tax lines: the income is taxable, the tax is collected.
 * - Income and no tax line: the income is exempt.
 * - No income line: a net debit to the tax accounts is paid over, a net credit
 *   is an adjustment (it adds to what is owed).
 *
 * A credit memo has both on the debit side, so its amounts come out negative
 * and it takes away from taxable and collected.
 */
export function classifyEntries(lines: readonly TaxLedgerLine[]): TaxDay[] {
  const entries = new Map<string, { date: string; income: number; tax: number; hasIncome: boolean; hasTax: boolean }>();
  for (const l of lines) {
    const e = entries.get(l.entryId) ?? { date: l.entryDate, income: 0, tax: 0, hasIncome: false, hasTax: false };
    if (l.kind === "income") {
      e.income += l.creditMinor;
      e.hasIncome = true;
    } else {
      e.tax += l.creditMinor;
      e.hasTax = true;
    }
    entries.set(l.entryId, e);
  }
  const days = new Map<string, TaxDay>();
  for (const e of entries.values()) {
    const day = days.get(e.date) ?? { date: e.date, taxableMinor: 0, exemptMinor: 0, collectedMinor: 0, paidMinor: 0, adjustmentMinor: 0 };
    if (e.hasIncome && e.hasTax) {
      day.taxableMinor += e.income;
      day.collectedMinor += e.tax;
    } else if (e.hasIncome) {
      day.exemptMinor += e.income;
    } else if (e.tax < 0) {
      day.paidMinor += -e.tax;
    } else if (e.tax > 0) {
      day.adjustmentMinor += e.tax;
    }
    days.set(e.date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// --- Periods -----------------------------------------------------------------

export interface TaxPeriod {
  key: string;
  label: string;
  start: string;
  end: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const firstOf = (year: number, month: number) => iso(new Date(Date.UTC(year, month - 1, 1)));
const lastOf = (year: number, month: number) => iso(new Date(Date.UTC(year, month, 0)));
const dayAfter = (date: string) => {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
};

/** How a fiscal year is named: "2026" when the year starts in January, "FY2026" otherwise. */
export function fiscalYearLabel(fiscalYear: number, fiscalStartMonth: number): string {
  return fiscalStartMonth === 1 ? String(fiscalYear) : `FY${fiscalYear}`;
}

/** The calendar months, calendar quarters or fiscal years from `from` to `to`, the first and last clipped to the range. */
export function buildPeriods(from: string, to: string, granularity: Granularity, fiscalStartMonth: number): TaxPeriod[] {
  const periods: TaxPeriod[] = [];
  let cursor = from;
  while (cursor <= to) {
    const [year, month] = cursor.split("-").map(Number);
    let start: string;
    let end: string;
    let label: string;
    if (granularity === "monthly") {
      start = firstOf(year, month);
      end = lastOf(year, month);
      label = monthLabel(`${year}-${String(month).padStart(2, "0")}`);
    } else if (granularity === "quarterly") {
      const quarter = Math.floor((month - 1) / 3);
      start = firstOf(year, quarter * 3 + 1);
      end = lastOf(year, quarter * 3 + 3);
      label = `Q${quarter + 1} ${year}`;
    } else {
      const fiscalYear = fiscalYearForDate(cursor, fiscalStartMonth);
      start = firstOf(fiscalYear, fiscalStartMonth);
      end = dayBefore(firstOf(fiscalYear + 1, fiscalStartMonth));
      label = fiscalYearLabel(fiscalYear, fiscalStartMonth);
    }
    periods.push({ key: start, label, start: start < from ? from : start, end: end > to ? to : end });
    cursor = dayAfter(end);
  }
  return periods;
}

// --- The report --------------------------------------------------------------

/** What the service reads: everything the report is worked out from, before a period size is chosen. */
export interface SalesTaxLiabilityData {
  from: string;
  to: string;
  fiscalStartMonth: number;
  basis: TaxAccountBasis;
  /** Owed (credit less debit on the tax accounts) the day before `from`. */
  openingMinor: number;
  /** Owed on `to` according to the tax accounts' own ledger balance. */
  ledgerClosingMinor: number;
  days: TaxDay[];
  unlinked: { id: string; name: string }[];
}

export interface TaxPeriodRow {
  key: string;
  label: string;
  start: string;
  end: string;
  grossMinor: number;
  taxableMinor: number;
  exemptMinor: number;
  /** Collected ÷ taxable, the rate actually charged; null when nothing was taxable. */
  ratePercent: number | null;
  collectedMinor: number;
  paidMinor: number;
  adjustmentMinor: number;
  owedMinor: number;
}

export interface SalesTaxLiabilityReport {
  from: string;
  to: string;
  granularity: Granularity;
  basis: TaxAccountBasis;
  /** Shown as the first row when it is not zero. */
  openingMinor: number;
  periods: TaxPeriodRow[];
  total: Omit<TaxPeriodRow, "key" | "label" | "start" | "end" | "ratePercent" | "owedMinor"> & { owedMinor: number };
  collectedMinor: number;
  paidMinor: number;
  owedAtEndMinor: number;
  /** Collected ÷ taxable over the whole range. */
  effectiveRatePercent: number | null;
  /** The closing figure against the tax accounts' own balance. */
  proof: TieOut;
  unlinked: { id: string; name: string }[];
}

function rateOf(collectedMinor: number, taxableMinor: number): number | null {
  return taxableMinor === 0 ? null : (collectedMinor / taxableMinor) * 100;
}

/** The report for one period size, from what the service read. */
export function buildSalesTaxLiability(data: SalesTaxLiabilityData, granularity: Granularity): SalesTaxLiabilityReport {
  const periods = buildPeriods(data.from, data.to, granularity, data.fiscalStartMonth);
  const days = [...data.days].filter((d) => d.date >= data.from && d.date <= data.to).sort((a, b) => a.date.localeCompare(b.date));
  let owed = data.openingMinor;
  let next = 0;
  const rows: TaxPeriodRow[] = periods.map((p) => {
    const row: TaxPeriodRow = {
      ...p,
      grossMinor: 0,
      taxableMinor: 0,
      exemptMinor: 0,
      ratePercent: null,
      collectedMinor: 0,
      paidMinor: 0,
      adjustmentMinor: 0,
      owedMinor: 0,
    };
    while (next < days.length && days[next].date <= p.end) {
      const d = days[next++];
      row.taxableMinor += d.taxableMinor;
      row.exemptMinor += d.exemptMinor;
      row.collectedMinor += d.collectedMinor;
      row.paidMinor += d.paidMinor;
      row.adjustmentMinor += d.adjustmentMinor;
    }
    row.grossMinor = row.taxableMinor + row.exemptMinor;
    row.ratePercent = rateOf(row.collectedMinor, row.taxableMinor);
    owed += row.collectedMinor - row.paidMinor + row.adjustmentMinor;
    row.owedMinor = owed;
    return row;
  });

  const sum = (pick: (r: TaxPeriodRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const taxableMinor = sum((r) => r.taxableMinor);
  const exemptMinor = sum((r) => r.exemptMinor);
  const collectedMinor = sum((r) => r.collectedMinor);
  const paidMinor = sum((r) => r.paidMinor);
  return {
    from: data.from,
    to: data.to,
    granularity,
    basis: data.basis,
    openingMinor: data.openingMinor,
    periods: rows,
    total: {
      grossMinor: taxableMinor + exemptMinor,
      taxableMinor,
      exemptMinor,
      collectedMinor,
      paidMinor,
      adjustmentMinor: sum((r) => r.adjustmentMinor),
      owedMinor: owed,
    },
    collectedMinor,
    paidMinor,
    owedAtEndMinor: owed,
    effectiveRatePercent: rateOf(collectedMinor, taxableMinor),
    proof: tieOut(owed, data.ledgerClosingMinor),
    unlinked: data.unlinked,
  };
}

// --- Words -------------------------------------------------------------------

export const OPENING_ROW_LABEL = "Owed before this range";
export const NO_TAX_ACCOUNT_TITLE = "No sales tax account in this chart.";
export const NO_TAX_ACCOUNT_HINT = "Set up a sales tax rate under Sales Tax, and what you charge lands here.";
export const NOTHING_OUTSTANDING = "Nothing outstanding.";
export const LIABILITY_REPORT_LINK_LABEL = "Sales Tax Liability by period";

export const SALES_TAX_FOOTNOTE_TITLE = "Read from the entries, not from a rate table.";
export const SALES_TAX_FOOTNOTE =
  "A sale is taxable when its entry carries a line to the tax account. The Exempt column is where a missing tax line would show. The rate shown is the rate actually charged.";

export function owedAtLabel(report: Pick<SalesTaxLiabilityReport, "to">): string {
  return `Owed at ${shortDate(report.to)}`;
}

export function paymentButtonLabel(amountText: string): string {
  return `Record a payment of ${amountText}`;
}

export function unlinkedWarning(unlinked: readonly { name: string }[]): string | null {
  if (unlinked.length === 0) return null;
  const names = unlinked.map((a) => `“${a.name}”`).join(", ");
  return `${names} ${unlinked.length === 1 ? "reads" : "read"} as sales tax, but no tax rate posts to ${unlinked.length === 1 ? "it" : "them"}, so ${unlinked.length === 1 ? "it is" : "they are"} not in these figures.`;
}

export function formatRate(ratePercent: number | null): string {
  return ratePercent === null ? "—" : `${ratePercent.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** The report as one flat export: the opening row, a row for each period, then the total. */
export function salesTaxLiabilitySheet(
  report: SalesTaxLiabilityReport,
  ctx: { companyName: string; currencyCode: string; money: (minor: number) => string },
): ReportExportSheet {
  const money = ctx.money;
  const rows: ReportExportSheet["rows"] = [];
  const blank = { gross: "", taxable: "", exempt: "", rate: "", collected: "", paid: "", adjustment: "" };
  if (report.openingMinor !== 0) rows.push({ period: OPENING_ROW_LABEL, ...blank, owed: money(report.openingMinor) });
  for (const p of report.periods) {
    rows.push({
      period: p.label,
      gross: money(p.grossMinor),
      taxable: money(p.taxableMinor),
      exempt: money(p.exemptMinor),
      rate: p.ratePercent === null ? "" : formatRate(p.ratePercent),
      collected: money(p.collectedMinor),
      paid: money(p.paidMinor),
      adjustment: money(p.adjustmentMinor),
      owed: money(p.owedMinor),
    });
  }
  rows.push({
    period: "Total",
    gross: money(report.total.grossMinor),
    taxable: money(report.total.taxableMinor),
    exempt: money(report.total.exemptMinor),
    rate: "",
    collected: money(report.total.collectedMinor),
    paid: money(report.total.paidMinor),
    adjustment: money(report.total.adjustmentMinor),
    owed: money(report.total.owedMinor),
  });
  return {
    fileName: sanitizeExportFileName(`sales-tax-liability-${report.from}-to-${report.to}`),
    companyName: ctx.companyName,
    title: "Sales Tax Liability",
    subtitle: `${report.from} to ${report.to}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "period", header: "Period", kind: "text", width: 24 },
      { key: "gross", header: "Gross sales", kind: "text", width: 16 },
      { key: "taxable", header: "Taxable", kind: "text", width: 16 },
      { key: "exempt", header: "Exempt", kind: "text", width: 16 },
      { key: "rate", header: "Rate", kind: "text", width: 10 },
      { key: "collected", header: "Tax collected", kind: "text", width: 16 },
      { key: "paid", header: "Paid over", kind: "text", width: 16 },
      { key: "adjustment", header: "Adjustments", kind: "text", width: 16 },
      { key: "owed", header: "Owed at period end", kind: "text", width: 18 },
    ],
    rows,
  };
}
```

- [ ] **Step 7: Create `ctyhp-accounting/lib/services/sales-tax-liability.ts`** with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { dayBefore } from "@/lib/domain/fiscal";
import {
  classifyEntries,
  resolveTaxAccounts,
  type SalesTaxLiabilityData,
  type TaxLedgerLine,
} from "@/lib/domain/sales-tax-liability";
import { getCurrentCompanySettings } from "./company";
import { readAllPages } from "./paging";
import { getLedgerBalances } from "./reports";

export class SalesTaxLiabilityError extends Error {}

const fail = (message: string) => new SalesTaxLiabilityError(message);

/**
 * Every posted line on the given accounts in the range, credit-positive. Paged
 * in line-id order: the id is unique, so no line can straddle a page.
 */
async function postedLines(
  sb: SupabaseClient,
  accountIds: readonly string[],
  kind: TaxLedgerLine["kind"],
  from: string,
  to: string,
): Promise<TaxLedgerLine[]> {
  if (accountIds.length === 0) return [];
  const rows = await readAllPages<Record<string, unknown>>(
    (start, end) =>
      sb
        .from("acc_journal_line")
        .select("id,debit_minor,amount_base_minor,journal_entry_id,acc_journal_entry!inner(entry_date,status)")
        .in("account_id", accountIds as string[])
        .eq("acc_journal_entry.status", "posted")
        .gte("acc_journal_entry.entry_date", from)
        .lte("acc_journal_entry.entry_date", to)
        .order("id")
        .range(start, end),
    fail,
  );
  return rows.map((r) => {
    const base = Number(r.amount_base_minor);
    return {
      entryId: r.journal_entry_id as string,
      entryDate: (r.acc_journal_entry as { entry_date: string }).entry_date,
      kind,
      creditMinor: Number(r.debit_minor) > 0 ? -base : base,
    };
  });
}

/**
 * What Sales Tax Liability is worked out from, for From to To: the tax
 * accounts (the ones sales-direction tax codes post to, else the liability
 * accounts named for sales tax), the entries on them and on income accounts
 * classified and added up by day, the amount owed the day before From and the
 * tax accounts' own ledger balance on To. Read-only.
 */
export async function getSalesTaxLiabilityData(sb: SupabaseClient, from: string, to: string): Promise<SalesTaxLiabilityData> {
  const [settings, accountRows, codeRows] = await Promise.all([
    getCurrentCompanySettings(sb),
    readAllPages<{ id: string; name: string; account_type: string }>(
      (start, end) => sb.from("acc_account").select("id,name,account_type").order("id").range(start, end),
      fail,
    ),
    readAllPages<{ id: string; direction: string; tax_account_id: string | null }>(
      (start, end) => sb.from("acc_tax_code").select("id,direction,tax_account_id").order("id").range(start, end),
      fail,
    ),
  ]);
  const accounts = accountRows.map((a) => ({ id: a.id, name: a.name, accountType: a.account_type }));
  const resolved = resolveTaxAccounts(
    accounts,
    codeRows.map((c) => ({ direction: c.direction, taxAccountId: c.tax_account_id })),
  );
  const fiscalStartMonth = settings?.fiscal_year_start_month ?? 1;
  const base = { from, to, fiscalStartMonth, basis: resolved.basis, unlinked: resolved.unlinked };
  if (resolved.accountIds.length === 0) {
    return { ...base, openingMinor: 0, ledgerClosingMinor: 0, days: [] };
  }

  const taxIds = new Set(resolved.accountIds);
  const incomeIds = accountRows.filter((a) => a.account_type === "income").map((a) => a.id);
  const owed = (balances: { accountId: string; debitBase: number; creditBase: number }[]) =>
    balances.filter((b) => taxIds.has(b.accountId)).reduce((sum, b) => sum + (b.creditBase - b.debitBase), 0);

  const [taxLines, incomeLines, opening, closing] = await Promise.all([
    postedLines(sb, resolved.accountIds, "tax", from, to),
    postedLines(sb, incomeIds, "income", from, to),
    getLedgerBalances(sb, null, dayBefore(from)),
    getLedgerBalances(sb, null, to),
  ]);

  return {
    ...base,
    openingMinor: owed(opening),
    ledgerClosingMinor: owed(closing),
    days: classifyEntries([...taxLines, ...incomeLines]),
  };
}
```

- [ ] **Step 8: Create `ctyhp-accounting/app/(app)/reports/sales-tax-liability/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import type { SalesTaxLiabilityData } from "@/lib/domain/sales-tax-liability";
import { getSalesTaxLiabilityData } from "@/lib/services/sales-tax-liability";

/** Sales Tax Liability: read-only. Recording a payment goes through the Sales Tax Center's own action. */
export async function salesTaxLiabilityAction(when: ReportWhen): Promise<ReportRunResult<SalesTaxLiabilityData>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getSalesTaxLiabilityData(sb, checked.from as string, checked.to) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 9: Create `ctyhp-accounting/app/(app)/reports/sales-tax-liability/SalesTaxLiabilityClient.tsx`** with exactly this content:

```tsx
"use client";

import { useCallback, useState } from "react";
import { Alert, Button, Empty, Segmented } from "antd";
import ReportTable, { SummaryCell, SummaryRow } from "@/components/ui/ReportTable";
import { flexColumn } from "@/components/ui/columns";
import ProofLine from "@/components/reports/ProofLine";
import { ReportFoot, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport, { reportPagination } from "@/components/reports/SimpleReport";
import RecordTaxPaymentModal, { type TaxPaymentAccountOption, type TaxPaymentPrefill } from "@/components/sales-tax/RecordTaxPaymentModal";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import type { PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import {
  DEFAULT_GRANULARITY,
  GRANULARITIES,
  NOTHING_OUTSTANDING,
  NO_TAX_ACCOUNT_HINT,
  NO_TAX_ACCOUNT_TITLE,
  OPENING_ROW_LABEL,
  SALES_TAX_FOOTNOTE,
  SALES_TAX_FOOTNOTE_TITLE,
  buildSalesTaxLiability,
  formatRate,
  owedAtLabel,
  paymentButtonLabel,
  salesTaxLiabilitySheet,
  unlinkedWarning,
  type Granularity,
  type SalesTaxLiabilityData,
  type TaxPeriodRow,
} from "@/lib/domain/sales-tax-liability";

const PAGE_SIZE = 50;

/** A row of the period table: a period, or the opening row, which has only its owed figure. */
type TableRow = Partial<TaxPeriodRow> & { key: string; label: string; owedMinor: number; opening?: boolean };

/**
 * Sales Tax Liability: what was charged and what was paid over, by month,
 * quarter or fiscal year, with what is still owed after each. Read from the
 * entries on the tax accounts, so credit memos and imported books are counted.
 */
export default function SalesTaxLiabilityClient({
  companyName,
  currencyCode,
  decimals,
  presets,
  load,
  canWrite,
  taxPayableAccounts,
  bankAccounts,
}: {
  companyName: string;
  currencyCode: string;
  decimals: number;
  presets: PresetContext;
  load: (when: ReportWhen) => Promise<ReportRunResult<SalesTaxLiabilityData>>;
  canWrite: boolean;
  taxPayableAccounts: TaxPaymentAccountOption[];
  bankAccounts: TaxPaymentAccountOption[];
}) {
  const [granularity, setGranularity] = useState<Granularity>(DEFAULT_GRANULARITY);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [payOpen, setPayOpen] = useState(false);
  const [prefill, setPrefill] = useState<TaxPaymentPrefill | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const sheet = useCallback(
    (data: SalesTaxLiabilityData) => salesTaxLiabilitySheet(buildSalesTaxLiability(data, granularity), { companyName, currencyCode, money }),
    [companyName, currencyCode, money, granularity],
  );
  const moneyCell = (minor: number | undefined) =>
    minor === undefined ? "" : <span className={minor < 0 ? styles.negative : undefined}>{money(minor)}</span>;

  return (
    <>
      <SimpleReport<SalesTaxLiabilityData>
        companyName={companyName}
        title="Sales Tax Liability"
        currencyCode={currencyCode}
        period={{ kind: "range", ctx: presets, preset: "year" }}
        load={load}
        sheet={sheet}
        refreshKey={refreshKey}
        runningText="Adding up the sales tax…"
        filters={
          <Segmented<Granularity>
            aria-label="Period size"
            value={granularity}
            onChange={setGranularity}
            options={GRANULARITIES.map((g) => ({ value: g.value, label: g.label }))}
          />
        }
        render={(data, _when, { printing }) => {
          if (data.basis === "none") {
            return (
              <Empty
                description={
                  <>
                    <strong>{NO_TAX_ACCOUNT_TITLE}</strong>
                    <div className={styles.muted}>{NO_TAX_ACCOUNT_HINT}</div>
                  </>
                }
              />
            );
          }
          const report = buildSalesTaxLiability(data, granularity);
          const warning = unlinkedWarning(report.unlinked);
          const showAdjustments = report.total.adjustmentMinor !== 0;
          const rows: TableRow[] = [
            ...(report.openingMinor !== 0 ? [{ key: "opening", label: OPENING_ROW_LABEL, owedMinor: report.openingMinor, opening: true }] : []),
            ...report.periods,
          ];
          const owed = report.owedAtEndMinor;

          return (
            <>
              <StatRow
                items={[
                  { label: "Collected", value: money(report.collectedMinor) },
                  { label: "Paid over", value: money(report.paidMinor) },
                  { label: owedAtLabel(report), value: money(owed), danger: owed !== 0 },
                  { label: "Effective rate", value: formatRate(report.effectiveRatePercent) },
                ]}
              />

              {warning ? <Alert type="warning" showIcon title={warning} style={{ marginBottom: 16 }} /> : null}

              <ReportTable<TableRow>
                rowKey={(row) => row.key}
                dataSource={rows}
                pagination={reportPagination(printing, pageSize, setPageSize, PAGE_SIZE)}
                emptyTitle="No periods to show"
                summary={() => (
                  <SummaryRow>
                    <SummaryCell index={0}>
                      <b>Total</b>
                    </SummaryCell>
                    <SummaryCell index={1} align="right">
                      <b>{money(report.total.grossMinor)}</b>
                    </SummaryCell>
                    <SummaryCell index={2} align="right">
                      <b>{money(report.total.taxableMinor)}</b>
                    </SummaryCell>
                    <SummaryCell index={3} align="right">
                      <b>{money(report.total.exemptMinor)}</b>
                    </SummaryCell>
                    <SummaryCell index={4} align="right" />
                    <SummaryCell index={5} align="right">
                      <b>{money(report.total.collectedMinor)}</b>
                    </SummaryCell>
                    <SummaryCell index={6} align="right">
                      <b>{money(report.total.paidMinor)}</b>
                    </SummaryCell>
                    {showAdjustments ? (
                      <SummaryCell index={7} align="right">
                        <b>{money(report.total.adjustmentMinor)}</b>
                      </SummaryCell>
                    ) : null}
                    <SummaryCell index={showAdjustments ? 8 : 7} align="right">
                      <b>{money(report.total.owedMinor)}</b>
                    </SummaryCell>
                  </SummaryRow>
                )}
                columns={[
                  flexColumn<TableRow>({
                    title: "Period",
                    key: "period",
                    render: (_: unknown, row: TableRow) => (row.opening ? <span className={styles.muted}>{row.label}</span> : row.label),
                  }),
                  { title: "Gross sales", dataIndex: "grossMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  { title: "Taxable", dataIndex: "taxableMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  { title: "Exempt", dataIndex: "exemptMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  {
                    title: "Rate",
                    dataIndex: "ratePercent",
                    width: COLUMN.QTY,
                    align: "right",
                    render: (value: number | null | undefined) => (value === undefined ? "" : <span className={styles.muted}>{formatRate(value)}</span>),
                  },
                  { title: "Tax collected", dataIndex: "collectedMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  { title: "Paid over", dataIndex: "paidMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  ...(showAdjustments
                    ? [{ title: "Adjustments", dataIndex: "adjustmentMinor", width: COLUMN.MONEY_WIDE, align: "right" as const, render: moneyCell }]
                    : []),
                  { title: "Owed at period end", dataIndex: "owedMinor", width: COLUMN.MONEY_WIDE + 20, align: "right", render: moneyCell },
                ]}
              />
              <ProofLine
                against={`the tax accounts’ ledger balance on ${report.to}`}
                tie={report.proof}
                money={money}
                whenOut={
                  <>The figure owed is worked out from the entries on the tax accounts, so a gap points to an entry dated outside the range or one the report could not read.</>
                }
              />

              {!printing ? (
                <div style={{ marginTop: 16 }}>
                  {owed > 0 ? (
                    canWrite ? (
                      <Button
                        type="primary"
                        onClick={() => {
                          setPrefill({ amountMinor: owed, from: report.from, to: report.to });
                          setPayOpen(true);
                        }}
                      >
                        {paymentButtonLabel(money(owed))}
                      </Button>
                    ) : null
                  ) : (
                    <span className={styles.muted}>{NOTHING_OUTSTANDING}</span>
                  )}
                </div>
              ) : null}

              <ReportFoot>
                <strong>{SALES_TAX_FOOTNOTE_TITLE}</strong> {SALES_TAX_FOOTNOTE}
              </ReportFoot>
            </>
          );
        }}
      />
      <RecordTaxPaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        onRecorded={() => setRefreshKey((k) => k + 1)}
        taxPayableAccounts={taxPayableAccounts}
        bankAccounts={bankAccounts}
        baseCurrency={currencyCode}
        decimals={decimals}
        prefill={prefill}
      />
    </>
  );
}
```

- [ ] **Step 10: Create `ctyhp-accounting/app/(app)/reports/sales-tax-liability/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { resolveTaxAccounts } from "@/lib/domain/sales-tax-liability";
import { listAccounts } from "@/lib/services/accounts";
import { listTaxCodes } from "@/lib/services/reference";
import { reportPageContext } from "@/lib/services/report-context";
import SalesTaxLiabilityClient from "./SalesTaxLiabilityClient";
import { salesTaxLiabilityAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SalesTaxLiabilityPage() {
  const sb = await createSupabaseServerClient();
  const [ctx, role] = await Promise.all([reportPageContext(sb), getUserRole()]);
  const writer = canWrite(role);

  // Only a writer can record a payment, so only a writer needs the accounts to pay from and to.
  let taxPayableAccounts: { id: string; account_code: string; name: string }[] = [];
  let bankAccounts: { id: string; account_code: string; name: string }[] = [];
  if (writer) {
    const [accounts, codes] = await Promise.all([listAccounts(sb), listTaxCodes(sb)]);
    const taxIds = new Set(
      resolveTaxAccounts(
        accounts.map((a) => ({ id: a.id, name: a.name, accountType: a.account_type })),
        codes.map((c) => ({ direction: c.direction, taxAccountId: c.tax_account_id })),
      ).accountIds,
    );
    const open = accounts.filter((a) => a.is_posting_account && a.status === "active");
    const option = (a: { id: string; account_code: string; name: string }) => ({ id: a.id, account_code: a.account_code, name: a.name });
    taxPayableAccounts = open.filter((a) => taxIds.has(a.id)).map(option);
    bankAccounts = open.filter((a) => a.account_type === "bank" || a.account_type === "credit_card").map(option);
  }

  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Sales Tax Liability"
        description="Sales tax charged and paid, period by period."
      />
      <SalesTaxLiabilityClient
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        presets={ctx.presets}
        load={salesTaxLiabilityAction}
        canWrite={writer}
        taxPayableAccounts={taxPayableAccounts}
        bankAccounts={bankAccounts}
      />
    </div>
  );
}
```

- [ ] **Step 11: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/sales-tax-liability.test.ts" "components/reports/SimpleReport.tsx" "components/sales-tax/RecordTaxPaymentModal.tsx" "app/(app)/sales-tax/SalesTaxClient.tsx" "lib/domain/sales-tax-liability.ts" "lib/services/sales-tax-liability.ts" "app/(app)/reports/sales-tax-liability/actions.ts" "app/(app)/reports/sales-tax-liability/SalesTaxLiabilityClient.tsx" "app/(app)/reports/sales-tax-liability/page.tsx"
npx vitest run tests/unit/sales-tax-liability.test.ts tests/unit/salestax.test.ts tests/unit/tax-jurisdiction.test.ts tests/unit/table-adoption.test.ts tests/unit/rsc-antd.test.ts tests/unit/report-frame-contract.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; sales-tax-liability: 20 tests passing; the existing sales tax, table-adoption, rsc-antd and report-frame-contract tests pass.

- [ ] **Step 12: Commit**

```bash
git add "ctyhp-accounting/tests/unit/sales-tax-liability.test.ts" "ctyhp-accounting/components/reports/SimpleReport.tsx" "ctyhp-accounting/components/sales-tax/RecordTaxPaymentModal.tsx" "ctyhp-accounting/app/(app)/sales-tax/SalesTaxClient.tsx" "ctyhp-accounting/lib/domain/sales-tax-liability.ts" "ctyhp-accounting/lib/services/sales-tax-liability.ts" "ctyhp-accounting/app/(app)/reports/sales-tax-liability/actions.ts" "ctyhp-accounting/app/(app)/reports/sales-tax-liability/SalesTaxLiabilityClient.tsx" "ctyhp-accounting/app/(app)/reports/sales-tax-liability/page.tsx"
git commit -m "feat(reports): Sales Tax Liability by period, sharing the Record tax payment dialog"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 4: The 13 Week Cash Forecast

**Files:**
- Test (modify): `ctyhp-accounting/tests/unit/forecast.test.ts`
- Modify: `ctyhp-accounting/lib/domain/forecast.ts`
- Modify: `ctyhp-accounting/lib/services/forecast.ts`
- Create: `ctyhp-accounting/components/reports/cash-forecast.module.css`
- Create: `ctyhp-accounting/components/reports/ForecastChart.tsx`
- Create: `ctyhp-accounting/components/reports/CashForecastReport.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/cash-flow-forecast/actions.ts`
- Modify: `ctyhp-accounting/app/(app)/reports/cash-flow-forecast/page.tsx`
- Test (modify): `ctyhp-accounting/tests/unit/table-adoption.test.ts`
- Test (modify): `ctyhp-accounting/tests/e2e/settlement-history.e2e.ts`
- Delete: `ctyhp-accounting/app/(app)/reports/cash-flow-forecast/CashFlowForecastClient.tsx`

**Interfaces:**
- Consumes: existing RPCs `acc_open_items`, `acc_settlement_lag`; `nextRecurringDate`, `addDays` (`lib/domain/recurring.ts`); `getLedgerBalances`; `reportPageContext` / `companyClock`; `SimpleReport`.
- Produces: the forecast model and service the page uses (`getCashForecast` in `lib/services/forecast.ts`; the pure builder and `chartPoints` in `lib/domain/forecast.ts`); `CashForecastReport` and `ForecastChart` components; the upgraded page `/reports/cash-flow-forecast` titled "13 Week Cash Forecast". `tests/e2e/settlement-history.e2e.ts` moves to `getCashForecast` (it writes, so it is not run here). The catalog title changes in Task 6.

- [ ] **Step 1: Replace the whole of `ctyhp-accounting/tests/unit/forecast.test.ts`** (most of it changes) with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import {
  addDays,
  buildCashForecast,
  chartPoints,
  cutName,
  describeForecastBasis,
  expandRecurring,
  medianLagDays,
  monthDay,
  type OpenItem,
  type RecurringTemplateInput,
  type SettlementLagSample,
} from "@/lib/domain/forecast";

const TODAY = "2026-07-31"; // a Friday: the first week still starts on it
const BANK = "bank-account-1";
const CARD = "card-account-1";
const BANKS = new Set([BANK]);

const receivable = (over: Partial<OpenItem> = {}): OpenItem => ({
  side: "receivable",
  documentId: "inv-1",
  documentNumber: "INV-000010",
  partyName: "Elena Brooks",
  dueDate: "2026-08-05",
  balanceMinor: 1_000_00,
  ...over,
});

const payable = (over: Partial<OpenItem> = {}): OpenItem => ({
  ...receivable({ documentId: "bill-1", documentNumber: "BILL-000004", partyName: "Gem Supply Co", ...over }),
  side: "payable",
});

const lag = (side: "receivable" | "payable", dueDate: string, settledOn: string): SettlementLagSample => ({
  side,
  dueDate,
  settledOn,
  amountMinor: 100_00,
});

const template = (over: Partial<RecurringTemplateInput> = {}): RecurringTemplateInput => ({
  id: "tpl-1",
  name: "Office rent",
  documentType: "bill",
  frequency: "monthly",
  intervalCount: 1,
  startDate: "2026-06-05",
  nextRunDate: "2026-08-05",
  endDate: null,
  status: "active",
  totalMinor: 2_000_00,
  payload: { due_days: 0 },
  ...over,
});

const expand = (templates: RecurringTemplateInput[], today = TODAY) =>
  expandRecurring({ templates, today, horizonEnd: addDays(today, 90), bankAccountIds: BANKS, baseCurrency: "USD" });

describe("helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("writes a month and day", () => {
    expect(monthDay("2026-10-16")).toBe("Oct 16");
    expect(monthDay("2026-01-05")).toBe("Jan 5");
  });

  it("cuts a long template name to 40 characters, ellipsis included", () => {
    expect(cutName("Office rent")).toBe("Office rent");
    const cut = cutName("A".repeat(60));
    expect(cut).toHaveLength(40);
    expect(cut.endsWith("…")).toBe(true);
    expect(cutName("B".repeat(40))).toBe("B".repeat(40));
  });
});

describe("medianLagDays", () => {
  it("takes the middle value, not the average, so one outlier cannot move it", () => {
    const samples = [
      lag("receivable", "2026-01-10", "2026-01-12"),
      lag("receivable", "2026-02-10", "2026-02-15"),
      lag("receivable", "2026-03-10", "2027-03-10"),
    ];
    expect(medianLagDays(samples)).toBe(5);
  });

  it("averages the two middle values on an even sample", () => {
    expect(
      medianLagDays([lag("receivable", "2026-01-10", "2026-01-14"), lag("receivable", "2026-02-10", "2026-02-20")]),
    ).toBe(7);
  });

  it("keeps early payment as a negative lag", () => {
    expect(medianLagDays([lag("receivable", "2026-01-10", "2026-01-05")])).toBe(-5);
  });

  it("has no answer with nothing to learn from", () => {
    expect(medianLagDays([])).toBeNull();
  });
});

describe("buildCashForecast: the weeks", () => {
  it("makes thirteen seven-day weeks starting on today, labelled This week then w/c", () => {
    const forecast = buildCashForecast({ today: TODAY, mode: "due", openingMinor: 0, openItems: [] });
    expect(forecast.weeks).toHaveLength(13);
    expect(forecast.weeks[0]).toMatchObject({ label: "This week", start: "2026-07-31", end: "2026-08-06" });
    expect(forecast.weeks[1]).toMatchObject({ label: "w/c Aug 7", start: "2026-08-07", end: "2026-08-13" });
    expect(forecast.weeks[12].end).toBe("2026-10-29");
  });

  it("puts a due date in the week it falls in, and starts cash from the opening balance", () => {
    const forecast = buildCashForecast({
      today: TODAY,
      mode: "due",
      openingMinor: 5_000_00,
      openItems: [
        receivable({ dueDate: "2026-08-06", balanceMinor: 1_000_00 }), // last day of week one
        receivable({ documentId: "inv-2", dueDate: "2026-08-07", balanceMinor: 250_00 }), // first day of week two
        payable({ dueDate: "2026-08-08", balanceMinor: 400_00 }),
      ],
    });
    expect(forecast.weeks[0].fromCustomersMinor).toBe(1_000_00);
    expect(forecast.weeks[1].fromCustomersMinor).toBe(250_00);
    expect(forecast.weeks[1].toSuppliersMinor).toBe(400_00);
    expect(forecast.weeks[0].closingMinor).toBe(6_000_00);
    expect(forecast.weeks[1].netMinor).toBe(-150_00);
    expect(forecast.weeks[1].closingMinor).toBe(5_850_00);
    expect(forecast.closingMinor).toBe(5_850_00);
    expect(forecast.dueInMinor).toBe(1_250_00);
    expect(forecast.dueOutMinor).toBe(400_00);
  });

  it("shows the lowest point only when the running balance dips under the opening cash", () => {
    const rising = buildCashForecast({
      today: TODAY,
      mode: "due",
      openingMinor: 1_000_00,
      openItems: [receivable({ balanceMinor: 500_00 })],
    });
    expect(rising.lowest).toBeNull();

    const dipping = buildCashForecast({
      today: TODAY,
      mode: "due",
      openingMinor: 1_000_00,
      openItems: [payable({ dueDate: "2026-08-12", balanceMinor: 300_00 }), receivable({ dueDate: "2026-08-20", balanceMinor: 900_00 })],
    });
    expect(dipping.lowest).toEqual({ label: "w/c Aug 7", start: "2026-08-07", minor: 700_00 });
    expect(dipping.firstBelowZero).toBeNull();
  });

  it("names the first week that ends below zero", () => {
    const forecast = buildCashForecast({
      today: TODAY,
      mode: "due",
      openingMinor: 100_00,
      openItems: [payable({ dueDate: "2026-08-12", balanceMinor: 500_00 }), payable({ documentId: "b2", dueDate: "2026-08-25", balanceMinor: 50_00 })],
    });
    expect(forecast.firstBelowZero).toEqual({ start: "2026-08-07", minor: -400_00 });
    expect(forecast.closingMinor).toBe(-450_00);
  });
});

describe("buildCashForecast: overdue, the switch and the horizon", () => {
  const settled = [
    lag("receivable", "2026-06-01", "2026-06-12"),
    lag("receivable", "2026-06-10", "2026-06-21"),
    lag("receivable", "2026-07-01", "2026-07-12"),
    lag("payable", "2026-06-01", "2026-06-04"),
  ]; // customers 11 days late, suppliers 3 days late

  it("lands overdue items in week one under both settings", () => {
    for (const mode of ["due", "usual"] as const) {
      const forecast = buildCashForecast({
        today: TODAY,
        mode,
        openingMinor: 0,
        openItems: [receivable({ dueDate: "2026-04-21", balanceMinor: 759_07 }), payable({ dueDate: "2026-07-01", balanceMinor: 120_00 })],
        lagSamples: settled,
      });
      expect(forecast.weeks[0].fromCustomersMinor, mode).toBe(759_07);
      expect(forecast.weeks[0].toSuppliersMinor, mode).toBe(120_00);
      expect(forecast.overdueInMinor).toBe(759_07);
      expect(forecast.overdueOutMinor).toBe(120_00);
    }
  });

  it("moves only the customer and supplier columns when the switch changes", () => {
    const input = {
      today: TODAY,
      openingMinor: 1_000_00,
      openItems: [receivable({ dueDate: "2026-08-05", balanceMinor: 900_00 }), payable({ dueDate: "2026-08-05", balanceMinor: 100_00 })],
      lagSamples: settled,
      recurring: expand([template({ nextRunDate: "2026-08-05" })]),
    };
    const byDue = buildCashForecast({ ...input, mode: "due" });
    const usual = buildCashForecast({ ...input, mode: "usual" });
    // 08-05 + 11 days = 08-16 → week three (starts 08-14); supplier +3 days = 08-08 → week two.
    expect(byDue.weeks[0].fromCustomersMinor).toBe(900_00);
    expect(usual.weeks[0].fromCustomersMinor).toBe(0);
    expect(usual.weeks[2].fromCustomersMinor).toBe(900_00);
    expect(byDue.weeks[0].toSuppliersMinor).toBe(100_00);
    expect(usual.weeks[1].toSuppliersMinor).toBe(100_00);
    expect(usual.weeks.map((w) => w.recurringMinor)).toEqual(byDue.weeks.map((w) => w.recurringMinor));
    expect(usual.receivableLagDays).toBe(11);
  });

  it("leaves usual-pay on the due dates when nothing has settled to learn from", () => {
    const forecast = buildCashForecast({ today: TODAY, mode: "usual", openingMinor: 0, openItems: [receivable()] });
    expect(forecast.receivableLagDays).toBeNull();
    expect(forecast.weeks[0].fromCustomersMinor).toBe(1_000_00);
  });

  it("sums items beyond the horizon apart, and inside plus beyond is every open item", () => {
    const forecast = buildCashForecast({
      today: TODAY,
      mode: "due",
      openingMinor: 0,
      openItems: [
        receivable({ dueDate: "2026-10-29", balanceMinor: 100_00 }), // last day of week thirteen
        receivable({ documentId: "inv-2", dueDate: "2026-10-30", balanceMinor: 300_00 }), // one day past
        payable({ dueDate: "2027-01-15", balanceMinor: 80_00 }),
      ],
    });
    expect(forecast.weeks[12].fromCustomersMinor).toBe(100_00);
    expect(forecast.beyondHorizonInMinor).toBe(300_00);
    expect(forecast.beyondHorizonOutMinor).toBe(80_00);
    expect(forecast.insideInMinor + forecast.beyondHorizonInMinor).toBe(forecast.totalOpenInMinor);
    expect(forecast.insideOutMinor + forecast.beyondHorizonOutMinor).toBe(forecast.totalOpenOutMinor);
    expect(forecast.totalOpenInMinor).toBe(400_00);
  });

  it("projects nothing when nothing is open", () => {
    const forecast = buildCashForecast({ today: TODAY, mode: "due", openingMinor: 42_00, openItems: [] });
    expect(forecast.weeks.every((w) => w.netMinor === 0 && w.closingMinor === 42_00)).toBe(true);
    expect(forecast.lowest).toBeNull();
  });
});

describe("expandRecurring", () => {
  it("skips run dates before today and counts the template as behind", () => {
    const result = expand([template({ nextRunDate: "2026-07-05", startDate: "2026-06-05" })]);
    // 07-05 is past; the next, 08-05, is the first counted.
    expect(result.behindCount).toBe(1);
    expect(result.occurrences.map((o) => o.date)).toEqual(["2026-08-05", "2026-09-05", "2026-10-05"]);
  });

  it("steps by frequency and interval and stops at the horizon", () => {
    const weekly = expand([template({ frequency: "weekly", intervalCount: 2, nextRunDate: "2026-08-03", startDate: "2026-08-03" })]);
    expect(weekly.occurrences.map((o) => o.date)).toEqual([
      "2026-08-03", "2026-08-17", "2026-08-31", "2026-09-14", "2026-09-28", "2026-10-12", "2026-10-26",
    ]);
    expect(weekly.behindCount).toBe(0);
  });

  it("respects end_date, inclusive", () => {
    const result = expand([template({ endDate: "2026-09-05" })]);
    expect(result.occurrences.map((o) => o.date)).toEqual(["2026-08-05", "2026-09-05"]);
  });

  it("ignores paused and ended templates", () => {
    const result = expand([template({ status: "paused" }), template({ id: "t2", status: "ended" })]);
    expect(result.occurrences).toEqual([]);
    expect(result.behindCount).toBe(0);
  });

  it("counts an invoice as money in, due days after the run date", () => {
    const result = expand([template({ documentType: "invoice", totalMinor: 700_00, nextRunDate: "2026-08-05", payload: { due_days: 30 } })]);
    expect(result.occurrences[0]).toMatchObject({ date: "2026-09-04", amountMinor: 700_00 });
    // The October run's cash date (11-04) is past the horizon, so it is left out.
    expect(result.occurrences.map((o) => o.date)).toEqual(["2026-09-04", "2026-10-05"]);
  });

  it("counts a bill as money out, the same way", () => {
    const result = expand([template({ documentType: "bill", totalMinor: 300_00, nextRunDate: "2026-08-05", payload: { due_days: 10 } })]);
    expect(result.occurrences[0]).toMatchObject({ date: "2026-08-15", amountMinor: -300_00 });
  });

  it("counts an expense paid from a bank account on the run date, and skips one paid by card", () => {
    const bank = template({ id: "e1", documentType: "expense", totalMinor: 90_00, payload: { payment_account_id: BANK } });
    const card = template({ id: "e2", documentType: "expense", totalMinor: 90_00, payload: { payment_account_id: CARD } });
    const result = expand([bank, card]);
    expect(result.occurrences.every((o) => o.templateId === "e1" && o.amountMinor === -90_00)).toBe(true);
    expect(result.occurrences[0].date).toBe("2026-08-05");
    // The card template is still behind-schedule material if its date passed, but here it is not.
    expect(result.behindCount).toBe(0);
  });

  it("reads a journal's bank lines, signed, and ignores its other lines", () => {
    const journal = template({
      documentType: "journal",
      totalMinor: 500_00,
      payload: {
        lines: [
          { account_id: BANK, debit_minor: 0, credit_minor: 500_00 },
          { account_id: "expense-1", debit_minor: 500_00, credit_minor: 0 },
        ],
      },
    });
    const received = template({
      id: "j2",
      documentType: "journal",
      payload: { lines: [{ account_id: BANK, debit_minor: 60_00, credit_minor: 0 }, { account_id: "income-1", debit_minor: 0, credit_minor: 60_00 }] },
    });
    const noBank = template({ id: "j3", documentType: "journal", payload: { lines: [{ account_id: "a", debit_minor: 5, credit_minor: 0 }, { account_id: "b", debit_minor: 0, credit_minor: 5 }] } });
    const result = expand([journal, received, noBank]);
    expect(result.occurrences.filter((o) => o.templateId === "tpl-1")[0].amountMinor).toBe(-500_00);
    expect(result.occurrences.filter((o) => o.templateId === "j2")[0].amountMinor).toBe(60_00);
    expect(result.occurrences.some((o) => o.templateId === "j3")).toBe(false);
  });

  it("leaves out a payload that names another currency, and counts it", () => {
    const result = expand([template({ payload: { due_days: 0, currency_code: "EUR" } })]);
    expect(result.occurrences).toEqual([]);
    expect(result.foreignCurrencyCount).toBe(1);
  });

  it("steps through a template years behind and counts only what is still ahead", () => {
    const result = expand([template({ frequency: "weekly", nextRunDate: "2000-01-03", startDate: "2000-01-03" })]);
    expect(result.behindCount).toBe(1);
    expect(result.occurrences.length).toBeGreaterThan(0);
    expect(result.occurrences.every((o) => o.date >= TODAY)).toBe(true);
  });

  it("gives up on a template so far behind its steps run out, rather than looping", () => {
    const result = expand([template({ frequency: "weekly", nextRunDate: "1900-01-01", startDate: "1900-01-01" })]);
    expect(result.behindCount).toBe(1);
    expect(result.occurrences).toEqual([]);
  });
});

describe("buildCashForecast: recurring in the weeks", () => {
  it("adds recurring money to its week, lists template names once, and reports the behind count", () => {
    const recurring = expand([
      template({ id: "a", name: "Office rent", totalMinor: 2_000_00, nextRunDate: "2026-08-05", endDate: "2026-08-31" }),
      template({ id: "b", name: "Retainer", documentType: "invoice", totalMinor: 800_00, nextRunDate: "2026-08-04", startDate: "2026-08-04", payload: { due_days: 0 }, endDate: "2026-08-31" }),
      template({ id: "c", name: "Old lease", nextRunDate: "2026-05-01", startDate: "2026-05-01", endDate: "2026-05-01" }),
    ]);
    const forecast = buildCashForecast({ today: TODAY, mode: "due", openingMinor: 1_000_00, openItems: [], recurring });
    expect(forecast.weeks[0].recurringInMinor).toBe(800_00);
    expect(forecast.weeks[0].recurringOutMinor).toBe(2_000_00);
    expect(forecast.weeks[0].recurringMinor).toBe(-1_200_00);
    expect(forecast.weeks[0].recurringNames).toEqual(["Retainer", "Office rent"]);
    expect(forecast.weeks[0].closingMinor).toBe(-200_00);
    expect(forecast.templatesBehind).toBe(1);
    expect(forecast.dueInMinor).toBe(800_00);
    expect(forecast.dueOutMinor).toBe(2_000_00);
  });

  it("plots cash at week end with money in and out per week", () => {
    const forecast = buildCashForecast({
      today: TODAY,
      mode: "due",
      openingMinor: 100_00,
      openItems: [receivable({ dueDate: "2026-08-10", balanceMinor: 50_00 })],
    });
    const points = chartPoints(forecast);
    expect(points).toHaveLength(13);
    expect(points[0].label).toBe("Now");
    expect(points[1]).toEqual({ label: "Aug 7", inMinor: 50_00, outMinor: 0, closingMinor: 150_00 });
  });
});

describe("describeForecastBasis", () => {
  it("says plainly when there is no history to lean on", () => {
    const forecast = buildCashForecast({ today: TODAY, mode: "usual", openingMinor: 0, openItems: [] });
    expect(describeForecastBasis(forecast)).toContain("no settled invoice");
  });

  it("quotes the lag and the sample it came from", () => {
    const forecast = buildCashForecast({
      today: TODAY,
      mode: "usual",
      openingMinor: 0,
      openItems: [],
      lagSamples: [lag("receivable", "2026-06-01", "2026-06-12"), lag("payable", "2026-06-01", "2026-05-30")],
    });
    expect(describeForecastBasis(forecast)).toContain("median 11 days late (1 paid invoices)");
    expect(describeForecastBasis(forecast)).toContain("median 2 days early (1 paid bills)");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run tests/unit/forecast.test.ts
```

Expected: FAIL — the new forecast functions do not exist yet.

- [ ] **Step 3: Replace the whole of `ctyhp-accounting/lib/domain/forecast.ts`** (most of it changes) with exactly this content:

```ts
/**
 * 13 Week Cash Forecast.
 *
 * Pure. Starts from the cash in the bank accounts today and lays what is
 * already committed onto thirteen seven-day blocks: open invoices and bills,
 * and the occurrences of active recurring templates. Nothing is invented; only
 * the timing of an open document can be estimated, and then only if the reader
 * asks for it ("As they usually pay").
 *
 * The weeks begin on the company's today, not on a Monday, so "This week" is
 * the seven days starting now.
 */

import { nextRecurringDate, type RecurringFrequency } from "./recurring";
import { daysBetween } from "./settlement";

export type CashSide = "receivable" | "payable";

/** Which dates put an open document in a week. */
export type ForecastMode = "due" | "usual";

export const FORECAST_WEEKS = 13;

/** A recurring template's name, cut for the narrow column under "Recurring". */
export const RECURRING_NAME_LIMIT = 40;

export interface OpenItem {
  side: CashSide;
  documentId: string;
  documentNumber: string | null;
  partyName: string;
  dueDate: string;
  balanceMinor: number;
}

export interface SettlementLagSample {
  side: CashSide;
  dueDate: string;
  settledOn: string;
  amountMinor: number;
}

export interface RecurringTemplateInput {
  id: string;
  name: string;
  documentType: "invoice" | "bill" | "expense" | "journal";
  frequency: RecurringFrequency;
  intervalCount: number;
  startDate: string;
  nextRunDate: string;
  endDate: string | null;
  status: "active" | "paused" | "ended";
  /** Document total in minor units (journals: total debits). */
  totalMinor: number;
  /** The template's stored payload, read defensively: it is jsonb. */
  payload: Record<string, unknown>;
}

/** One cash movement a recurring template will cause. */
export interface RecurringOccurrence {
  templateId: string;
  name: string;
  /** The day the cash moves: the run date, plus due days for an invoice or bill. */
  date: string;
  /** Positive for money in, negative for money out. */
  amountMinor: number;
}

export interface RecurringExpansion {
  occurrences: RecurringOccurrence[];
  /** Active templates whose next run date has already passed. */
  behindCount: number;
  /** Occurrences left out because their payload names a currency other than the base. */
  foreignCurrencyCount: number;
}

export interface ForecastWeek {
  index: number;
  /** "This week" for the first, "w/c Oct 16" for the rest. */
  label: string;
  start: string;
  end: string;
  fromCustomersMinor: number;
  toSuppliersMinor: number;
  /** Signed: recurring money in less recurring money out. */
  recurringMinor: number;
  recurringInMinor: number;
  recurringOutMinor: number;
  /** Distinct template names behind the recurring figure, in run order. */
  recurringNames: string[];
  netMinor: number;
  /** Cash at the end of the week. */
  closingMinor: number;
}

export interface CashForecast {
  today: string;
  mode: ForecastMode;
  openingMinor: number;
  weeks: ForecastWeek[];
  /** Every dollar expected to arrive and to leave inside the horizon, recurring included. */
  dueInMinor: number;
  dueOutMinor: number;
  closingMinor: number;
  /** The lowest week-end cash, only when it is under the opening cash. */
  lowest: { label: string; start: string; minor: number } | null;
  /** The first week that ends under zero. */
  firstBelowZero: { start: string; minor: number } | null;
  overdueInMinor: number;
  overdueOutMinor: number;
  beyondHorizonInMinor: number;
  beyondHorizonOutMinor: number;
  /** Open items inside the horizon plus those beyond it: equal to all open items. */
  insideInMinor: number;
  insideOutMinor: number;
  totalOpenInMinor: number;
  totalOpenOutMinor: number;
  receivableLagDays: number | null;
  payableLagDays: number | null;
  lagSampleSize: { receivable: number; payable: number };
  templatesBehind: number;
  foreignCurrencyTemplates: number;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 16" from an ISO date. */
export function monthDay(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}`;
}

/**
 * The median number of days late, weighted by nothing: one document, one vote.
 * A median rather than a mean because a single ancient invoice paid a year late
 * would otherwise move the whole forecast.
 *
 * Early payments count as negative lag and are kept — a business paid early is
 * entitled to see that in its forecast.
 */
export function medianLagDays(samples: readonly SettlementLagSample[]): number | null {
  if (samples.length === 0) return null;
  const lags = samples
    .map((sample) => daysBetween(sample.dueDate, sample.settledOn))
    .sort((a, b) => a - b);
  const middle = Math.floor(lags.length / 2);
  return lags.length % 2 === 1 ? lags[middle] : Math.round((lags[middle - 1] + lags[middle]) / 2);
}

/** A name cut to the limit, with an ellipsis inside it. */
export function cutName(name: string, limit = RECURRING_NAME_LIMIT): string {
  return name.length <= limit ? name : `${name.slice(0, limit - 1).trimEnd()}…`;
}

/** Guards a template whose next run date is years back from looping for long. */
const MAX_STEPS = 5000;

function payloadDueDays(payload: Record<string, unknown>): number {
  const days = Number(payload.due_days);
  return Number.isFinite(days) && days >= 0 ? Math.trunc(days) : 30;
}

/**
 * The cash movements active recurring templates will cause between today and
 * the horizon's last day.
 *
 * Occurrences run from `next_run_date` forward, by frequency and interval, up
 * to `end_date`. A run date before today is not counted, which is also why a
 * run that already happened is never counted twice: its document, once issued,
 * is an open item. A template whose `next_run_date` has passed is "behind",
 * and is counted so a missing payment is not silent.
 *
 * Amounts are in the base currency. A template's payload has no currency of its
 * own (generation always issues in the base currency), but if one names a
 * different currency its occurrences are left out and counted rather than
 * added at the wrong value.
 */
export function expandRecurring(input: {
  templates: readonly RecurringTemplateInput[];
  today: string;
  horizonEnd: string;
  bankAccountIds: ReadonlySet<string>;
  baseCurrency: string;
}): RecurringExpansion {
  const occurrences: RecurringOccurrence[] = [];
  let behindCount = 0;
  let foreignCurrencyCount = 0;

  for (const template of input.templates) {
    if (template.status !== "active") continue;
    if (template.nextRunDate < input.today) behindCount += 1;

    const currency = template.payload.currency_code;
    if (typeof currency === "string" && currency !== "" && currency !== input.baseCurrency) {
      foreignCurrencyCount += 1;
      continue;
    }

    let run = template.nextRunDate;
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (run > input.horizonEnd) break;
      if (template.endDate && run > template.endDate) break;
      if (run >= input.today) {
        const movement = occurrenceFor(template, run, input.bankAccountIds);
        if (movement && movement.date >= input.today && movement.date <= input.horizonEnd) {
          occurrences.push(movement);
        }
      }
      const next = nextRecurringDate(run, template.startDate, template.frequency, template.intervalCount);
      if (next <= run) break;
      run = next;
    }
  }

  occurrences.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return { occurrences, behindCount, foreignCurrencyCount };
}

function occurrenceFor(
  template: RecurringTemplateInput,
  run: string,
  bankAccountIds: ReadonlySet<string>,
): RecurringOccurrence | null {
  const make = (date: string, amountMinor: number): RecurringOccurrence | null =>
    amountMinor === 0 ? null : { templateId: template.id, name: template.name, date, amountMinor };

  switch (template.documentType) {
    case "invoice":
      return make(addDays(run, payloadDueDays(template.payload)), template.totalMinor);
    case "bill":
      return make(addDays(run, payloadDueDays(template.payload)), -template.totalMinor);
    case "expense": {
      // Paid by card, the cash leaves when the card is paid, not now.
      const paidFrom = template.payload.payment_account_id;
      return typeof paidFrom === "string" && bankAccountIds.has(paidFrom)
        ? make(run, -template.totalMinor)
        : null;
    }
    case "journal": {
      const lines = Array.isArray(template.payload.lines) ? (template.payload.lines as Record<string, unknown>[]) : [];
      const net = lines.reduce((sum, line) => {
        if (typeof line.account_id !== "string" || !bankAccountIds.has(line.account_id)) return sum;
        return sum + (Number(line.debit_minor) || 0) - (Number(line.credit_minor) || 0);
      }, 0);
      return make(run, net);
    }
  }
}

/**
 * Build the forecast.
 *
 * An open item already past due lands in the first week, in either mode: the
 * money has not arrived, so the only honest place for it is "now". Otherwise it
 * falls on its due date, or — in "usual" mode — on its due date moved by the
 * median days late learned from settled documents of the same side. An item
 * beyond the last week is summed apart rather than crammed into it.
 */
export function buildCashForecast(input: {
  today: string;
  mode: ForecastMode;
  openingMinor: number;
  openItems: readonly OpenItem[];
  lagSamples?: readonly SettlementLagSample[];
  recurring?: RecurringExpansion;
  weeks?: number;
}): CashForecast {
  const { today, mode } = input;
  const count = Math.max(1, input.weeks ?? FORECAST_WEEKS);
  const samples = input.lagSamples ?? [];
  const receivableLagDays = medianLagDays(samples.filter((s) => s.side === "receivable"));
  const payableLagDays = medianLagDays(samples.filter((s) => s.side === "payable"));
  const recurring = input.recurring ?? { occurrences: [], behindCount: 0, foreignCurrencyCount: 0 };

  const weeks: ForecastWeek[] = Array.from({ length: count }, (_, index) => {
    const start = addDays(today, index * 7);
    return {
      index,
      label: index === 0 ? "This week" : `w/c ${monthDay(start)}`,
      start,
      end: addDays(start, 6),
      fromCustomersMinor: 0,
      toSuppliersMinor: 0,
      recurringMinor: 0,
      recurringInMinor: 0,
      recurringOutMinor: 0,
      recurringNames: [],
      netMinor: 0,
      closingMinor: 0,
    };
  });
  const horizonEnd = weeks[count - 1].end;

  /** The week a day falls in; a day before today belongs to the first. */
  const weekOf = (date: string): number | null => {
    if (date > horizonEnd) return null;
    if (date <= today) return 0;
    return Math.floor(daysBetween(today, date) / 7);
  };

  let overdueIn = 0;
  let overdueOut = 0;
  let beyondIn = 0;
  let beyondOut = 0;
  let insideIn = 0;
  let insideOut = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (const item of input.openItems) {
    const isIn = item.side === "receivable";
    if (isIn) totalIn += item.balanceMinor;
    else totalOut += item.balanceMinor;

    const overdue = item.dueDate < today;
    if (overdue) {
      if (isIn) overdueIn += item.balanceMinor;
      else overdueOut += item.balanceMinor;
    }

    let index: number | null;
    if (overdue) {
      index = 0;
    } else {
      const lag = mode === "usual" ? ((isIn ? receivableLagDays : payableLagDays) ?? 0) : 0;
      index = weekOf(addDays(item.dueDate, lag));
    }

    if (index === null) {
      if (isIn) beyondIn += item.balanceMinor;
      else beyondOut += item.balanceMinor;
      continue;
    }
    if (isIn) {
      weeks[index].fromCustomersMinor += item.balanceMinor;
      insideIn += item.balanceMinor;
    } else {
      weeks[index].toSuppliersMinor += item.balanceMinor;
      insideOut += item.balanceMinor;
    }
  }

  for (const occurrence of recurring.occurrences) {
    const index = weekOf(occurrence.date);
    if (index === null) continue;
    const week = weeks[index];
    if (occurrence.amountMinor > 0) week.recurringInMinor += occurrence.amountMinor;
    else week.recurringOutMinor += -occurrence.amountMinor;
    if (!week.recurringNames.includes(occurrence.name)) week.recurringNames.push(occurrence.name);
  }

  let running = input.openingMinor;
  let dueIn = 0;
  let dueOut = 0;
  for (const week of weeks) {
    week.recurringMinor = week.recurringInMinor - week.recurringOutMinor;
    week.netMinor = week.fromCustomersMinor - week.toSuppliersMinor + week.recurringMinor;
    running += week.netMinor;
    week.closingMinor = running;
    dueIn += week.fromCustomersMinor + week.recurringInMinor;
    dueOut += week.toSuppliersMinor + week.recurringOutMinor;
  }

  const low = weeks.reduce((worst, week) => (week.closingMinor < worst.closingMinor ? week : worst), weeks[0]);
  const firstNegative = weeks.find((week) => week.closingMinor < 0);

  return {
    today,
    mode,
    openingMinor: input.openingMinor,
    weeks,
    dueInMinor: dueIn,
    dueOutMinor: dueOut,
    closingMinor: running,
    lowest: low.closingMinor < input.openingMinor ? { label: low.label, start: low.start, minor: low.closingMinor } : null,
    firstBelowZero: firstNegative ? { start: firstNegative.start, minor: firstNegative.closingMinor } : null,
    overdueInMinor: overdueIn,
    overdueOutMinor: overdueOut,
    beyondHorizonInMinor: beyondIn,
    beyondHorizonOutMinor: beyondOut,
    insideInMinor: insideIn,
    insideOutMinor: insideOut,
    totalOpenInMinor: totalIn,
    totalOpenOutMinor: totalOut,
    receivableLagDays,
    payableLagDays,
    lagSampleSize: {
      receivable: samples.filter((s) => s.side === "receivable").length,
      payable: samples.filter((s) => s.side === "payable").length,
    },
    templatesBehind: recurring.behindCount,
    foreignCurrencyTemplates: recurring.foreignCurrencyCount,
  };
}

/** One sentence on how "As they usually pay" was arrived at. */
export function describeForecastBasis(forecast: CashForecast): string {
  const parts: string[] = [];
  if (forecast.receivableLagDays === null) {
    parts.push("no settled invoice to learn a collection lag from, so receipts stay on their due dates");
  } else {
    parts.push(
      `customers settle a median ${Math.abs(forecast.receivableLagDays)} day${Math.abs(forecast.receivableLagDays) === 1 ? "" : "s"} ` +
        `${forecast.receivableLagDays < 0 ? "early" : "late"} (${forecast.lagSampleSize.receivable} paid invoices)`,
    );
  }
  if (forecast.payableLagDays !== null) {
    parts.push(
      `bills are paid a median ${Math.abs(forecast.payableLagDays)} day${Math.abs(forecast.payableLagDays) === 1 ? "" : "s"} ` +
        `${forecast.payableLagDays < 0 ? "early" : "late"} (${forecast.lagSampleSize.payable} paid bills)`,
    );
  }
  return `As they usually pay: ${parts.join("; ")}, learned from the last 365 days.`;
}

/** The week-by-week figures as the cash chart plots them. */
export function chartPoints(forecast: CashForecast): { label: string; inMinor: number; outMinor: number; closingMinor: number }[] {
  return forecast.weeks.map((week) => ({
    label: week.index === 0 ? "Now" : monthDay(week.start),
    inMinor: week.fromCustomersMinor + week.recurringInMinor,
    outMinor: week.toSuppliersMinor + week.recurringOutMinor,
    closingMinor: week.closingMinor,
  }));
}
```

- [ ] **Step 4: Replace the whole of `ctyhp-accounting/lib/services/forecast.ts`** (most of it changes) with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDays,
  buildCashForecast,
  expandRecurring,
  FORECAST_WEEKS,
  type CashForecast,
  type CashSide,
  type OpenItem,
  type RecurringExpansion,
  type RecurringTemplateInput,
  type SettlementLagSample,
} from "@/lib/domain/forecast";
import { readAllPages } from "./paging";
import { getLedgerBalances } from "./reports";

export class ForecastError extends Error {}

/** How far back the collection behaviour is learned from. */
export const FORECAST_HISTORY_DAYS = 365;

export interface CashForecastData {
  today: string;
  /** Cash in the `bank` accounts today, base currency minor units. */
  openingMinor: number;
  /** By due date, and as they usually pay. Same inputs, one switch apart. */
  due: CashForecast;
  usual: CashForecast;
  /** Every open invoice and bill, for the drill-down under the table. */
  openItems: OpenItem[];
  recurring: RecurringExpansion;
}

const fail = (message: string) => new ForecastError(message);

function openItemFromRow(row: Record<string, unknown>): OpenItem {
  return {
    side: row.side as CashSide,
    documentId: row.document_id as string,
    documentNumber: (row.document_number as string | null) ?? null,
    partyName: (row.party_name as string | null) ?? "—",
    dueDate: String(row.due_date).slice(0, 10),
    balanceMinor: Number(row.balance_minor),
  };
}

/**
 * Every open invoice and bill on a day, past PostgREST's thousand-row cap.
 * Paged in (side, document_id) order, which is total: a document id is unique
 * within its side, so no row can straddle a page boundary and shift.
 */
export async function listOpenItems(sb: SupabaseClient, asOf: string): Promise<OpenItem[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb.rpc("acc_open_items", { p_as_of: asOf }).order("side").order("document_id").range(from, to),
    fail,
  );
  return rows.map(openItemFromRow);
}

async function listLagSamples(sb: SupabaseClient, asOf: string): Promise<SettlementLagSample[]> {
  const since = addDays(asOf, -FORECAST_HISTORY_DAYS);
  const rows = await readAllPages<Record<string, unknown>>(
    // The RPC has no id, so order by every column. Rows tied on all four are
    // identical, so a reorder among them across a page boundary changes nothing.
    (from, to) =>
      sb
        .rpc("acc_settlement_lag", { p_since: since })
        .order("side")
        .order("due_date")
        .order("settled_on")
        .order("amount_minor")
        .range(from, to),
    fail,
  );
  return rows.map((row) => ({
    side: row.side as CashSide,
    dueDate: String(row.due_date).slice(0, 10),
    settledOn: String(row.settled_on).slice(0, 10),
    amountMinor: Number(row.amount_minor),
  }));
}

/** The ids of every `bank` account: the cash the forecast starts from. */
async function listBankAccountIds(sb: SupabaseClient): Promise<Set<string>> {
  const rows = await readAllPages<{ id: string }>(
    (from, to) => sb.from("acc_account").select("id").eq("account_type", "bank").order("id").range(from, to),
    fail,
  );
  return new Set(rows.map((row) => row.id));
}

export async function listActiveRecurringTemplates(sb: SupabaseClient): Promise<RecurringTemplateInput[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_recurring_template")
        .select("id,name,document_type,frequency,interval_count,start_date,next_run_date,end_date,payload,total_minor,status")
        .eq("status", "active")
        .order("next_run_date")
        .order("name")
        .order("id")
        .range(from, to),
    fail,
  );
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    documentType: row.document_type as RecurringTemplateInput["documentType"],
    frequency: row.frequency as RecurringTemplateInput["frequency"],
    intervalCount: Number(row.interval_count) || 1,
    startDate: String(row.start_date).slice(0, 10),
    nextRunDate: String(row.next_run_date).slice(0, 10),
    endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
    status: row.status as RecurringTemplateInput["status"],
    totalMinor: Number(row.total_minor) || 0,
    payload: (row.payload as Record<string, unknown> | null) ?? {},
  }));
}

/**
 * The 13 Week Cash Forecast: cash in the bank accounts today, the open invoices
 * and bills, how late similar documents were settled, and the active recurring
 * templates. All reads; the arithmetic is in `lib/domain/forecast.ts`.
 */
export async function getCashForecast(
  sb: SupabaseClient,
  options: { today: string; baseCurrency: string; weeks?: number },
): Promise<CashForecastData> {
  const { today, baseCurrency } = options;
  const weeks = options.weeks ?? FORECAST_WEEKS;
  const [balances, bankIds, openItems, lagSamples, templates] = await Promise.all([
    getLedgerBalances(sb, null, today),
    listBankAccountIds(sb),
    listOpenItems(sb, today),
    listLagSamples(sb, today),
    listActiveRecurringTemplates(sb),
  ]);

  const openingMinor = balances
    .filter((row) => row.accountType === "bank")
    .reduce((sum, row) => sum + row.debitBase - row.creditBase, 0);
  const horizonEnd = addDays(today, weeks * 7 - 1);
  const recurring = expandRecurring({ templates, today, horizonEnd, bankAccountIds: bankIds, baseCurrency });

  const build = (mode: "due" | "usual") =>
    buildCashForecast({ today, mode, openingMinor, openItems, lagSamples, recurring, weeks });
  return { today, openingMinor, due: build("due"), usual: build("usual"), openItems, recurring };
}
```

- [ ] **Step 5: Create `ctyhp-accounting/components/reports/cash-forecast.module.css`** with exactly this content:

```css
/* A week whose cash ends below zero, set apart without relying on colour alone: the figure is also written in the negative colour. */
.warnRow td {
  background: var(--ob-feedback-warningBg);
}

.names {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--ob-text-secondary);
  white-space: normal;
}

.weekRange {
  display: block;
  font-size: 11.5px;
  color: var(--ob-text-secondary);
}

.chart {
  width: 100%;
  height: auto;
  display: block;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 18px 0 6px;
  font-size: 12px;
  color: var(--ob-text-secondary);
}

.legendItem {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.line {
  width: 16px;
  height: 3px;
  border-radius: 2px;
}

.axis {
  font-size: 11px;
  fill: var(--ob-text-secondary);
}

.note {
  margin: 14px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--ob-border-muted);
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--ob-text-body);
}

@media print {
  .warnRow td {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
```

- [ ] **Step 6: Create `ctyhp-accounting/components/reports/ForecastChart.tsx`** with exactly this content:

```tsx
"use client";

import { TOKENS } from "@/lib/design/tokens";
import { axisTicks } from "@/lib/domain/chart-axis";
import type { CashForecast } from "@/lib/domain/forecast";
import { chartPoints } from "@/lib/domain/forecast";
import styles from "./cash-forecast.module.css";

/**
 * Cash at the end of each week as a line, with the money in and out of that
 * week as bars beneath it. A table of the same figures sits beside it for
 * readers who do not use the picture.
 */
export default function ForecastChart({
  forecast,
  formatCompact,
  formatMoney,
}: {
  forecast: CashForecast;
  formatCompact: (minor: number) => string;
  formatMoney: (minor: number) => string;
}) {
  const points = chartPoints(forecast);
  const width = 720;
  const height = 280;
  const plot = { left: 64, right: 18, top: 18, bottom: 40 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const values = points.flatMap((p) => [p.inMinor, p.outMinor, p.closingMinor, forecast.openingMinor]);
  const domainMin = Math.min(0, ...values);
  const domainMax = Math.max(1, ...values);
  const span = Math.max(1, domainMax - domainMin);
  const y = (value: number) => plot.top + ((domainMax - value) / span) * plotHeight;
  const group = plotWidth / points.length;
  const barWidth = Math.min(16, group * 0.3);
  const center = (index: number) => plot.left + group * index + group / 2;
  const line = points.map((p, index) => `${center(index)},${y(p.closingMinor)}`).join(" ");

  return (
    <div>
      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendItem}>
          <span className={styles.line} style={{ backgroundColor: TOKENS.series.net }} />
          Cash at week end
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ backgroundColor: TOKENS.series.income }} />
          Money in
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ backgroundColor: TOKENS.series.expense }} />
          Money out
        </span>
      </div>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Cash at the end of each of the next thirteen weeks, with money in and money out per week"
      >
        {axisTicks(domainMax, span).map((tick, i) => (
          <g key={i}>
            <line x1={plot.left} x2={width - plot.right} y1={y(tick)} y2={y(tick)} stroke={TOKENS.series.grid} strokeDasharray="4 4" />
            <text x={plot.left - 10} y={y(tick) + 4} textAnchor="end" className={styles.axis}>
              {formatCompact(tick)}
            </text>
          </g>
        ))}
        <line x1={plot.left} x2={width - plot.right} y1={y(0)} y2={y(0)} stroke={TOKENS.series.axis} />
        {points.map((p, index) => (
          <g key={index}>
            <rect
              x={center(index) - barWidth - 1}
              y={Math.min(y(p.inMinor), y(0))}
              width={barWidth}
              height={Math.max(1, Math.abs(y(0) - y(p.inMinor)))}
              rx={3}
              fill={TOKENS.series.income}
            >
              <title>{`${p.label} money in: ${formatMoney(p.inMinor)}`}</title>
            </rect>
            <rect
              x={center(index) + 1}
              y={Math.min(y(p.outMinor), y(0))}
              width={barWidth}
              height={Math.max(1, Math.abs(y(0) - y(p.outMinor)))}
              rx={3}
              fill={TOKENS.series.expense}
            >
              <title>{`${p.label} money out: ${formatMoney(p.outMinor)}`}</title>
            </rect>
            <text x={center(index)} y={height - 14} textAnchor="middle" className={styles.axis}>
              {p.label}
            </text>
          </g>
        ))}
        <polyline points={line} fill="none" stroke={TOKENS.series.net} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, index) => (
          <circle key={index} cx={center(index)} cy={y(p.closingMinor)} r={4} fill={TOKENS.text.onDark} stroke={TOKENS.series.net} strokeWidth={3}>
            <title>{`${p.label} cash at week end: ${formatMoney(p.closingMinor)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
```

- [ ] **Step 7: Create `ctyhp-accounting/components/reports/CashForecastReport.tsx`** with exactly this content:

```tsx
"use client";

import { useCallback, useState } from "react";
import { Segmented, Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import ForecastChart from "@/components/reports/ForecastChart";
import { ReportFoot, StatRow, reportPaperStyles as paper } from "@/components/reports/ReportPaper";
import SimpleReport, { reportPagination } from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { cutName, describeForecastBasis, monthDay, type CashForecast, type ForecastMode, type OpenItem } from "@/lib/domain/forecast";
import { fromMinor } from "@/lib/domain/money";
import { longDate, shortDate } from "@/lib/domain/report-presets";
import type { ReportExportSheet } from "@/lib/domain/report-export";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { outstandingAge } from "@/lib/domain/settlement";
import { formatMoney } from "@/lib/format";
import type { CashForecastData } from "@/lib/services/forecast";
import styles from "./cash-forecast.module.css";

const PAGE_SIZE = 50;

const MODE_OPTIONS: { label: string; value: ForecastMode }[] = [
  { label: "By due date", value: "due" },
  { label: "As they usually pay", value: "usual" },
];

/** The sum of a week column across the thirteen weeks. */
function total(forecast: CashForecast, pick: (week: CashForecast["weeks"][number]) => number): number {
  return forecast.weeks.reduce((sum, week) => sum + pick(week), 0);
}

/**
 * The 13 Week Cash Forecast: cash in the bank today, then what is already
 * committed — issued invoices, received bills and recurring templates — laid
 * onto thirteen weeks. "By due date" is the default; "As they usually pay"
 * moves only the customer and supplier columns.
 */
export default function CashForecastReport({
  companyName,
  currencyCode,
  decimals,
  today,
  load,
}: {
  companyName: string;
  currencyCode: string;
  decimals: number;
  today: string;
  load: (when: ReportWhen) => Promise<ReportRunResult<CashForecastData>>;
}) {
  const [mode, setMode] = useState<ForecastMode>("due");
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const compact = useCallback(
    (minor: number) =>
      new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(fromMinor(minor, decimals)),
    [decimals],
  );

  const sheet = useCallback(
    (data: CashForecastData): ReportExportSheet => {
      const forecast = mode === "due" ? data.due : data.usual;
      const amount = (minor: number) => fromMinor(minor, decimals);
      return {
        fileName: `13-week-cash-forecast-${forecast.today}`,
        companyName,
        title: "13 Week Cash Forecast",
        subtitle: `From ${forecast.today} · ${mode === "due" ? "By due date" : "As they usually pay"}`,
        currencyCode,
        columns: [
          { key: "week", header: "Week", kind: "text", width: 14 },
          { key: "range", header: "Dates", kind: "text", width: 24 },
          { key: "customers", header: "From customers", kind: "money", width: 16 },
          { key: "suppliers", header: "To suppliers", kind: "money", width: 16 },
          { key: "recurring", header: "Recurring", kind: "money", width: 16 },
          { key: "names", header: "Recurring templates", kind: "text", width: 40 },
          { key: "net", header: "Net", kind: "money", width: 16 },
          { key: "closing", header: "Cash at week end", kind: "money", width: 18 },
        ],
        rows: [
          ...forecast.weeks.map((week) => ({
            week: week.label,
            range: `${week.start} to ${week.end}`,
            customers: amount(week.fromCustomersMinor),
            suppliers: amount(week.toSuppliersMinor),
            recurring: amount(week.recurringMinor),
            names: week.recurringNames.map((n) => cutName(n)).join("; "),
            net: amount(week.netMinor),
            closing: amount(week.closingMinor),
          })),
          {
            week: "Over 13 weeks",
            range: "",
            customers: amount(total(forecast, (w) => w.fromCustomersMinor)),
            suppliers: amount(total(forecast, (w) => w.toSuppliersMinor)),
            recurring: amount(total(forecast, (w) => w.recurringMinor)),
            names: "",
            net: amount(total(forecast, (w) => w.netMinor)),
            closing: amount(forecast.closingMinor),
          },
        ],
      };
    },
    [mode, companyName, currencyCode, decimals],
  );

  return (
    <SimpleReport<CashForecastData>
      companyName={companyName}
      title="13 Week Cash Forecast"
      currencyCode={currencyCode}
      period={{ kind: "none", today, caption: `The thirteen weeks from ${longDate(today)}` }}
      load={load}
      sheet={sheet}
      runningText="Reading cash, open invoices and bills, and recurring templates…"
      filters={
        <Segmented<ForecastMode>
          aria-label="When open invoices and bills are expected to be settled"
          value={mode}
          onChange={setMode}
          options={MODE_OPTIONS}
        />
      }
      render={(data, _when, { printing }) => {
        const forecast = mode === "due" ? data.due : data.usual;
        const overdue = forecast.overdueInMinor > 0 || forecast.overdueOutMinor > 0;
        const below = forecast.closingMinor < 0;
        const grand = {
          customers: total(forecast, (w) => w.fromCustomersMinor),
          suppliers: total(forecast, (w) => w.toSuppliersMinor),
          recurring: total(forecast, (w) => w.recurringMinor),
          net: total(forecast, (w) => w.netMinor),
        };
        return (
          <>
            <StatRow
              items={[
                { label: "Cash today", value: money(forecast.openingMinor) },
                { label: "Due in", value: money(forecast.dueInMinor) },
                { label: "Due out", value: money(forecast.dueOutMinor) },
                { label: "In 13 weeks", value: money(forecast.closingMinor), danger: below },
                ...(forecast.lowest
                  ? [{ label: "Lowest point", value: `${money(forecast.lowest.minor)} · ${forecast.lowest.label}`, danger: forecast.lowest.minor < 0 }]
                  : []),
              ]}
            />

            {overdue ? (
              <div className={styles.note} role="note">
                <strong>Already past due and counted in week one:</strong> {money(forecast.overdueInMinor)} receivable and{" "}
                {money(forecast.overdueOutMinor)} payable. That makes week one the optimistic case.
              </div>
            ) : null}

            <ForecastChart forecast={forecast} formatCompact={compact} formatMoney={money} />

            <div className={paper.rptScroll}>
              <table className={paper.rpt} aria-label="Cash by week">
                <thead>
                  <tr>
                    <th className={paper.l}>Week</th>
                    <th>From customers</th>
                    <th>To suppliers</th>
                    <th style={{ minWidth: 150 }}>Recurring</th>
                    <th>Net</th>
                    <th>Cash at week end</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.weeks.map((week) => (
                    <tr key={week.index} className={week.closingMinor < 0 ? styles.warnRow : undefined}>
                      <td>
                        <strong>{week.label}</strong>
                        <span className={styles.weekRange}>
                          {monthDay(week.start)} – {monthDay(week.end)}
                        </span>
                      </td>
                      <td className={paper.r}>{money(week.fromCustomersMinor)}</td>
                      <td className={paper.r}>{money(week.toSuppliersMinor)}</td>
                      <td className={paper.r}>
                        {money(week.recurringMinor)}
                        {week.recurringNames.length > 0 ? (
                          <span className={styles.names}>{week.recurringNames.map((n) => cutName(n)).join(", ")}</span>
                        ) : null}
                      </td>
                      <td className={`${paper.r}${week.netMinor < 0 ? ` ${paper.negative}` : ""}`}>{money(week.netMinor)}</td>
                      <td className={`${paper.r}${week.closingMinor < 0 ? ` ${paper.negative}` : ""}`}>
                        <strong>{money(week.closingMinor)}</strong>
                      </td>
                    </tr>
                  ))}
                  <tr className={paper.rGrand}>
                    <td>Over 13 weeks</td>
                    <td className={paper.r}>{money(grand.customers)}</td>
                    <td className={paper.r}>{money(grand.suppliers)}</td>
                    <td className={paper.r}>{money(grand.recurring)}</td>
                    <td className={paper.r}>{money(grand.net)}</td>
                    <td className={paper.r}>{money(forecast.closingMinor)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {forecast.beyondHorizonInMinor > 0 || forecast.beyondHorizonOutMinor > 0 ? (
              <p className={paper.muted} style={{ marginTop: 10 }}>
                Beyond the thirteen weeks and not counted: {money(forecast.beyondHorizonInMinor)} from customers and{" "}
                {money(forecast.beyondHorizonOutMinor)} to suppliers.
              </p>
            ) : null}

            {forecast.templatesBehind > 0 ? (
              <p className={paper.muted} style={{ marginTop: 10 }}>
                {forecast.templatesBehind} recurring {forecast.templatesBehind === 1 ? "template is" : "templates are"} behind schedule: the
                next run date has passed, so the runs that were missed are not counted here.
              </p>
            ) : null}

            {forecast.foreignCurrencyTemplates > 0 ? (
              <p className={paper.muted} style={{ marginTop: 10 }}>
                {forecast.foreignCurrencyTemplates} recurring {forecast.foreignCurrencyTemplates === 1 ? "template names" : "templates name"} a
                currency other than {currencyCode} and {forecast.foreignCurrencyTemplates === 1 ? "is" : "are"} left out.
              </p>
            ) : null}

            {mode === "usual" ? <p className={paper.muted} style={{ marginTop: 10 }}>{describeForecastBasis(forecast)}</p> : null}

            <ReportFoot>
              <strong>Only what is already committed:</strong> issued invoices, received bills and recurring templates. Nothing is
              guessed about sales not yet made.{" "}
              {forecast.firstBelowZero ? (
                <>
                  Cash goes below zero in the week beginning {longDate(forecast.firstBelowZero.start)}, at {money(forecast.firstBelowZero.minor)}.
                </>
              ) : (
                <>Cash stays positive throughout.</>
              )}
            </ReportFoot>

            <h3 style={{ margin: "28px 0 8px", fontSize: 14 }}>Open items behind the forecast</h3>
            <DataTable<OpenItem>
              rowKey={(row) => `${row.side}:${row.documentId}`}
              dataSource={data.openItems}
              pagination={reportPagination(printing, pageSize, setPageSize, PAGE_SIZE)}
              emptyTitle="Nothing is open"
              emptyDescription="No invoice or bill is waiting to be settled."
              columns={[
                {
                  title: "Side",
                  dataIndex: "side",
                  width: COLUMN.STATUS + 16,
                  render: (side: string) => (
                    <Tag color={side === "receivable" ? "green" : "volcano"}>{side === "receivable" ? "Receivable" : "Payable"}</Tag>
                  ),
                },
                { title: "Num", dataIndex: "documentNumber", width: COLUMN.CODE, render: (n: string | null) => <span className={paper.mono}>{n ?? "—"}</span> },
                flexColumn<OpenItem>({ title: "Customer / vendor", dataIndex: "partyName" }),
                { title: "Due", dataIndex: "dueDate", width: COLUMN.DATE + 20, render: (d: string) => shortDate(d) },
                {
                  title: "Status",
                  key: "age",
                  width: COLUMN.STATUS + 16,
                  render: (_: unknown, row: OpenItem) => {
                    const age = outstandingAge({ issueDate: row.dueDate, dueDate: row.dueDate, asOf: data.today });
                    return age.isOverdue ? <span className={paper.negative}>{age.overdueDays} d overdue</span> : <span className={paper.muted}>Not yet due</span>;
                  },
                },
                {
                  title: "Balance",
                  dataIndex: "balanceMinor",
                  width: COLUMN.MONEY_WIDE,
                  align: "right",
                  render: (minor: number) => money(minor),
                },
              ]}
            />
          </>
        );
      }}
    />
  );
}
```

- [ ] **Step 8: Create `ctyhp-accounting/app/(app)/reports/cash-flow-forecast/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getCashForecast, type CashForecastData } from "@/lib/services/forecast";
import { reportPageContext } from "@/lib/services/report-context";

/**
 * 13 Week Cash Forecast: read-only. A forecast always starts today, in the
 * company's own time zone, so the dates the page sends are checked and ignored.
 */
export async function cashForecastAction(when: ReportWhen): Promise<ReportRunResult<CashForecastData>> {
  try {
    checkWhen(when, "none");
    const sb = await createSupabaseServerClient();
    const ctx = await reportPageContext(sb);
    return { ok: true, data: await getCashForecast(sb, { today: ctx.today, baseCurrency: ctx.currencyCode }) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 9: Replace the whole of `ctyhp-accounting/app/(app)/reports/cash-flow-forecast/page.tsx`** (most of it changes) with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import CashForecastReport from "@/components/reports/CashForecastReport";
import { reportPageContext } from "@/lib/services/report-context";
import { cashForecastAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CashFlowForecastPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="13 Week Cash Forecast"
        description="Receipts and payments expected over the next thirteen weeks."
      />
      <CashForecastReport
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        today={ctx.today}
        load={cashForecastAction}
      />
    </div>
  );
}
```

- [ ] **Step 10: Edit `ctyhp-accounting/tests/unit/table-adoption.test.ts`** — apply these 1 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 1 — find:

```ts
  "app/(app)/reports/1099/Report1099Client.tsx",
  "app/(app)/reports/cash-flow-forecast/CashFlowForecastClient.tsx",
  "app/(app)/reports/gl-posting/GlPostingClient.tsx",
```

replace with:

```ts
  "app/(app)/reports/1099/Report1099Client.tsx",
  "app/(app)/reports/gl-posting/GlPostingClient.tsx",
```

- [ ] **Step 11: Edit `ctyhp-accounting/tests/e2e/settlement-history.e2e.ts`** — apply these 3 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 3 — find:

```ts
import { listInvoiceSettlements } from "@/lib/services/settlements";
import { getCashFlowForecast } from "@/lib/services/forecast";
import { buildSettlementHistory } from "@/lib/domain/settlement";
```

replace with:

```ts
import { listInvoiceSettlements } from "@/lib/services/settlements";
import { getCashForecast } from "@/lib/services/forecast";
import { buildSettlementHistory } from "@/lib/domain/settlement";
```

Edit 2 of 3 — find:

```ts
      // The forecast reads the same open balance, on the invoice's due date.
      const forecast = await getCashFlowForecast(sb, { asOf: today, weeks: 13 });
      const projectedIn = forecast.buckets.reduce((sum, b) => sum + b.expectedInMinor, 0);
      expect(
```

replace with:

```ts
      // The forecast reads the same open balance, on the invoice's due date.
      const { due: forecast } = await getCashForecast(sb, { today, baseCurrency: "USD" });
      expect(
```

Edit 3 of 3 — find:

```ts
      expect(
        projectedIn + forecast.beyondHorizonInMinor,
        "every open receivable belongs somewhere in the projection",
```

replace with:

```ts
      expect(
        forecast.insideInMinor + forecast.beyondHorizonInMinor,
        "every open receivable belongs somewhere in the projection",
```

- [ ] **Step 12: Delete `ctyhp-accounting/app/(app)/reports/cash-flow-forecast/CashFlowForecastClient.tsx`**

```bash
git rm "ctyhp-accounting/app/(app)/reports/cash-flow-forecast/CashFlowForecastClient.tsx"
```

Its content now lives in the files above; nothing imports it any more.

- [ ] **Step 13: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/forecast.test.ts" "lib/domain/forecast.ts" "lib/services/forecast.ts" "components/reports/ForecastChart.tsx" "components/reports/CashForecastReport.tsx" "app/(app)/reports/cash-flow-forecast/actions.ts" "app/(app)/reports/cash-flow-forecast/page.tsx" "tests/unit/table-adoption.test.ts" "tests/e2e/settlement-history.e2e.ts"
npx vitest run tests/unit/forecast.test.ts tests/unit/table-adoption.test.ts tests/unit/rsc-antd.test.ts tests/unit/report-frame-contract.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; forecast + table-adoption: 37 tests passing; rsc-antd and report-frame-contract pass.

- [ ] **Step 14: Commit**

```bash
git add "ctyhp-accounting/tests/unit/forecast.test.ts" "ctyhp-accounting/lib/domain/forecast.ts" "ctyhp-accounting/lib/services/forecast.ts" "ctyhp-accounting/components/reports/cash-forecast.module.css" "ctyhp-accounting/components/reports/ForecastChart.tsx" "ctyhp-accounting/components/reports/CashForecastReport.tsx" "ctyhp-accounting/app/(app)/reports/cash-flow-forecast/actions.ts" "ctyhp-accounting/app/(app)/reports/cash-flow-forecast/page.tsx" "ctyhp-accounting/tests/unit/table-adoption.test.ts" "ctyhp-accounting/tests/e2e/settlement-history.e2e.ts"
git commit -m "feat(reports): the 13 Week Cash Forecast starts from cash on hand and counts recurring templates"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 5: Budget vs Actual — % of Budget, month by month, and the full-year grid

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/budget-grid.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/reports.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/statement.test.ts`
- Create: `ctyhp-accounting/lib/domain/budget-grid.ts`
- Modify: `ctyhp-accounting/lib/domain/reports.ts`
- Modify: `ctyhp-accounting/lib/domain/statement.ts`
- Modify: `ctyhp-accounting/lib/services/budgets.ts`
- Modify: `ctyhp-accounting/components/reports/StatementTable.tsx`
- Create: `ctyhp-accounting/components/reports/BudgetMonthTable.tsx`
- Create: `ctyhp-accounting/components/reports/budget-grid.module.css`
- Modify: `ctyhp-accounting/components/reports/BudgetEditorDrawer.tsx`
- Modify: `ctyhp-accounting/app/(app)/reports/actions.ts`
- Modify: `ctyhp-accounting/app/(app)/reports/ReportsClient.tsx`
- Test (modify): `ctyhp-accounting/tests/live/statement-parity.live.ts`

**Interfaces:**
- Consumes: existing `acc_save_budget_month` via `saveBudgetMonthAction`, `getMonthlyLedgerBalances`, `fiscalMonths`, tables `acc_budget` / `acc_budget_line` (read directly, paged).
- Produces: `percentOfBudget`, `hasBudget`, `buildMonthByMonth`, `spreadYear`, `seedFromActuals`, `dirtyMonths`, `runBudgetSave`, `plannedSummary`, `GRID_WIDTHS` (`lib/domain/budget-grid.ts`); `BudgetMonthTable`; the grid inside `BudgetEditorDrawer` ("Manage budget", `budget.manage`).

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/budget-grid.test.ts`** with exactly this content:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
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
```

- [ ] **Step 2: Edit `ctyhp-accounting/tests/unit/reports.test.ts`** — apply these 1 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 1 — find:

```ts
      favorable: false,
    });
  });
});
```

replace with:

```ts
      favorable: false,
    });
  });

  it("marks an account with nothing budgeted, so its actual is not read as a variance", () => {
    const report = buildBudgetVsActual(actual, [
      { accountId: "income", accountCode: "4000", name: "Sales", accountType: "income", amountMinor: 100000 },
    ]);
    expect(report.lines.find((line) => line.accountId === "income")?.hasBudget).toBe(true);
    expect(report.lines.find((line) => line.accountId === "expense")?.hasBudget).toBe(false);
  });
});
```

- [ ] **Step 3: Edit `ctyhp-accounting/tests/unit/statement.test.ts`** — apply these 6 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 6 — find:

```ts
import type { AccountType } from "@/lib/domain/accounts";
import {
```

replace with:

```ts
import type { AccountType } from "@/lib/domain/accounts";
import { percentOfBudget } from "@/lib/domain/budget-grid";
import {
```

Edit 2 of 6 — find:

```ts
    acct("misc", "6400", "Miscellaneous", "expense"),
  ]);
```

replace with:

```ts
    acct("misc", "6400", "Miscellaneous", "expense"),
    acct("travel", "6500", "Travel", "expense"),
  ]);
```

Edit 3 of 6 — find:

```ts
  const bva = buildBudgetVsActual(
    [b("sales", 0, 1_000_000), b("cogs", 300_000, 0), b("rent", 150_000, 0), b("misc", 0, 0)],
    [budgetOf("sales", 900_000), budgetOf("cogs", 250_000), budgetOf("rent", 200_000), budgetOf("ads", 50_000)],
```

replace with:

```ts
  const bva = buildBudgetVsActual(
    [b("sales", 0, 1_000_000), b("cogs", 300_000, 0), b("rent", 150_000, 0), b("misc", 0, 0), b("travel", 40_000, 0)],
    [budgetOf("sales", 900_000), budgetOf("cogs", 250_000), budgetOf("rent", 200_000), budgetOf("ads", 50_000)],
```

Edit 4 of 6 — find:

```ts
    expect(s.columns.map((c) => c.label)).toEqual(["Actual", "Budget"]);
    expect(s.changeLabels).toEqual(["Variance", "%"]);
    for (const line of bva.lines.filter((l) => l.current !== 0 || l.prior !== 0)) {
      const r = s.rows.find((x) => x.kind === "account" && x.accountId === line.accountId);
```

replace with:

```ts
    expect(s.columns.map((c) => c.label)).toEqual(["Actual", "Budget"]);
    expect(s.changeLabels).toEqual(["Over / Under", "% of Budget"]);
    for (const line of bva.lines.filter((l) => (l.current !== 0 || l.prior !== 0) && l.hasBudget)) {
      const r = s.rows.find((x) => x.kind === "account" && x.accountId === line.accountId);
```

Edit 5 of 6 — find:

```ts
      expect(r?.cells.map((c) => c.amount)).toEqual([line.current, line.prior]);
      expect(r?.change).toEqual({ amount: line.variance, percent: line.variancePercent });
    }
```

replace with:

```ts
      expect(r?.cells.map((c) => c.amount)).toEqual([line.current, line.prior]);
      expect(r?.change).toEqual({ amount: line.variance, percent: percentOfBudget(line.current, line.prior) });
    }
```

Edit 6 of 6 — find:

```ts
    expect(row(s, "income:a:sales")?.cells[1].zoom).toBeNull();
  });
```

replace with:

```ts
    expect(row(s, "income:a:sales")?.cells[1].zoom).toBeNull();
  });

  it("gives % of Budget as actual over budget to one decimal place", () => {
    expect(row(s, "income:a:sales")?.change?.percent).toBe(111.1);
    expect(row(s, "opex:a:rent")?.change?.percent).toBe(75);
    expect(row(s, "opex:a:ads")?.change?.percent).toBe(0);
    expect(s.percentFixed).toBe(true);
  });

  it("shows a dash, not a variance, for an account with no budget", () => {
    const travel = row(s, "opex:a:travel");
    expect(travel?.noBudget).toBe(true);
    expect(travel?.change).toBeNull();
    expect(travel?.tone).toBeNull();
    expect(travel?.cells[0].amount).toBe(40_000); // the actual is still shown, and still opens
    expect(travel?.cells[0].zoom?.accountIds).toEqual(["travel"]);
    expect(row(s, "opex:a:rent")?.noBudget).toBeUndefined();
  });

  it("leaves the totals' own variance alone when only an account lacks a budget", () => {
    const opex = row(s, "opex:total");
    expect(opex?.noBudget).toBeUndefined();
    expect(opex?.change?.amount).toBe(190_000 - 250_000);
  });

  it("exports an unbudgeted account with a blank Budget and no variance", () => {
    const sheet = statementSheet(s, { companyName: "Test Co", currencyCode: "USD", decimals: 2, subtitle: "", fileName: "x" });
    const out = sheet.rows.find((r) => String(r.account).includes("6500"));
    expect(out).toMatchObject({ c0: 400, c1: null, change: null, changePct: null });
  });
```

- [ ] **Step 4: Run the tests to see them fail**

```bash
npx vitest run tests/unit/budget-grid.test.ts tests/unit/reports.test.ts tests/unit/statement.test.ts
```

Expected: FAIL — `lib/domain/budget-grid.ts` does not exist yet, and the updated budget expectations in reports/statement tests fail against the old code.

- [ ] **Step 5: Create `ctyhp-accounting/lib/domain/budget-grid.ts`** with exactly this content:

```ts
/**
 * Budget vs Actual, the parts that are plain arithmetic: % of Budget, the
 * month-by-month results, and everything the full-year budget grid does with
 * its numbers (spreading a year, starting from actuals, finding the months
 * that changed, saving them one at a time).
 *
 * Pure. Amounts are base-currency minor units, as OneBook stores a budget:
 * positive for income and for spending alike.
 */

import { roundHalfAwayFromZero } from "@/lib/domain/money";
import { buildProfitAndLoss, type BudgetAccountAmount, type LedgerBalance } from "@/lib/domain/reports";
import type { AccountType } from "@/lib/domain/accounts";

/* -------------------------------------------------------- % of Budget */

/** A line with no budget has nothing to be a percentage of. The save drops zero lines, so 0 is "not budgeted". */
export const hasBudget = (budgetMinor: number): boolean => budgetMinor !== 0;

/** Actual ÷ budget × 100 to one decimal place; null when there is no budget. */
export function percentOfBudget(actualMinor: number, budgetMinor: number): number | null {
  if (!hasBudget(budgetMinor)) return null;
  return Math.round((actualMinor / budgetMinor) * 1000) / 10;
}

/* ------------------------------------------------------ Month by month */

export interface MonthSlot {
  /** First day of the month, YYYY-MM-DD. */
  start: string;
  label: string;
}

export interface MonthResult extends MonthSlot {
  /** Income less expenses actually posted in the month. */
  actual: number;
  /** Income less expenses budgeted for the month. */
  budget: number;
  /** Actual less budget. */
  variance: number;
}

/** The `YYYY-MM` key `acc_monthly_ledger_balances` gives a month. */
export const monthKeyOf = (start: string): string => start.slice(0, 7);

/** The first day of every month from the one holding `from` through the one holding `to`. */
export function monthStartsBetween(from: string, to: string): string[] {
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const lastYear = Number(to.slice(0, 4));
  const lastMonth = Number(to.slice(5, 7));
  const out: string[] = [];
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    out.push(`${year}-${String(month).padStart(2, "0")}-01`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

/** "Jan 2026", the label of the month starting on `start`. */
export function monthLabelOf(start: string): string {
  return new Date(`${start}T00:00:00.000Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

const INCOME_TYPES: ReadonlySet<AccountType> = new Set<AccountType>(["income", "other_income"]);

/** Income less expenses for a set of budget lines. */
export function budgetResultOf(amounts: readonly BudgetAccountAmount[]): number {
  let result = 0;
  for (const row of amounts) result += INCOME_TYPES.has(row.accountType) ? row.amountMinor : -row.amountMinor;
  return result;
}

/**
 * One row per month: the actual result (by the one Profit and Loss rule), the
 * budgeted result, and the difference. A month with no postings or no budget is 0.
 */
export function buildMonthByMonth(
  months: readonly MonthSlot[],
  actualByMonth: ReadonlyMap<string, readonly LedgerBalance[]>,
  budgetByMonth: ReadonlyMap<string, readonly BudgetAccountAmount[]>,
): MonthResult[] {
  return months.map((month) => {
    const key = monthKeyOf(month.start);
    const actual = buildProfitAndLoss([...(actualByMonth.get(key) ?? [])]).netIncome;
    const budget = budgetResultOf(budgetByMonth.get(month.start) ?? []);
    return { ...month, actual, budget, variance: actual - budget };
  });
}

/* --------------------------------------------------------------- The grid */

/** Twelve month amounts per account id, in fiscal-month order. */
export type BudgetGridValues = Record<string, number[]>;

export const GRID_MONTHS = 12;

/**
 * Column widths of the budget grid, in px. They must fit the drawer at a
 * 1440px window with no sideways scroll: the drawer is min(1500, 96vw) =
 * 1382px, less 48px of padding and a 15px scrollbar = 1319px. A figure like
 * 1000000.00 is ten characters, about 70px at 12px tabular numerals.
 */
export const GRID_WIDTHS = {
  account: 200,
  month: 84,
  year: 96,
  /** Account + twelve months + Year. */
  total: 200 + 12 * 84 + 96,
} as const;

export interface GridAccount {
  accountId: string;
  accountCode: string;
  name: string;
  accountType: AccountType;
}

/**
 * What each Profit and Loss account actually posted in each of twelve months,
 * by the one Profit and Loss rule (the same natural, positive-for-both
 * amounts a budget is entered in). A month with no postings is 0.
 */
export function monthlyActualsByAccount(
  months: readonly MonthSlot[],
  actualByMonth: ReadonlyMap<string, readonly LedgerBalance[]>,
): BudgetGridValues {
  const out: BudgetGridValues = {};
  months.forEach((month, index) => {
    const pnl = buildProfitAndLoss([...(actualByMonth.get(monthKeyOf(month.start)) ?? [])]);
    for (const section of [pnl.income, pnl.costOfGoodsSold, pnl.operatingExpenses, pnl.otherIncome, pnl.otherExpenses]) {
      for (const line of section.lines) {
        if (!line.accountId) continue;
        (out[line.accountId] ??= new Array<number>(months.length).fill(0))[index] = line.amount;
      }
    }
  });
  return out;
}

/** An even split of a year over the months; the rounding remainder goes into the first month. */
export function spreadYear(yearMinor: number, months: number = GRID_MONTHS): number[] {
  const each = Math.trunc(yearMinor / months);
  const out = new Array<number>(months).fill(each);
  out[0] += yearMinor - each * months;
  return out;
}

export const yearTotal = (months: readonly number[]): number => months.reduce((sum, value) => sum + value, 0);

/**
 * A budget started from actuals: each month's amount raised by `upliftPercent`
 * and rounded to a minor unit. An account that was net-negative in a month
 * (a refund larger than its spending) starts at 0, since a budget is never negative.
 */
export function seedFromActuals(
  actualsByAccount: Readonly<Record<string, readonly number[]>>,
  upliftPercent: number,
): BudgetGridValues {
  const factor = 1 + upliftPercent / 100;
  const out: BudgetGridValues = {};
  for (const [accountId, months] of Object.entries(actualsByAccount)) {
    const seeded = Array.from({ length: GRID_MONTHS }, (_, i) =>
      Math.max(0, roundHalfAwayFromZero((months[i] ?? 0) * factor)),
    );
    if (seeded.some((value) => value !== 0)) out[accountId] = seeded;
  }
  return out;
}

/** The indices (0–11) of the months where the grid differs from what was loaded. A missing account counts as 0. */
export function dirtyMonths(baseline: Readonly<BudgetGridValues>, current: Readonly<BudgetGridValues>): number[] {
  const ids = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  const dirty: number[] = [];
  for (let i = 0; i < GRID_MONTHS; i += 1) {
    for (const id of ids) {
      if ((baseline[id]?.[i] ?? 0) !== (current[id]?.[i] ?? 0)) {
        dirty.push(i);
        break;
      }
    }
  }
  return dirty;
}

/** The non-zero lines of one month, as the save takes them. A month is replaced whole, so a zero line is simply left out. */
export function monthLines(
  current: Readonly<BudgetGridValues>,
  index: number,
): { account_id: string; amount_minor: number }[] {
  return Object.entries(current)
    .map(([accountId, months]) => ({ account_id: accountId, amount_minor: months[index] ?? 0 }))
    .filter((line) => line.amount_minor !== 0);
}

export interface PlannedSummary {
  income: number;
  spending: number;
  result: number;
}

/** Planned income, planned spending and the planned result over the whole grid. */
export function plannedSummary(
  accounts: readonly Pick<GridAccount, "accountId" | "accountType">[],
  current: Readonly<BudgetGridValues>,
): PlannedSummary {
  let income = 0;
  let spending = 0;
  for (const account of accounts) {
    const total = yearTotal(current[account.accountId] ?? []);
    if (INCOME_TYPES.has(account.accountType)) income += total;
    else spending += total;
  }
  return { income, spending, result: income - spending };
}

/* ------------------------------------------------------------------ Save */

export interface MonthToSave {
  index: number;
  label: string;
}

export interface SaveOutcome {
  /** Labels of the months written, in order. */
  saved: string[];
  /** The month that failed, and why; null when every month was saved. */
  failed: { label: string; error: string } | null;
  /** The failed month and every month after it, none of which was tried again. */
  notSaved: string[];
}

/**
 * Save the months one at a time, in order, and stop at the first failure.
 * Each save replaces its own month, so running this again is safe: months
 * already written are written again with the same figures.
 */
export async function runBudgetSave(
  months: readonly MonthToSave[],
  save: (month: MonthToSave) => Promise<{ ok: boolean; error?: string }>,
): Promise<SaveOutcome> {
  const saved: string[] = [];
  for (let i = 0; i < months.length; i += 1) {
    const month = months[i];
    let result: { ok: boolean; error?: string };
    try {
      result = await save(month);
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : "Failed to save budget" };
    }
    if (!result.ok) {
      return {
        saved,
        failed: { label: month.label, error: result.error ?? "Failed to save budget" },
        notSaved: months.slice(i).map((m) => m.label),
      };
    }
    saved.push(month.label);
  }
  return { saved, failed: null, notSaved: [] };
}

export interface BudgetLineRow {
  account_id: string;
  period_start: string;
  amount_minor: number;
}

/**
 * The budget table's rows grouped into months. Every requested month gets
 * every account (0 where nothing is budgeted), in code order. Rows for a month
 * that was not asked for, or for an account outside `accounts`, are ignored.
 */
export function groupBudgetByMonth(
  lines: readonly BudgetLineRow[],
  accounts: readonly GridAccount[],
  starts: readonly string[],
): Map<string, BudgetAccountAmount[]> {
  const wanted = new Set(starts);
  const sums = new Map<string, Map<string, number>>();
  for (const line of lines) {
    if (!wanted.has(line.period_start)) continue;
    const month = sums.get(line.period_start) ?? new Map<string, number>();
    month.set(line.account_id, (month.get(line.account_id) ?? 0) + Number(line.amount_minor));
    sums.set(line.period_start, month);
  }
  const ordered = [...accounts].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  return new Map(
    starts.map((start) => [
      start,
      ordered.map((a) => ({
        accountId: a.accountId,
        accountCode: a.accountCode,
        name: a.name,
        accountType: a.accountType,
        amountMinor: sums.get(start)?.get(a.accountId) ?? 0,
      })),
    ]),
  );
}

/** What to tell the person after a save. */
export function saveOutcomeMessage(outcome: SaveOutcome): string {
  if (!outcome.failed) {
    return outcome.saved.length === 0 ? "Nothing to save." : `Budget saved for ${outcome.saved.join(", ")}.`;
  }
  const savedText = outcome.saved.length > 0 ? outcome.saved.join(", ") : "none";
  return `Saving stopped at ${outcome.failed.label}: ${outcome.failed.error}. Saved: ${savedText}. Not saved: ${outcome.notSaved.join(", ")}. Press Save to try again.`;
}
```

- [ ] **Step 6: Edit `ctyhp-accounting/lib/domain/reports.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
  favorable: boolean | null;
}
```

replace with:

```ts
  favorable: boolean | null;
  /** False when nothing is budgeted for the account: its actual is not a variance. */
  hasBudget: boolean;
}
```

Edit 2 of 2 — find:

```ts
        favorable: variance === 0 ? null : isIncome ? variance > 0 : variance < 0,
      };
```

replace with:

```ts
        favorable: variance === 0 ? null : isIncome ? variance > 0 : variance < 0,
        hasBudget: budgetAmount !== 0,
      };
```

- [ ] **Step 7: Edit `ctyhp-accounting/lib/domain/statement.ts`** — apply these 9 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 9 — find:

```ts
import { ACCOUNT_TYPES, statementSectionOf, type AccountType } from "@/lib/domain/accounts";
import { dayBefore } from "@/lib/domain/fiscal";
```

replace with:

```ts
import { ACCOUNT_TYPES, statementSectionOf, type AccountType } from "@/lib/domain/accounts";
import { percentOfBudget } from "@/lib/domain/budget-grid";
import { dayBefore } from "@/lib/domain/fiscal";
```

Edit 2 of 9 — find:

```ts
  tone?: StatementTone;
}
```

replace with:

```ts
  tone?: StatementTone;
  /** Budget vs Actual: nothing is budgeted, so the Budget, Over / Under and % cells read "—". */
  noBudget?: boolean;
}
```

Edit 3 of 9 — find:

```ts
  outOfBalance: number | null;
}
```

replace with:

```ts
  outOfBalance: number | null;
  /** Show the change % with exactly one decimal place (Budget vs Actual's % of Budget). */
  percentFixed?: boolean;
}
```

Edit 4 of 9 — find:

```ts

/** Following `reportBudget`: Actual, Budget, Variance and %, by the P&L's sections. */
export function budgetStatement(input: BudgetStatementInput): Statement {
```

replace with:

```ts

/** Following `reportBudget`: Actual, Budget, Over / Under and % of Budget, by the P&L's sections. */
export function budgetStatement(input: BudgetStatementInput): Statement {
```

Edit 5 of 9 — find:

```ts
  const shown = bva.lines.filter((l) => l.current !== 0 || l.prior !== 0);
  const budgetRow = (spec: RowSpec, incomeSide: boolean): StatementRow => {
    const row = makeRow(ctx, spec);
```

replace with:

```ts
  const shown = bva.lines.filter((l) => l.current !== 0 || l.prior !== 0);
  const budgetRow = (spec: RowSpec, incomeSide: boolean, unbudgeted = false): StatementRow => {
    const row = makeRow(ctx, spec);
```

Edit 6 of 9 — find:

```ts
    row.cells[1] = { amount: row.cells[1].amount, zoom: null }; // a budget is not in the books
    row.tone = row.change ? toneOf(row.change.amount, incomeSide) : null;
```

replace with:

```ts
    row.cells[1] = { amount: row.cells[1].amount, zoom: null }; // a budget is not in the books
    if (unbudgeted) {
      // An account with no budget: its whole actual is not a variance.
      row.noBudget = true;
      row.change = null;
      row.tone = null;
      return row;
    }
    // Over / Under is actual less budget; the percent is actual as a share of budget.
    row.change = row.change ? { amount: row.change.amount, percent: percentOfBudget(row.cells[0].amount ?? 0, row.cells[1].amount ?? 0) } : null;
    row.tone = row.change ? toneOf(row.change.amount, incomeSide) : null;
```

Edit 7 of 9 — find:

```ts
          section.incomeSide,
        ),
```

replace with:

```ts
          section.incomeSide,
          !line.hasBudget,
        ),
```

Edit 8 of 9 — find:

```ts
  );
  return { title: "Budget vs Actual", columns, changeLabels: ["Variance", "%"], percent: false, rows, empty: shown.length === 0, outOfBalance: null };
}
```

replace with:

```ts
  );
  return { title: "Budget vs Actual", columns, changeLabels: ["Over / Under", "% of Budget"], percent: false, rows, empty: shown.length === 0, outOfBalance: null, percentFixed: true };
}
```

Edit 9 of 9 — find:

```ts
      r.cells.forEach((cell, i) => {
        out[`c${i}`] = cell.amount === null ? null : fromMinor(cell.amount, meta.decimals);
        if (statement.percent) out[`p${i}`] = r.percent?.[i] ?? null;
```

replace with:

```ts
      r.cells.forEach((cell, i) => {
        out[`c${i}`] = cell.amount === null || (r.noBudget && i === 1) ? null : fromMinor(cell.amount, meta.decimals);
        if (statement.percent) out[`p${i}`] = r.percent?.[i] ?? null;
```

- [ ] **Step 8: Replace the whole of `ctyhp-accounting/lib/services/budgets.ts`** (most of it changes) with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BudgetMonthSaveInput } from "@/lib/domain/schemas";
import { budgetMonthSaveSchema } from "@/lib/domain/schemas";
import {
  buildBudgetVsActual,
  type BudgetAccountAmount,
  type BudgetVsActual,
} from "@/lib/domain/reports";
import {
  buildMonthByMonth,
  groupBudgetByMonth,
  monthLabelOf,
  type BudgetLineRow,
  monthlyActualsByAccount,
  monthStartsBetween,
  type BudgetGridValues,
  type GridAccount,
  type MonthResult,
} from "@/lib/domain/budget-grid";
import { fiscalMonths } from "@/lib/domain/fiscal";
import { readAllPages } from "@/lib/services/paging";
import { getLedgerBalances, getMonthlyLedgerBalances } from "@/lib/services/reports";

export class BudgetError extends Error {}

export async function getBudgetAccountAmounts(
  sb: SupabaseClient,
  fiscalYear: number,
  from: string,
  to: string,
): Promise<BudgetAccountAmount[]> {
  const { data, error } = await sb.rpc("acc_budget_lines", {
    p_fiscal_year: fiscalYear,
    p_from: from,
    p_to: to,
  });
  if (error) throw new BudgetError(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    accountId: row.account_id as string,
    accountCode: row.account_code as string,
    name: row.name as string,
    accountType: row.account_type as BudgetAccountAmount["accountType"],
    amountMinor: Number(row.amount_minor ?? 0),
  }));
}

export async function saveBudgetMonth(
  sb: SupabaseClient,
  input: BudgetMonthSaveInput,
): Promise<string> {
  const parsed = budgetMonthSaveSchema.parse(input);
  const { data, error } = await sb.rpc("acc_save_budget_month", {
    p_fiscal_year: parsed.fiscal_year,
    p_period_start: parsed.period_start,
    p_lines: parsed.lines,
  });
  if (error) throw new BudgetError(error.message);
  return String(data);
}

const PL_TYPES = ["income", "cost_of_goods_sold", "expense", "other_income", "other_expense"];

/**
 * The requested months' budget for a fiscal year, from the tables directly:
 * the budget's id and the accounts together, then its lines, paged in a total
 * order. That is three requests however many months are asked for (one more
 * per further 1,000 rows). A month outside the fiscal year, or with no
 * budget, is all zeros.
 */
export async function getBudgetByMonth(
  sb: SupabaseClient,
  fiscalYear: number,
  starts: readonly string[],
): Promise<{ byMonth: Map<string, BudgetAccountAmount[]>; accounts: GridAccount[] }> {
  const fail = (message: string) => new BudgetError(message);
  const [header, accountRows] = await Promise.all([
    sb.from("acc_budget").select("id").eq("fiscal_year", fiscalYear).maybeSingle(),
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_account")
          .select("id,account_code,name,account_type")
          .eq("is_posting_account", true)
          .in("account_type", PL_TYPES)
          .order("account_code")
          .order("id")
          .range(from, to),
      fail,
    ),
  ]);
  if (header.error) throw new BudgetError(header.error.message);
  const accounts: GridAccount[] = accountRows.map((row) => ({
    accountId: row.id as string,
    accountCode: row.account_code as string,
    name: row.name as string,
    accountType: row.account_type as GridAccount["accountType"],
  }));
  const budgetId = (header.data as { id: string } | null)?.id;
  const lines = budgetId
    ? await readAllPages<BudgetLineRow>(
        (from, to) =>
          sb
            .from("acc_budget_line")
            .select("account_id,period_start,amount_minor")
            .eq("budget_id", budgetId)
            .order("period_start")
            .order("account_id")
            .order("id")
            .range(from, to),
        fail,
      )
    : [];
  return { byMonth: groupBudgetByMonth(lines, accounts, starts), accounts };
}

export interface BudgetVsActualReport extends BudgetVsActual {
  /** One row per month of the range; empty when the range is a single month. */
  monthly: MonthResult[];
}

/**
 * Budget vs Actual for whole fiscal months: the lines and sections, and, when
 * the range covers two months or more, the result of each month.
 * `from` is the first day of a month and `to` the last day of one.
 */
export async function getBudgetVsActual(
  sb: SupabaseClient,
  fiscalYear: number,
  from: string,
  to: string,
): Promise<BudgetVsActualReport> {
  const starts = monthStartsBetween(from, to);
  const [actual, budget] = await Promise.all([
    getLedgerBalances(sb, from, to),
    getBudgetAccountAmounts(sb, fiscalYear, from, to),
  ]);
  const report = buildBudgetVsActual(actual, budget);
  if (starts.length < 2) return { ...report, monthly: [] };
  const [actualByMonth, { byMonth: budgetByMonth }] = await Promise.all([
    getMonthlyLedgerBalances(sb, to, starts.length),
    getBudgetByMonth(sb, fiscalYear, starts),
  ]);
  const monthly = buildMonthByMonth(
    starts.map((start) => ({ start, label: monthLabelOf(start) })),
    actualByMonth,
    budgetByMonth,
  );
  return { ...report, monthly };
}

export interface BudgetGridData {
  /** Every posting income or expense account, in code order. */
  accounts: GridAccount[];
  /** What is budgeted, twelve months per account; only accounts with something budgeted. */
  budget: BudgetGridValues;
  /** What was posted in this fiscal year, by month, per account. */
  thisYear: BudgetGridValues;
  /** The same for the fiscal year before; empty when there is none to read. */
  lastYear: BudgetGridValues;
}

/** Everything the full-year budget grid opens with. Reads only. */
export async function getBudgetGrid(
  sb: SupabaseClient,
  fiscalYear: number,
  fiscalStartMonth: number,
): Promise<BudgetGridData> {
  const months = fiscalMonths(fiscalYear, fiscalStartMonth);
  const starts = months.map((m) => m.start);
  const { byMonth: budgetByMonth, accounts } = await getBudgetByMonth(sb, fiscalYear, starts);
  const budget: BudgetGridValues = {};
  starts.forEach((start, index) => {
    for (const row of budgetByMonth.get(start) ?? []) {
      if (row.amountMinor !== 0) (budget[row.accountId] ??= new Array<number>(starts.length).fill(0))[index] = row.amountMinor;
    }
  });
  const actualsFor = async (year: number): Promise<BudgetGridValues> => {
    if (year < 2000) return {};
    const yearMonths = fiscalMonths(year, fiscalStartMonth);
    const byMonth = await getMonthlyLedgerBalances(sb, yearMonths[11].end, 12);
    return monthlyActualsByAccount(
      yearMonths.map((m) => ({ start: m.start, label: m.label })),
      byMonth,
    );
  };
  const [thisYear, lastYear] = await Promise.all([actualsFor(fiscalYear), actualsFor(fiscalYear - 1)]);
  return { accounts, budget, thisYear, lastYear };
}
```

- [ ] **Step 9: Edit `ctyhp-accounting/components/reports/StatementTable.tsx`** — apply these 4 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 4 — find:

```tsx
/** A percentage cell: blank when there is no percentage to give (nothing to divide by). */
const percentText = (value: number | null | undefined): string => (value == null ? "" : formatPercent(value));

```

replace with:

```tsx
/** A percentage cell: blank when there is no percentage to give (nothing to divide by). */
const percentText = (value: number | null | undefined, fixed = false): string =>
  value == null ? "" : fixed ? `${value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : formatPercent(value);

/** What a Budget vs Actual cell reads when nothing is budgeted. */
const NO_BUDGET = "—";

```

Edit 2 of 4 — find:

```tsx
    const cell = row.cells[i];
    if (cell.amount === null) return "";
```

replace with:

```tsx
    const cell = row.cells[i];
    if (row.noBudget && i === 1) return NO_BUDGET;
    if (cell.amount === null) return "";
```

Edit 3 of 4 — find:

```tsx
                    >
                      {row.change ? money(row.change.amount) : ""}
                      {row.tone ? <span className="accounting-sr-only">{` ${row.tone}`}</span> : null}
```

replace with:

```tsx
                    >
                      {row.change ? money(row.change.amount) : row.noBudget ? NO_BUDGET : ""}
                      {row.tone ? <span className="accounting-sr-only">{` ${row.tone}`}</span> : null}
```

Edit 4 of 4 — find:

```tsx
                    <td className={`${styles.pct}${signClass(row.change?.percent, toneClass)}`}>
                      {percentText(row.change?.percent)}
                    </td>
```

replace with:

```tsx
                    <td className={`${styles.pct}${signClass(row.change?.percent, toneClass)}`}>
                      {row.noBudget ? NO_BUDGET : percentText(row.change?.percent, statement.percentFixed)}
                    </td>
```

- [ ] **Step 10: Create `ctyhp-accounting/components/reports/BudgetMonthTable.tsx`** with exactly this content:

```tsx
"use client";

import type { MonthResult } from "@/lib/domain/budget-grid";
import { reportPaperStyles as styles } from "@/components/reports/ReportPaper";

/**
 * The result of each month against its budget. A result is income less
 * expenses, so being above budget is good news here.
 */
export default function BudgetMonthTable({
  months,
  money,
}: {
  months: readonly MonthResult[];
  money: (minor: number) => string;
}) {
  if (months.length < 2) return null;
  const total = months.reduce(
    (sum, month) => ({ actual: sum.actual + month.actual, budget: sum.budget + month.budget }),
    { actual: 0, budget: 0 },
  );
  const toneOf = (variance: number): string | undefined =>
    variance === 0 ? undefined : variance > 0 ? styles.favorable : styles.unfavorable;
  const cell = (variance: number) => `${styles.r}${toneOf(variance) ? ` ${toneOf(variance)}` : ""}`;

  return (
    <section aria-label="Month by month" style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px" }}>Month by month</h3>
      <div className={styles.rptScroll}>
        <table className={styles.rpt}>
          <thead>
            <tr>
              <th className={styles.l}>Month</th>
              <th>Actual result</th>
              <th>Budgeted result</th>
              <th>Over / Under</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.start}>
                <td>{month.label}</td>
                <td className={styles.r}>{money(month.actual)}</td>
                <td className={styles.r}>{money(month.budget)}</td>
                <td className={cell(month.variance)}>{money(month.variance)}</td>
              </tr>
            ))}
            <tr className={styles.rTotal}>
              <td>Total</td>
              <td className={styles.r}>{money(total.actual)}</td>
              <td className={styles.r}>{money(total.budget)}</td>
              <td className={cell(total.actual - total.budget)}>{money(total.actual - total.budget)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 11: Create `ctyhp-accounting/components/reports/budget-grid.module.css`** with exactly this content:

```css
.tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-bottom: 12px;
}

.uplift {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ob-text-secondary);
  font-size: 13px;
}

.scroll {
  /* A cell tabbed or clicked into view stops short of the sticky Account column. */
  scroll-padding-left: 210px;
  overflow: auto;
  max-height: calc(100vh - 360px);
  min-height: 160px;
  border: 1px solid var(--ob-border-muted);
  border-radius: 6px;
}

.grid {
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.grid th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--ob-surface-card);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--ob-text-secondary);
  text-align: right;
  padding: 8px 4px;
  border-bottom: 1px solid var(--ob-border-muted);
  white-space: nowrap;
}

.grid td {
  padding: 3px 2px;
  border-bottom: 1px solid var(--ob-border-muted);
  color: var(--ob-text-body);
  white-space: nowrap;
}

.grid th.account,
.grid td.account {
  position: sticky;
  left: 0;
  z-index: 1;
  text-align: left;
  padding-left: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Its own background and a right edge: cells scrolling under it are hidden cleanly. */
  background: var(--ob-surface-card);
  border-right: 1px solid var(--ob-border-muted);
}

.grid th.account {
  z-index: 3;
}

.grid td.year,
.grid th.year {
  border-left: 1px solid var(--ob-border-muted);
}

.empty {
  padding: 24px;
  text-align: center;
  color: var(--ob-text-secondary);
}

.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  margin-top: 12px;
  font-variant-numeric: tabular-nums;
}

.summary span {
  color: var(--ob-text-secondary);
}

.summary strong {
  margin-left: 6px;
  color: var(--ob-text-body);
}

.notice {
  margin-bottom: 12px;
}

/* A compact amount: right-aligned, no spinner, the cell's whole width. */
.amount {
  width: 100%;
}

.amount :global(.ant-input-number-input) {
  text-align: right;
  padding-inline: 4px;
  font-size: 12px;
}
```

- [ ] **Step 12: Replace the whole of `ctyhp-accounting/components/reports/BudgetEditorDrawer.tsx`** (most of it changes) with exactly this content:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Drawer, InputNumber, Select, Space, Typography } from "antd";
import {
  GRID_MONTHS,
  GRID_WIDTHS,
  dirtyMonths,
  monthLines,
  plannedSummary,
  runBudgetSave,
  saveOutcomeMessage,
  seedFromActuals,
  spreadYear,
  yearTotal,
  type BudgetGridValues,
  type GridAccount,
} from "@/lib/domain/budget-grid";
import type { FiscalMonth } from "@/lib/domain/fiscal";
import { formatMoney } from "@/lib/format";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { getBudgetGridAction, saveBudgetMonthAction } from "@/app/(app)/reports/actions";
import type { BudgetGridData } from "@/lib/services/budgets";
import styles from "./budget-grid.module.css";

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  income: "Income",
  cost_of_goods_sold: "Cost of Goods Sold",
  expense: "Expense",
  other_income: "Other Income",
  other_expense: "Other Expense",
};

const zeros = (): number[] => new Array<number>(GRID_MONTHS).fill(0);
const byCode = (a: GridAccount, b: GridAccount) => a.accountCode.localeCompare(b.accountCode);

/**
 * The whole year's budget in one grid: a row per account, a cell per month and
 * a Year cell that spreads itself evenly over the months. Nothing is saved
 * until Save, which sends the months that changed, one at a time.
 */
export default function BudgetEditorDrawer({
  open,
  onClose,
  onSaved,
  fiscalYear,
  months,
  baseCurrency,
  baseDecimals,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after every save that wrote at least one month; `complete` is false when a month failed. */
  onSaved: (outcome: { complete: boolean }) => void;
  fiscalYear: number;
  months: FiscalMonth[];
  baseCurrency: string;
  baseDecimals: number;
}) {
  const { message, modal } = App.useApp();
  const [data, setData] = useState<BudgetGridData | null>(null);
  const [rowIds, setRowIds] = useState<string[]>([]);
  const [values, setValues] = useState<BudgetGridValues>({});
  const [baseline, setBaseline] = useState<BudgetGridValues>({});
  const [uplift, setUplift] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    // Opening the grid intentionally synchronizes it with the database.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setProblem(null);
    void getBudgetGridAction(fiscalYear).then((result) => {
      if (!active) return;
      setLoading(false);
      if (!result.ok || !result.data) {
        message.error(result.error ?? "Failed to load budget");
        return;
      }
      const loaded = result.data;
      setData(loaded);
      setBaseline(Object.fromEntries(Object.entries(loaded.budget).map(([id, row]) => [id, [...row]])));
      setValues(Object.fromEntries(Object.entries(loaded.budget).map(([id, row]) => [id, [...row]])));
      setRowIds(
        loaded.accounts
          .filter((account) => loaded.budget[account.accountId])
          .sort(byCode)
          .map((account) => account.accountId),
      );
    });
    return () => {
      active = false;
    };
  }, [open, fiscalYear, message]);

  const accountById = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.accountId, a])), [data]);
  const rows = useMemo(
    () => rowIds.map((id) => accountById.get(id)).filter((a): a is GridAccount => Boolean(a)),
    [rowIds, accountById],
  );
  const addable = useMemo(
    () => (data?.accounts ?? []).filter((a) => !rowIds.includes(a.accountId)).sort(byCode),
    [data, rowIds],
  );
  const summary = useMemo(() => plannedSummary(rows, values), [rows, values]);
  const dirty = useMemo(() => dirtyMonths(baseline, values), [baseline, values]);
  const money = (minor: number) => formatMoney(minor, baseCurrency, baseDecimals);

  const setCell = (accountId: string, index: number, minor: number) =>
    setValues((current) => {
      const row = [...(current[accountId] ?? zeros())];
      row[index] = minor;
      return { ...current, [accountId]: row };
    });
  const setYear = (accountId: string, minor: number) =>
    setValues((current) => ({ ...current, [accountId]: spreadYear(minor) }));

  const startFrom = (source: "lastYear" | "thisYear") => {
    if (!data) return;
    const seeded = seedFromActuals(data[source], uplift);
    const ids = new Set([...rowIds, ...Object.keys(seeded)]);
    const nextRows = [...ids].map((id) => accountById.get(id)).filter((a): a is GridAccount => Boolean(a)).sort(byCode);
    setRowIds(nextRows.map((a) => a.accountId));
    setValues(Object.fromEntries(nextRows.map((a) => [a.accountId, seeded[a.accountId] ?? zeros()])));
    setProblem(null);
  };

  const confirmClear = () =>
    modal.confirm({
      title: `Clear FY ${fiscalYear}?`,
      content: "This empties every month in the grid. Nothing changes in the books until you press Save.",
      okText: "Clear this year",
      okButtonProps: { danger: true },
      cancelText: "Keep it",
      onOk: () => {
        setValues(Object.fromEntries(rowIds.map((id) => [id, zeros()])));
        setProblem(null);
      },
    });

  const addAccount = (accountId: string) => {
    setRowIds((current) => (current.includes(accountId) ? current : [...current, accountId]));
    setValues((current) => ({ ...current, [accountId]: current[accountId] ?? zeros() }));
  };

  const save = async () => {
    if (dirty.length === 0) {
      message.info("No changes to save.");
      return;
    }
    setSaving(true);
    setProblem(null);
    const outcome = await runBudgetSave(
      dirty.map((index) => ({ index, label: months[index].label })),
      (month) =>
        saveBudgetMonthAction({
          fiscal_year: fiscalYear,
          period_start: months[month.index].start,
          lines: monthLines(values, month.index),
        }),
    );
    setSaving(false);
    // What was written is now what the database holds: only the rest still counts as changed.
    const writtenLabels = new Set(outcome.saved);
    const written = dirty.filter((index) => writtenLabels.has(months[index].label));
    if (written.length > 0) {
      setBaseline((current) => {
        const next: BudgetGridValues = {};
        for (const id of new Set([...Object.keys(current), ...Object.keys(values)])) {
          const row = [...(current[id] ?? zeros())];
          for (const index of written) row[index] = values[id]?.[index] ?? 0;
          next[id] = row;
        }
        return next;
      });
    }
    if (outcome.failed) {
      setProblem(saveOutcomeMessage(outcome));
    } else {
      message.success(saveOutcomeMessage(outcome));
    }
    if (written.length > 0) onSaved({ complete: !outcome.failed });
  };

  const inputProps = {
    controls: false,
    min: 0,
    precision: baseDecimals,
    className: styles.amount,
  } as const;

  return (
    <Drawer
      title={`FY ${fiscalYear} budget`}
      open={open}
      onClose={onClose}
      width="min(1500px, 96vw)"
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>Close</Button>
          <Button type="primary" loading={saving} disabled={loading || dirty.length === 0} onClick={() => void save()}>
            {dirty.length === 0 ? "Save" : `Save ${dirty.length} ${dirty.length === 1 ? "month" : "months"}`}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" className="report-editor-help">
        Enter amounts in {baseCurrency}, positive for income and for spending alike. A Year figure is spread evenly over
        the twelve months, with any rounding remainder in the first. Saving replaces each changed month and records it
        in the audit log.
      </Typography.Paragraph>

      {problem ? <Alert className={styles.notice} type="error" showIcon title={problem} /> : null}

      <div className={styles.tools}>
        <Button disabled={loading || !data} onClick={() => startFrom("lastYear")}>
          Start from last year’s actuals
        </Button>
        <Button disabled={loading || !data} onClick={() => startFrom("thisYear")}>
          Start from this year’s actuals
        </Button>
        <label className={styles.uplift}>
          Uplift
          <InputNumber
            aria-label="Uplift percent"
            value={uplift}
            step={1}
            precision={1}
            style={{ width: 90 }}
            suffix="%"
            onChange={(value) => setUplift(Number(value ?? 0))}
          />
        </label>
        <Button danger disabled={loading || rows.length === 0} onClick={confirmClear}>
          Clear this year
        </Button>
        <Select
          showSearch
          aria-label="Add an account"
          placeholder="Add an account"
          value={null}
          style={{ width: 280, marginLeft: "auto" }}
          disabled={loading || addable.length === 0}
          optionFilterProp="label"
          options={addable.map((a) => ({
            value: a.accountId,
            label: `${a.accountCode} — ${a.name} (${ACCOUNT_TYPE_LABELS[a.accountType] ?? a.accountType})`,
          }))}
          onChange={(id) => id && addAccount(id)}
        />
      </div>

      <div className={styles.scroll}>
        <table className={styles.grid} style={{ width: GRID_WIDTHS.total, minWidth: GRID_WIDTHS.total }}>
          <colgroup>
            <col style={{ width: GRID_WIDTHS.account }} />
            {months.map((month) => (
              <col key={month.start} style={{ width: GRID_WIDTHS.month }} />
            ))}
            <col style={{ width: GRID_WIDTHS.year }} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.account}>Account</th>
              {months.map((month) => (
                <th key={month.start} title={month.label}>
                  {month.label.split(" ")[0]}
                </th>
              ))}
              <th className={styles.year}>Year</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className={styles.empty} colSpan={months.length + 2}>
                  Reading the budget…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className={styles.empty} colSpan={months.length + 2}>
                  Nothing is budgeted for FY {fiscalYear} yet. Add an account, or start from actuals.
                </td>
              </tr>
            ) : (
              rows.map((account) => {
                const row = values[account.accountId] ?? zeros();
                return (
                  <tr key={account.accountId}>
                    <td
                      className={styles.account}
                      title={`${account.accountCode} — ${account.name} (${ACCOUNT_TYPE_LABELS[account.accountType] ?? account.accountType})`}
                    >
                      <strong>{account.accountCode}</strong> {account.name}
                    </td>
                    {months.map((month, index) => (
                      <td key={month.start}>
                        <InputNumber
                          {...inputProps}
                          aria-label={`${account.accountCode} ${account.name}, ${month.label}`}
                          value={fromMinor(row[index] ?? 0, baseDecimals)}
                          onChange={(value) => setCell(account.accountId, index, toMinor(Number(value ?? 0), baseDecimals))}
                        />
                      </td>
                    ))}
                    <td className={styles.year}>
                      <InputNumber
                        {...inputProps}
                        aria-label={`${account.accountCode} ${account.name}, year ${fiscalYear}`}
                        value={fromMinor(yearTotal(row), baseDecimals)}
                        onChange={(value) => setYear(account.accountId, toMinor(Number(value ?? 0), baseDecimals))}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.summary} aria-live="polite">
        <span>
          Planned income<strong>{money(summary.income)}</strong>
        </span>
        <span>
          Planned spending<strong>{money(summary.spending)}</strong>
        </span>
        <span>
          Planned result<strong>{money(summary.result)}</strong>
        </span>
      </div>
    </Drawer>
  );
}
```

- [ ] **Step 13: Edit `ctyhp-accounting/app/(app)/reports/actions.ts`** — apply these 9 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 9 — find:

```ts
import { getLedgerBalances } from "@/lib/services/reports";
import { getBudgetAccountAmounts, saveBudgetMonth, BudgetError } from "@/lib/services/budgets";
import { dayBefore } from "@/lib/domain/fiscal";
```

replace with:

```ts
import { getLedgerBalances } from "@/lib/services/reports";
import {
  getBudgetGrid,
  getBudgetVsActual,
  saveBudgetMonth,
  BudgetError,
  type BudgetGridData,
  type BudgetVsActualReport,
} from "@/lib/services/budgets";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { dayBefore } from "@/lib/domain/fiscal";
```

Edit 2 of 9 — find:

```ts
import {
  buildBudgetVsActual,
  buildStatementOfEquity,
```

replace with:

```ts
import {
  buildStatementOfEquity,
```

Edit 3 of 9 — find:

```ts
  buildStatementOfEquity,
  type BudgetAccountAmount,
  type BudgetVsActual,
  type LedgerBalance,
```

replace with:

```ts
  buildStatementOfEquity,
  type LedgerBalance,
```

Edit 4 of 9 — find:

```ts
  to: string,
): Promise<ActionResult<BudgetVsActual>> {
  const role = await getUserRole();
```

replace with:

```ts
  to: string,
): Promise<ActionResult<BudgetVsActualReport>> {
  const role = await getUserRole();
```

Edit 5 of 9 — find:

```ts
    cashFlowRangeSchema.parse({ from, to });
    const sb = await createSupabaseServerClient();
```

replace with:

```ts
    cashFlowRangeSchema.parse({ from, to });
    if (!from.endsWith("-01")) return { ok: false, error: "A budget report starts on the first day of a month" };
    if (from > to) return { ok: false, error: "Report end date must not be before its start date" };
    const sb = await createSupabaseServerClient();
```

Edit 6 of 9 — find:

```ts
    const sb = await createSupabaseServerClient();
    const [actual, budget] = await Promise.all([
      getLedgerBalances(sb, from, to),
      getBudgetAccountAmounts(sb, fiscalYear, from, to),
    ]);
    return { ok: true, data: buildBudgetVsActual(actual, budget) };
  } catch (err) {
```

replace with:

```ts
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getBudgetVsActual(sb, fiscalYear, from, to) };
  } catch (err) {
```

Edit 7 of 9 — find:

```ts

export async function getBudgetMonthAction(
  fiscalYear: number,
  periodStart: string,
): Promise<ActionResult<BudgetAccountAmount[]>> {
  const role = await getUserRole();
```

replace with:

```ts

/** The full-year budget grid's starting data: the accounts, the budget, and two years of actuals. Reads only. */
export async function getBudgetGridAction(fiscalYear: number): Promise<ActionResult<BudgetGridData>> {
  const role = await getUserRole();
```

Edit 8 of 9 — find:

```ts
  try {
    const parsed = budgetMonthSaveSchema.pick({
      fiscal_year: true,
      period_start: true,
    }).parse({ fiscal_year: fiscalYear, period_start: periodStart });
    const sb = await createSupabaseServerClient();
```

replace with:

```ts
  try {
    const parsed = budgetMonthSaveSchema.pick({ fiscal_year: true }).parse({ fiscal_year: fiscalYear });
    const sb = await createSupabaseServerClient();
```

Edit 9 of 9 — find:

```ts
    const sb = await createSupabaseServerClient();
    const data = await getBudgetAccountAmounts(
      sb,
      parsed.fiscal_year,
      parsed.period_start,
      parsed.period_start,
    );
    return { ok: true, data };
```

replace with:

```ts
    const sb = await createSupabaseServerClient();
    const settings = await getCurrentCompanySettings(sb);
    const data = await getBudgetGrid(sb, parsed.fiscal_year, settings?.fiscal_year_start_month ?? 1);
    return { ok: true, data };
```

- [ ] **Step 14: Edit `ctyhp-accounting/app/(app)/reports/ReportsClient.tsx`** — apply these 7 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 7 — find:

```tsx
import BudgetEditorDrawer from "@/components/reports/BudgetEditorDrawer";
import { ReportBody } from "@/components/reports/ReportAudience";
```

replace with:

```tsx
import BudgetEditorDrawer from "@/components/reports/BudgetEditorDrawer";
import BudgetMonthTable from "@/components/reports/BudgetMonthTable";
import { ReportBody } from "@/components/reports/ReportAudience";
```

Edit 2 of 7 — find:

```tsx
import { formatMoney } from "@/lib/format";
import { dayBefore, fiscalMonths, fiscalYearForDate } from "@/lib/domain/fiscal";
```

replace with:

```tsx
import { formatMoney } from "@/lib/format";
import type { MonthResult } from "@/lib/domain/budget-grid";
import { dayBefore, fiscalMonths, fiscalYearForDate } from "@/lib/domain/fiscal";
```

Edit 3 of 7 — find:

```tsx
  const [stats, setStats] = useState<StatItem[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
```

replace with:

```tsx
  const [stats, setStats] = useState<StatItem[] | null>(null);
  // Budget vs Actual: each month of the range against its budget (empty for a single month).
  const [monthly, setMonthly] = useState<MonthResult[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
```

Edit 4 of 7 — find:

```tsx
      setStats(null);
    };
```

replace with:

```tsx
      setStats(null);
      setMonthly([]);
    };
```

Edit 5 of 7 — find:

```tsx
        const netVariance = bva.actual.netIncome - bva.budget.netIncome;
        show(
```

replace with:

```tsx
        const netVariance = bva.actual.netIncome - bva.budget.netIncome;
        if (current()) setMonthly(bva.monthly);
        show(
```

Edit 6 of 7 — find:

```tsx
      <StatementTable statement={shownStatement} money={money} onZoom={setZoom} />
      {shownStatement.outOfBalance !== null ? (
```

replace with:

```tsx
      <StatementTable statement={shownStatement} money={money} onZoom={setZoom} />
      {type === "budget" ? <BudgetMonthTable months={monthly} money={money} /> : null}
      {shownStatement.outOfBalance !== null ? (
```

Edit 7 of 7 — find:

```tsx
          onClose={() => setBudgetEditorOpen(false)}
          onSaved={() => {
            setBudgetEditorOpen(false);
            void run();
```

replace with:

```tsx
          onClose={() => setBudgetEditorOpen(false)}
          onSaved={({ complete }) => {
            // A save that stopped part-way keeps the grid open, so the message naming the unsaved months stays in view.
            if (complete) setBudgetEditorOpen(false);
            void run();
```

- [ ] **Step 15: Edit `ctyhp-accounting/tests/live/statement-parity.live.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
import { listAccounts } from "@/lib/services/accounts";
import { getBudgetAccountAmounts } from "@/lib/services/budgets";
```

replace with:

```ts
import { listAccounts } from "@/lib/services/accounts";
import { percentOfBudget } from "@/lib/domain/budget-grid";
import { getBudgetAccountAmounts } from "@/lib/services/budgets";
```

Edit 2 of 2 — find:

```ts
        expect(row?.cells.map((cell) => cell.amount), `${c.name} budget ${line.accountCode}`).toEqual([line.current, line.prior]);
        expect(row?.change, `${c.name} budget variance ${line.accountCode}`).toEqual({ amount: line.variance, percent: line.variancePercent });
      }
```

replace with:

```ts
        expect(row?.cells.map((cell) => cell.amount), `${c.name} budget ${line.accountCode}`).toEqual([line.current, line.prior]);
        if (line.hasBudget) {
          expect(row?.change, `${c.name} budget variance ${line.accountCode}`).toEqual({ amount: line.variance, percent: percentOfBudget(line.current, line.prior) });
        } else {
          expect(row?.noBudget, `${c.name} budget dash ${line.accountCode}`).toBe(true);
        }
      }
```

- [ ] **Step 16: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/budget-grid.test.ts" "tests/unit/reports.test.ts" "tests/unit/statement.test.ts" "lib/domain/budget-grid.ts" "lib/domain/reports.ts" "lib/domain/statement.ts" "lib/services/budgets.ts" "components/reports/StatementTable.tsx" "components/reports/BudgetMonthTable.tsx" "components/reports/BudgetEditorDrawer.tsx" "app/(app)/reports/actions.ts" "app/(app)/reports/ReportsClient.tsx" "tests/live/statement-parity.live.ts"
npx vitest run tests/unit/budget-grid.test.ts tests/unit/reports.test.ts tests/unit/statement.test.ts tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/rsc-antd.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; budget-grid + reports + statement: 89 tests passing; table-adoption, table-fit-contract and rsc-antd pass.

- [ ] **Step 17: Commit**

```bash
git add "ctyhp-accounting/tests/unit/budget-grid.test.ts" "ctyhp-accounting/tests/unit/reports.test.ts" "ctyhp-accounting/tests/unit/statement.test.ts" "ctyhp-accounting/lib/domain/budget-grid.ts" "ctyhp-accounting/lib/domain/reports.ts" "ctyhp-accounting/lib/domain/statement.ts" "ctyhp-accounting/lib/services/budgets.ts" "ctyhp-accounting/components/reports/StatementTable.tsx" "ctyhp-accounting/components/reports/BudgetMonthTable.tsx" "ctyhp-accounting/components/reports/budget-grid.module.css" "ctyhp-accounting/components/reports/BudgetEditorDrawer.tsx" "ctyhp-accounting/app/(app)/reports/actions.ts" "ctyhp-accounting/app/(app)/reports/ReportsClient.tsx" "ctyhp-accounting/tests/live/statement-parity.live.ts"
git commit -m "feat(reports): Budget vs Actual gains % of Budget, a month-by-month table and a full-year budget grid"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 6: Report Center cards, the live check, release notes and the Guide

**Files:**
- Test (modify): `ctyhp-accounting/tests/unit/reports-wave1-catalog.test.ts`
- Test (create): `ctyhp-accounting/tests/live/reports-wave2.live.ts`
- Modify: `ctyhp-accounting/lib/domain/report-catalog.ts`
- Modify: `ctyhp-accounting/components/reports/ReportsHub.tsx`
- Modify: `ctyhp-accounting/lib/domain/changelog.ts`
- Modify: `ctyhp-accounting/lib/domain/system-guide.ts`

**Interfaces:**
- Consumes: every page and service from Tasks 1–5.
- Produces: catalog cards "Financial Ratios" (Analysis), "Purchases and Inventory" and "Sales Tax Liability" (Inventory & Tax), the forecast card retitled "13 Week Cash Forecast"; release 1.95 above 1.94 (date 2026-10-09 — if main has moved past 1.94 by the time this merges, the controller renumbers it to the next free number); a new Guide flow `budget` and one step per new report.

- [ ] **Step 1: Edit `ctyhp-accounting/tests/unit/reports-wave1-catalog.test.ts`** — apply these 1 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 1 — find:

```ts
    expect(REPORT_CATALOG.some((r) => r.href.includes("beancount"))).toBe(false);
    expect(REPORT_CATALOG).toHaveLength(36);
  });
```

replace with:

```ts
    expect(REPORT_CATALOG.some((r) => r.href.includes("beancount"))).toBe(false);
    expect(REPORT_CATALOG).toHaveLength(39);
  });
```

- [ ] **Step 2: Create `ctyhp-accounting/tests/live/reports-wave2.live.ts`** with exactly this content:

```ts
/**
 * The reports of wave 2a, run against every company's books — read-only.
 *
 * One `it` per report, so later parts add theirs beside it. For every company
 * the smoke user belongs to, each report is built from the same reads its
 * screen makes and held to the statement it has to agree with. Counts and
 * agree/disagree are logged; amounts never are.
 * Nothing is written: every call is a select or a read-only RPC.
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/reports-wave2.live.ts --silent=false --reporter=verbose
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import { presetRange } from "@/lib/domain/report-presets";
import { buildBalanceSheet, buildProfitAndLoss } from "@/lib/domain/reports";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { postedEntryDateSpan } from "@/lib/services/exceptions";
import { getFinancialRatios } from "@/lib/services/financial-ratios";
import { getInventoryAccounts } from "@/lib/services/inventory-accounts";
import { buildSalesTaxLiability } from "@/lib/domain/sales-tax-liability";
import { getPurchasesInventory } from "@/lib/services/purchases-inventory";
import { getSalesTaxLiabilityData } from "@/lib/services/sales-tax-liability";
import { expandRecurring } from "@/lib/domain/forecast";
import { getCashForecast, listActiveRecurringTemplates } from "@/lib/services/forecast";
import { getBudgetVsActual } from "@/lib/services/budgets";
import { fiscalMonths, fiscalYearForDate } from "@/lib/domain/fiscal";
import { getLedgerBalances } from "@/lib/services/reports";

interface Company {
  name: string;
  sb: SupabaseClient;
  today: string;
  fiscalStartMonth: number;
  first: string | null;
  last: string | null;
}

const companies: Company[] = [];

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
    const [settings, span] = await Promise.all([getCurrentCompanySettings(sb), postedEntryDateSpan(sb)]);
    const timeZone = settings?.time_zone ?? "UTC";
    companies.push({
      name: row.schema_name,
      sb,
      today: todayInTimeZone(timeZone),
      fiscalStartMonth: settings?.fiscal_year_start_month ?? 1,
      first: span.first,
      last: span.last,
    });
  }
  if (companies.length === 0) throw new Error("The smoke user belongs to no company.");
});

describe("wave 2a reports on every company's books", () => {
  it("Financial Ratios: the workings agree with the Balance Sheet and the Profit and Loss", async () => {
    for (const c of companies) {
      const ctx = { today: c.today, fiscalStartMonth: c.fiscalStartMonth, firstEntryDate: c.first, lastEntryDate: c.last };
      for (const preset of ["year", "all"] as const) {
        const { from, to } = presetRange(preset, ctx);
        const [report, inventory, balances, flow] = await Promise.all([
          getFinancialRatios(c.sb, from, to),
          getInventoryAccounts(c.sb),
          getLedgerBalances(c.sb, null, to),
          getLedgerBalances(c.sb, from, to),
        ]);
        const sheet = buildBalanceSheet(balances);
        const pnl = buildProfitAndLoss(flow);
        const w = report.current;
        const checks: [string, number, number][] = [
          ["total assets", w.totalAssetsMinor, sheet.totalAssets],
          ["total liabilities", w.totalLiabilitiesMinor, sheet.totalLiabilities],
          ["equity", w.equityMinor, sheet.totalEquity],
          ["income", w.incomeMinor, pnl.income.total],
          ["cost of goods sold", w.costOfGoodsSoldMinor, pnl.costOfGoodsSold.total],
          ["net income", w.netIncomeMinor, pnl.netIncome],
        ];
        const disagree = checks.filter(([, got, want]) => got !== want).map(([label]) => label);
        console.log(
          `${c.name} [${preset}]: ${report.rows.length} ratios, ${report.rows.filter((r) => r.current !== null).length} with a value, ` +
            `inventory accounts ${inventory.accountIds.length} (${inventory.basis}), ` +
            `year-earlier ${report.earlier ? "shown" : "blank"}, ` +
            `${disagree.length === 0 ? "workings agree with the statements" : `DISAGREE on ${disagree.join(", ")}`}`,
        );
        for (const [label, got, want] of checks) expect(got, `${c.name} ${preset}: ${label}`).toBe(want);
        expect(w.inventoryMinor, `${c.name} ${preset}: inventory within current assets`).toBeLessThanOrEqual(w.currentAssetsMinor);
        expect(report.rows).toHaveLength(15);
      }
    }
  });

  it("Purchases and Inventory: the stock adds up in every fiscal year, and the last closing is the ledger balance", async () => {
    for (const c of companies) {
      const ctx = { today: c.today, fiscalStartMonth: c.fiscalStartMonth, firstEntryDate: c.first, lastEntryDate: c.last };
      const { from, to } = presetRange("all", ctx);
      const [report, inventory] = await Promise.all([getPurchasesInventory(c.sb, from, to), getInventoryAccounts(c.sb)]);
      const last = report.years.at(-1);
      let ledger: number | null = null;
      if (last) {
        const balances = await getLedgerBalances(c.sb, null, last.end);
        const ids = new Set(inventory.accountIds);
        ledger = balances.filter((b) => ids.has(b.accountId)).reduce((sum, b) => sum + (b.debitBase - b.creditBase), 0);
      }
      const supplierSum = report.supplierRows.reduce((sum, r) => sum + r.amountMinor, 0);
      console.log(
        `${c.name}: ${report.years.length} fiscal years, ${report.offByYears.length} off by, ` +
          `${report.purchases} purchase entries, ${report.suppliers} suppliers, ${report.months.length} months, ` +
          `${last ? (last.closingMinor === ledger ? "last closing agrees with the ledger" : "last closing DISAGREES with the ledger") : "no years"}, ` +
          `suppliers ${supplierSum === report.boughtMinor ? "agree" : "DISAGREE"} with the total`,
      );
      for (const y of report.years) expect(y.offByMinor, `${c.name} ${y.label}: off by`).toBe(0);
      if (last) expect(last.closingMinor, `${c.name}: last closing against the ledger`).toBe(ledger);
      expect(supplierSum, `${c.name}: suppliers add to the total`).toBe(report.boughtMinor);
    }
  });

  it("Sales Tax: the closing owed is the tax accounts' ledger balance, and gross sales is the Profit and Loss income", async () => {
    for (const c of companies) {
      const ctx = { today: c.today, fiscalStartMonth: c.fiscalStartMonth, firstEntryDate: c.first, lastEntryDate: c.last };
      for (const preset of ["year", "all"] as const) {
        const { from, to } = presetRange(preset, ctx);
        const [data, flow] = await Promise.all([getSalesTaxLiabilityData(c.sb, from, to), getLedgerBalances(c.sb, from, to)]);
        const income = buildProfitAndLoss(flow).income.total;
        for (const granularity of ["monthly", "quarterly", "yearly"] as const) {
          const report = buildSalesTaxLiability(data, granularity);
          expect(report.proof.agrees, `${c.name} ${preset} ${granularity}: closing owed against the ledger`).toBe(true);
          expect(report.total.grossMinor, `${c.name} ${preset} ${granularity}: gross sales against the P&L income`).toBe(income);
        }
        const report = buildSalesTaxLiability(data, "quarterly");
        console.log(
          `${c.name} [${preset}]: tax accounts by ${data.basis}, ${data.days.length} days with activity, ${report.periods.length} quarters, ` +
            `${report.proof.agrees ? "closing owed agrees with the ledger" : "closing owed DISAGREES with the ledger"}, ` +
            `${report.total.grossMinor === income ? "gross sales agree" : "gross sales DISAGREE"} with the P&L income, ` +
            `${data.unlinked.length} unlinked tax-like accounts`,
        );
      }
    }
  });

  it("Forecast: opening cash is the bank accounts' ledger balance, there are 13 weeks, and the open items add up", async () => {
    for (const c of companies) {
      const [data, balances, templates, bank] = await Promise.all([
        getCashForecast(c.sb, { today: c.today, baseCurrency: "USD" }),
        getLedgerBalances(c.sb, null, c.today),
        listActiveRecurringTemplates(c.sb),
        c.sb.from("acc_account").select("id").eq("account_type", "bank"),
      ]);
      const bankBalance = balances
        .filter((row) => row.accountType === "bank")
        .reduce((sum, row) => sum + row.debitBase - row.creditBase, 0);
      expect(data.openingMinor, `${c.name}: opening cash against the bank accounts' ledger balance`).toBe(bankBalance);
      for (const forecast of [data.due, data.usual]) {
        expect(forecast.weeks, `${c.name} ${forecast.mode}: weeks`).toHaveLength(13);
        expect(forecast.weeks[0].start, `${c.name} ${forecast.mode}: first week starts today`).toBe(c.today);
        expect(forecast.insideInMinor + forecast.beyondHorizonInMinor, `${c.name} ${forecast.mode}: receivables inside plus beyond`).toBe(
          forecast.totalOpenInMinor,
        );
        expect(forecast.insideOutMinor + forecast.beyondHorizonOutMinor, `${c.name} ${forecast.mode}: payables inside plus beyond`).toBe(
          forecast.totalOpenOutMinor,
        );
      }
      const openIn = data.openItems.filter((i) => i.side === "receivable").reduce((s, i) => s + i.balanceMinor, 0);
      expect(openIn, `${c.name}: open receivables against the forecast`).toBe(data.due.totalOpenInMinor);

      // The recurring figures in the weeks are exactly the occurrences the templates give.
      const bankIds = new Set(((bank.data ?? []) as { id: string }[]).map((r) => r.id));
      const horizonEnd = data.due.weeks[12].end;
      const again = expandRecurring({ templates, today: c.today, horizonEnd, bankAccountIds: bankIds, baseCurrency: "USD" });
      const inWeeks = data.due.weeks.reduce((s, w) => s + w.recurringMinor, 0);
      const fromTemplates = again.occurrences.reduce((s, o) => s + o.amountMinor, 0);
      expect(inWeeks, `${c.name}: recurring in the weeks against the templates' occurrences`).toBe(fromTemplates);
      expect(data.recurring.behindCount, `${c.name}: behind-schedule count`).toBe(
        templates.filter((t) => t.nextRunDate < c.today).length,
      );

      console.log(
        `${c.name}: ${data.due.weeks.length} weeks, ${data.openItems.length} open items ` +
          `(${data.due.insideInMinor + data.due.beyondHorizonInMinor === data.due.totalOpenInMinor ? "inside plus beyond agree" : "inside plus beyond DISAGREE"} with all open receivables), ` +
          `opening cash ${data.openingMinor === bankBalance ? "agrees" : "DISAGREES"} with the bank accounts, ` +
          `${templates.length} active templates, ${data.recurring.occurrences.length} occurrences, ${data.recurring.behindCount} behind schedule, ` +
          `${inWeeks === fromTemplates ? "recurring agrees" : "recurring DISAGREES"} with the templates`,
      );
    }
  });

  it("Budget vs Actual: the actual totals are the Profit and Loss, and the months add up to the range", async () => {
    for (const c of companies) {
      const fy = fiscalYearForDate(c.today, c.fiscalStartMonth);
      const months = fiscalMonths(fy, c.fiscalStartMonth);
      // The fiscal year to date: from its first month through the end of today's month.
      const current = months.find((m) => c.today >= m.start && c.today <= m.end) ?? months[11];
      const from = months[0].start;
      const to = current.end;
      const [report, balances] = await Promise.all([
        getBudgetVsActual(c.sb, fy, from, to),
        getLedgerBalances(c.sb, from, to),
      ]);
      const pnl = buildProfitAndLoss(balances);
      const sections = ["income", "costOfGoodsSold", "operatingExpenses", "otherIncome", "otherExpenses"] as const;
      for (const key of sections) {
        expect(report.actual[key].total, `${c.name}: actual ${key} against the Profit and Loss`).toBe(pnl[key].total);
      }
      expect(report.actual.netIncome, `${c.name}: actual net income against the Profit and Loss`).toBe(pnl.netIncome);

      // The lines: every account's actual is the Profit and Loss line, and every unbudgeted line is flagged.
      const pnlById = new Map(
        sections.flatMap((key) => pnl[key].lines).map((line) => [line.accountId, line.amount] as const),
      );
      const wrongLines = report.lines.filter((line) => line.current !== (pnlById.get(line.accountId) ?? 0));
      expect(wrongLines, `${c.name}: lines whose actual differs from the Profit and Loss`).toHaveLength(0);
      const unbudgeted = report.lines.filter((line) => !line.hasBudget && line.current !== 0).length;

      const monthCount = report.monthly.length;
      if (monthCount >= 2) {
        const actualSum = report.monthly.reduce((sum, m) => sum + m.actual, 0);
        const budgetSum = report.monthly.reduce((sum, m) => sum + m.budget, 0);
        expect(monthCount, `${c.name}: one row per month`).toBe(months.indexOf(current) + 1);
        expect(actualSum, `${c.name}: monthly actual results against the range's actual result`).toBe(report.actual.netIncome);
        expect(budgetSum, `${c.name}: monthly budgeted results against the range's budgeted result`).toBe(report.budget.netIncome);
      } else {
        expect(report.monthly, `${c.name}: a single month has no month-by-month table`).toHaveLength(0);
      }

      console.log(
        `${c.name}: ${report.lines.length} lines, ${unbudgeted} with an actual and no budget, ${monthCount} months, ` +
          `sections ${wrongLines.length === 0 ? "agree" : "DISAGREE"} with the Profit and Loss, ` +
          (monthCount >= 2 ? "monthly results agree with the range" : "single month, no monthly table"),
      );
    }
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

```bash
npx vitest run tests/unit/reports-wave1-catalog.test.ts
```

Expected: FAIL — the catalog does not have the new cards yet.

- [ ] **Step 4: Edit `ctyhp-accounting/lib/domain/report-catalog.ts`** — apply these 3 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 3 — find:

```ts
    id: "cash-flow-forecast",
    title: "Cash Flow Forecast",
    description: "Project receipts and payments over the next 13 weeks from open invoices and bills.",
    href: "/reports/cash-flow-forecast",
```

replace with:

```ts
    id: "cash-flow-forecast",
    title: "13 Week Cash Forecast",
    description: "Receipts and payments expected over the next thirteen weeks.",
    href: "/reports/cash-flow-forecast",
```

Edit 2 of 3 — find:

```ts
  {
    id: "what-if-analysis",
```

replace with:

```ts
  {
    id: "financial-ratios",
    title: "Financial Ratios",
    description: "Liquidity, leverage and margin, worked out from the statements.",
    href: "/reports/financial-ratios",
    group: "analysis",
  },
  {
    id: "what-if-analysis",
```

Edit 3 of 3 — find:

```ts
  {
    id: "sales-tax",
```

replace with:

```ts
  {
    id: "purchases-inventory",
    title: "Purchases and Inventory",
    description: "What was bought over the period and what is still in stock.",
    href: "/reports/purchases-inventory",
    group: "inventory-tax",
  },
  {
    id: "sales-tax-liability",
    title: "Sales Tax Liability",
    description: "Sales tax charged and paid, period by period.",
    href: "/reports/sales-tax-liability",
    group: "inventory-tax",
  },
  {
    id: "sales-tax",
```

- [ ] **Step 5: Edit `ctyhp-accounting/components/reports/ReportsHub.tsx`** — apply these 1 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 1 — find:

```tsx
  "voided-entries": <StopOutlined />,
};
```

replace with:

```tsx
  "voided-entries": <StopOutlined />,
  "financial-ratios": <PercentageOutlined />,
};
```

- [ ] **Step 6: Edit `ctyhp-accounting/lib/domain/changelog.ts`** — apply these 1 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 1 — find:

```ts
export const RELEASES: Release[] = [
  {
```

replace with:

```ts
export const RELEASES: Release[] = [
  {
    version: "1.95",
    date: "2026-10-09",
    headline:
      "Three new reports, a 13 Week Cash Forecast that starts from the cash you have, and a full-year budget grid.",
    changes: [
      {
        kind: "added",
        title: "Financial Ratios",
        detail:
          "In the Report Center under Analysis. Fifteen ratios for liquidity, leverage and margin, worked out from the Balance Sheet and the Profit and Loss, each next to the same dates a year earlier with a Change column. Under them, The figures behind them lists the totals every ratio was divided from, so you can check any one by hand. A ratio that cannot be worked out, such as one divided by zero, is left blank rather than shown as zero.",
        route: "/reports/financial-ratios",
      },
      {
        kind: "added",
        title: "Purchases and Inventory",
        detail:
          "In the Report Center under Inventory & Tax. A table by year: Opening stock plus Bought net of returns plus Count adjustment, less Cost of sales, comes to Closing stock, and the report says if a year is off. Below it, Who it was bought from, with each supplier’s share, and Month by month. Stock brought in on an opening-balance entry is not counted as bought.",
        route: "/reports/purchases-inventory",
      },
      {
        kind: "added",
        title: "Sales Tax Liability",
        detail:
          "In the Report Center under Inventory & Tax. What was collected, what was paid over and what is still owed, month by month, quarter by quarter or year by year (Monthly, Quarterly, Yearly). It is read from the entries themselves, and a proof line under the table says whether the amount owed agrees with the sales tax accounts. When something is owed, Record a payment opens the same payment dialog as the Sales Tax Center, and the report refreshes when you save. The Sales Tax Center now links to this report.",
        route: "/reports/sales-tax-liability",
      },
      {
        kind: "changed",
        title: "13 Week Cash Forecast replaces the Cash Flow Forecast",
        detail:
          "Same place in the Report Center, under Business Overview. The forecast now starts from the cash in the bank accounts today, where it used to start from zero, so its running figure reads differently from before. It also counts recurring templates that are due inside the thirteen weeks, and notes any template that is behind schedule. A switch chooses how customers and suppliers are expected to settle: By due date, or As they usually pay, which uses how late each one has paid in the past.",
        route: "/reports/cash-flow-forecast",
      },
      {
        kind: "changed",
        title: "Budget vs Actual: % of Budget, month by month, and a full-year grid",
        detail:
          "The report gains a % of Budget column (a dash for an account with no budget) and a Month by month table under the statement. Manage budget now opens the whole fiscal year as one grid instead of one month at a time. Type a figure in the Year column and it is spread evenly over the twelve months. Start from last year’s actuals or Start from this year’s actuals fills the grid from the books, with an Uplift percent added on top. Nothing is saved until you press Save, which writes only the months you changed.",
        route: "/reports?report=budget",
      },
    ],
  },
  {
```

- [ ] **Step 7: Edit `ctyhp-accounting/lib/domain/system-guide.ts`** — apply these 4 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 4 — find:

```ts
          "agrees with the receivables account. Sales by Customer adds up a period's income by customer.",
      },
    ],
  },
```

replace with:

```ts
          "agrees with the receivables account. Sales by Customer adds up a period's income by customer.",
      },
      {
        action: "Look ahead at the cash the next thirteen weeks should bring",
        control: "13 Week Cash Forecast",
        route: "/reports/cash-flow-forecast",
        note:
          "It starts from the cash on hand today, then adds what customers owe and takes off what is owed to " +
          "suppliers, week by week, plus recurring templates that fall due. By due date uses the dates on the " +
          "documents; As they usually pay moves each one by how late that customer or supplier has paid before.",
      },
    ],
  },
```

Edit 2 of 4 — find:

```ts
        note: "Valued at weighted average cost.",
      },
```

replace with:

```ts
        note: "Valued at weighted average cost.",
      },
      {
        action: "See what was bought, and that the stock adds up",
        control: "Purchases and Inventory",
        route: "/reports/purchases-inventory",
        note:
          "Year by year, Opening stock plus Bought net of returns plus Count adjustment, less Cost of sales, comes " +
          "to Closing stock; a year that does not is marked off by the difference. Who it was bought from and " +
          "Month by month follow the dates you pick.",
      },
    ],
  },
  {
    id: "budget",
    title: "Set a budget and compare it with the books",
    purpose: "Plan the year's income and spending, then see how the actual figures are tracking.",
    route: "/reports",
    steps: [
      {
        action: "Open the budget report",
        control: "Budget vs Actual",
        route: "/reports",
        note:
          "Pick the first and last period. Each line shows Actual, Budget, Over / Under and % of Budget; an " +
          "account with no budget shows a dash. A Month by month table sits under the statement.",
      },
      {
        action: "Open the whole year as one grid",
        control: "Manage budget",
        note:
          "Needs permission to manage the budget. Twelve month columns and a Year column for every account " +
          "with a budget; Add an account brings in more.",
      },
      {
        action: "Fill it from the books, or by hand",
        control: "Start from last year’s actuals",
        note:
          "Start from this year’s actuals does the same with the current year. Uplift adds a percentage on top " +
          "and may be negative. Typing a figure in a Year cell spreads it evenly over the twelve months. " +
          "Clear this year empties the grid.",
      },
      {
        action: "Save",
        control: "Save",
        note:
          "Nothing reaches the books until you press Save, which writes only the months you changed. If one " +
          "month fails, the others are kept and the notice names the month and the reason; Save tries the rest.",
      },
```

Edit 3 of 4 — find:

```ts
      {
        action: "Take the whole ledger as one plain-text file",
```

replace with:

```ts
      {
        action: "Read the year's ratios against the same dates a year earlier",
        control: "Financial Ratios",
        route: "/reports/financial-ratios",
        note:
          "Fifteen ratios for liquidity, leverage and margin, with the figures behind them listed underneath. " +
          "A ratio with nothing to divide by is left blank.",
      },
      {
        action: "Take the whole ledger as one plain-text file",
```

Edit 4 of 4 — find:

```ts
          "rather than an edit.",
      },
```

replace with:

```ts
          "rather than an edit.",
      },
      {
        action: "See what was collected, paid over and owed, period by period",
        control: "Sales Tax Liability by period",
        route: "/reports/sales-tax-liability",
        note:
          "Choose Monthly, Quarterly or Yearly. It is read from the entries, and a proof line says whether the " +
          "amount owed agrees with the tax accounts. Record a payment there opens the same dialog as above.",
      },
```

- [ ] **Step 8: Run the live check, alone and read-only**

```bash
node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/reports-wave2.live.ts --silent=false --reporter=verbose
```

Expected: 5 tests pass, each looping all six companies — ratio workings equal the Balance Sheet and Profit and Loss; purchases add up in every fiscal year and the last closing equals the inventory ledger; the closing sales tax owed equals the tax accounts' ledger and gross sales equals Profit and Loss income; forecast opening cash equals the bank ledger, 13 weeks, open items add up; Budget vs Actual actuals equal the Profit and Loss and the months add up. Run nothing else against the database while it runs. Report counts and agree/disagree only — no names or amounts.

- [ ] **Step 9: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/reports-wave1-catalog.test.ts" "tests/live/reports-wave2.live.ts" "lib/domain/report-catalog.ts" "components/reports/ReportsHub.tsx" "lib/domain/changelog.ts" "lib/domain/system-guide.ts"
npx vitest run tests/unit/reports-wave1-catalog.test.ts tests/unit/changelog.test.ts tests/unit/system-guide.test.ts tests/unit/report-catalog.test.ts tests/unit/navigation.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; reports-wave1-catalog + changelog + system-guide: 45 tests passing; report-catalog and navigation pass.

- [ ] **Step 10: Commit**

```bash
git add "ctyhp-accounting/tests/unit/reports-wave1-catalog.test.ts" "ctyhp-accounting/tests/live/reports-wave2.live.ts" "ctyhp-accounting/lib/domain/report-catalog.ts" "ctyhp-accounting/components/reports/ReportsHub.tsx" "ctyhp-accounting/lib/domain/changelog.ts" "ctyhp-accounting/lib/domain/system-guide.ts"
git commit -m "feat(reports): wave 2a in the Report Center, release 1.95 and the Guide"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 7: Controller — whole-branch gates, live check, smoke on the sample company, approval

**Files:** none changed by this task (scratch scripts live outside the repo).

**Interfaces:**
- Consumes: the whole branch.

- [ ] **Step 1: Whole-suite gates.** `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`, `npm run quality:budget`. Expected: tsc 0; lint 0 errors; every test file passes (two known load-sensitive timeouts — `chart-templates` and `quality-query-timing` — must pass when rerun alone); build compiles; 11/11 within budget.
- [ ] **Step 2: Live check** (`tests/live/reports-wave2.live.ts`, alone, read-only): 5/5 on six companies.
- [ ] **Step 3: Smoke and screenshots on PC-Test** with the pre-build smoke script against `next start` on a free port: every page runs with no console error, prints every row, the Sales Tax Center link and payment dialog open, the forecast switch works, the budget grid fits a 1440 window and saves on PC-Test only. Staff emails blurred in every screenshot (screen and print).
- [ ] **Step 4: Approval page** of the screenshots (light and dark) for the user. Nothing is pushed before the user approves.
- [ ] **Step 5: After approval** — scan the whole diff for real client data and secrets (separate command, read before pushing), check main has not moved (renumber the release up if it has), push the branch; the user opens the PR.
