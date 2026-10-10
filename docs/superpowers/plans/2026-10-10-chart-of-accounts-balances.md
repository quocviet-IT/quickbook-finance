# Chart of Accounts with Balances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship release 1.97. `/accounts` becomes the prototype's Chart of Accounts: one grouped list with a balance on every account. A Balances | Setup switch keeps today's setup columns. Clicking a balance opens the entries behind it through the existing QuickZoom and entry drawers.

**Architecture:**
- **Pure logic:**
  - `lib/domain/chart-groups.ts`: the fourteen groups, the natural sign, the ranges, the zoom spec and the lede.
  - `lib/domain/chart-list.ts`: the screen's rows, labels and widths.
  - `accountGroups()` in `account-sections.ts`: the code-ordered tree for any grouping.
- **Service and action:** the service `getChartBalances` reads `getLedgerBalances` twice: from the start of the books for balance sheet accounts, and from the fiscal year start for profit and loss accounts. The read-only action `chartBalancesAction` re-reads for another As of date.
- **Screen:** the page and `AccountsClient` render both modes, and mount `ZoomSheet` for the click-through.
- No migrations, and nothing writes.

**Tech Stack:**
- Next.js 16 App Router, React 19, Ant Design 6, Zod 4
- Supabase/PostgREST, one schema per company
- vitest

**Source of truth:**
- **Spec:** `docs/superpowers/specs/2026-10-10-chart-of-accounts-balances-design.md`, including its "Amendments from pre-building".
- **Code:** every file in this plan was first built and run on a local pre-build branch. There it passed:
  - typecheck, lint, unit tests (317 files), build and bundle budget;
  - the read-only live check on all six companies: every figure equals its ledger balance, and every non-zero figure's drill-down adds up;
  - a read-only smoke on the sample company PC-Test, light and dark.
- **How the code is given here:**
  - New files are given whole.
  - Edits to existing files are find/replace pairs that reproduce the pre-build exactly when applied in order.
  - A file rewritten by more than half is given whole.

**Do not "improve" the given code while transcribing it.** It has been verified against the real database and in a browser. If something looks wrong, stop and report it instead of changing it.

## Global Constraints

- **Copy:** US English, with names exactly as the spec gives them.
- **Money:** base-currency minor units.
- **Natural balance:** debit-normal accounts show debit less credit, and credit-normal accounts show credit less debit, by the account's own normal side (`accountNormalBalance(type, isContra)`). A negative figure is in parentheses, in the negative money colour.
- **Ranges:**
  - Balance sheet accounts: from the start of the books through As of.
  - Income, cost of sales and expense accounts: from the first day of the fiscal year containing As of through As of.
  - The drill-down opens the same range.
- **Dates:** in the company's time zone. Never use `new Date().toISOString()` for "today".
- **Reads:** every read pages past PostgREST's silent 1,000-row cap. `getLedgerBalances` and `getZoom` do; `getGeneralLedger` does not, so it is not used.
- **Tables:**
  - Every list goes through `DataTable` or `ReportTable`. Never import antd's `Table` in a screen.
  - No `scroll={{ x }}`. Columns fit the 1280 box.
  - No literal `pageSize` pinning.
- **JSX:** never put an HTML entity (`&apos;`, `&quot;`) right after an element. Keep typographic quotes and apostrophes (’ “ ”) exactly as given.
- **Server Components:** `page.tsx` never reads Ant Design sub-components.
- **Database:** read-only. Never run a script that writes, and never run the live test from an implementer task; the controller runs it.
- **Test data:** the repository is public, so tests use invented data only.
- **Commits:**
  - Stage files by name, never `git add -A` / `git add .`.
  - Never stage `.claude/settings.json`.
  - Use exactly `git commit -m "<message>"`, with NO Co-Authored-By trailer and no mention of Claude or AI.
- **Gates:**
  - Run them from `ctyhp-accounting/`.
  - If tsc complains about stale `.next/types`, delete `.next/types` and rerun.
  - Read the pass/fail lines in full; never pipe them through `tail` or `head`.

---

### Task 1: Chart groups, the balances service, the read-only action and the live check

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/chart-groups.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/account-sections.test.ts`
- Test (create): `ctyhp-accounting/tests/unit/chart-balances-service.test.ts`
- Modify: `ctyhp-accounting/lib/domain/account-sections.ts`
- Create: `ctyhp-accounting/lib/domain/chart-groups.ts`
- Create: `ctyhp-accounting/lib/services/chart-balances.ts`
- Modify: `ctyhp-accounting/app/(app)/accounts/actions.ts`
- Test (create): `ctyhp-accounting/tests/live/chart-balances.live.ts`

**Interfaces:**
- Consumes (existing): `accountNormalBalance`/`NormalBalance` (`lib/domain/accounts.ts`), `isBankSectionDetail` (`lib/domain/account-detail.ts`), `getInventoryAccounts` (`lib/services/inventory-accounts.ts`), `getLedgerBalances` (`lib/services/reports.ts`), `ZoomSpec` (`lib/domain/statement.ts`), `getZoom` (`lib/services/zoom.ts`, live check only), `shortDate` (`lib/domain/report-presets`), the actions' role guard.
- Produces:
  - `accountGroups(accounts, groups, groupOf)` in `lib/domain/account-sections.ts` (`accountSections` now delegates to it, unchanged).
  - `lib/domain/chart-groups.ts`: `ChartGroupKey`, `ChartClass`, `ChartStatement`, `CHART_GROUPS`, `chartGroupOf(account, inventoryAccountIds)`, `chartClassOf`, `statementOf`, `CHART_FILTERS`, `filterCounts`, `fiscalYearStartFor`, `chartRange`, `naturalBalanceMinor`, `chartFigures`, `chartZoomSpec`, `chartLede`, `groupRangeLabel` — Task 2's screen uses them.
  - `getChartBalances(sb, asOf)` → `ChartBalances { asOf, fiscalYearStart, figures, inventoryAccountIds }` (`lib/services/chart-balances.ts`).
  - `chartBalancesAction(asOf)` → `ActionResult<ChartBalances>` in `app/(app)/accounts/actions.ts` (any signed-in role; read-only).
  - `tests/live/chart-balances.live.ts` (2 read-only checks over every company; run by the controller).

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/chart-groups.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/domain/accounts";
import {
  CHART_FILTERS,
  CHART_GROUPS,
  chartClassOf,
  chartFigures,
  chartGroupOf,
  chartLede,
  chartRange,
  chartZoomSpec,
  filterCounts,
  fiscalYearStartFor,
  groupRangeLabel,
  naturalBalanceMinor,
  statementOf,
  type ChartGroupKey,
} from "@/lib/domain/chart-groups";

const none = new Set<string>();
const acct = (account_type: AccountType, detail_type: string | null = null, id = "a1") => ({ id, account_type, detail_type });

describe("the groups", () => {
  it("are the fourteen, in statement order", () => {
    expect(CHART_GROUPS.map((g) => g.title)).toEqual([
      "Bank and cash",
      "Receivables",
      "Inventory",
      "Other current assets",
      "Long-term assets",
      "Credit cards",
      "Payables",
      "Other current liabilities",
      "Long-term liabilities",
      "Equity",
      "Income",
      "Cost of sales",
      "Expenses",
      "Other expenses",
    ]);
  });

  it("put profit and loss groups on the profit and loss statement and the rest on the balance sheet", () => {
    const pnl = CHART_GROUPS.filter((g) => g.statement === "profit_and_loss").map((g) => g.key);
    expect(pnl).toEqual(["income", "cost_of_sales", "expenses", "other_expenses"]);
  });

  it("place every account type", () => {
    const expected: Record<AccountType, ChartGroupKey> = {
      bank: "bank_cash",
      accounts_receivable: "receivables",
      current_asset: "other_current_assets",
      fixed_asset: "long_term_assets",
      accounts_payable: "payables",
      credit_card: "credit_cards",
      current_liability: "other_current_liabilities",
      long_term_liability: "long_term_liabilities",
      equity: "equity",
      income: "income",
      cost_of_goods_sold: "cost_of_sales",
      expense: "expenses",
      other_income: "income",
      other_expense: "other_expenses",
    };
    for (const type of ACCOUNT_TYPES) expect(chartGroupOf(acct(type), none), type).toBe(expected[type]);
  });

  it("put an inventory-set current asset under Inventory", () => {
    expect(chartGroupOf(acct("current_asset", null, "inv"), new Set(["inv"]))).toBe("inventory");
    expect(chartGroupOf(acct("current_asset", null, "other"), new Set(["inv"]))).toBe("other_current_assets");
  });

  it("put money in transit under Bank and cash", () => {
    expect(chartGroupOf(acct("current_asset", "undeposited_funds"), none)).toBe("bank_cash");
    expect(chartGroupOf(acct("current_asset", "transfer_clearing"), none)).toBe("bank_cash");
  });

  it("let Inventory win only when the account is in the inventory set", () => {
    expect(chartGroupOf(acct("current_asset", "undeposited_funds", "x"), new Set(["x"]))).toBe("inventory");
    expect(chartGroupOf(acct("current_asset", "undeposited_funds", "x"), new Set(["y"]))).toBe("bank_cash");
  });

  it("leave a non-current-asset type alone even if the inventory set names it", () => {
    expect(chartGroupOf(acct("fixed_asset", null, "x"), new Set(["x"]))).toBe("long_term_assets");
  });
});

describe("classes and statements", () => {
  it("fold other income into income, and cost of sales and other expenses into expenses", () => {
    expect(chartClassOf("other_income")).toBe("income");
    expect(chartClassOf("cost_of_goods_sold")).toBe("expense");
    expect(chartClassOf("expense")).toBe("expense");
    expect(chartClassOf("other_expense")).toBe("expense");
    expect(chartClassOf("bank")).toBe("asset");
    expect(chartClassOf("credit_card")).toBe("liability");
    expect(chartClassOf("equity")).toBe("equity");
  });

  it("agree with each group's own class", () => {
    const types: AccountType[] = [...ACCOUNT_TYPES];
    for (const type of types) {
      const group = CHART_GROUPS.find((g) => g.key === chartGroupOf(acct(type), none))!;
      expect(group.chartClass, type).toBe(chartClassOf(type));
      expect(group.statement, type).toBe(statementOf(type));
    }
  });

  it("put income, cost of sales and expenses on the profit and loss", () => {
    expect(statementOf("income")).toBe("profit_and_loss");
    expect(statementOf("other_expense")).toBe("profit_and_loss");
    expect(statementOf("equity")).toBe("balance_sheet");
    expect(statementOf("fixed_asset")).toBe("balance_sheet");
  });

  it("offer the six pills in order", () => {
    expect(CHART_FILTERS.map((f) => f.label)).toEqual(["All", "Assets", "Liabilities", "Equity", "Income", "Expenses"]);
  });

  it("count the accounts under each pill", () => {
    const counts = filterCounts([
      { account_type: "bank" },
      { account_type: "accounts_receivable" },
      { account_type: "credit_card" },
      { account_type: "equity" },
      { account_type: "income" },
      { account_type: "other_income" },
      { account_type: "cost_of_goods_sold" },
      { account_type: "expense" },
      { account_type: "other_expense" },
    ]);
    expect(counts).toEqual({ all: 9, asset: 2, liability: 1, equity: 1, income: 2, expense: 3 });
    expect(filterCounts([])).toEqual({ all: 0, asset: 0, liability: 0, equity: 0, income: 0, expense: 0 });
  });
});

describe("natural balance", () => {
  it("is debit less credit on a debit-normal account", () => {
    expect(naturalBalanceMinor(500_00, 120_00, "debit")).toBe(380_00);
  });

  it("is credit less debit on a credit-normal account", () => {
    expect(naturalBalanceMinor(120_00, 500_00, "credit")).toBe(380_00);
  });

  it("goes negative when the account is the wrong way round", () => {
    expect(naturalBalanceMinor(100_00, 300_00, "debit")).toBe(-200_00);
    expect(naturalBalanceMinor(300_00, 100_00, "credit")).toBe(-200_00);
  });
});

describe("the fiscal year", () => {
  it("starts on January 1 for a January fiscal year", () => {
    expect(fiscalYearStartFor("2026-10-10", 1)).toBe("2026-01-01");
    expect(fiscalYearStartFor("2026-01-01", 1)).toBe("2026-01-01");
    expect(fiscalYearStartFor("2026-12-31", 1)).toBe("2026-01-01");
  });

  it("starts in the earlier calendar year before a non-January start month", () => {
    expect(fiscalYearStartFor("2026-10-10", 4)).toBe("2026-04-01");
    expect(fiscalYearStartFor("2026-04-01", 4)).toBe("2026-04-01");
    expect(fiscalYearStartFor("2026-03-31", 4)).toBe("2025-04-01");
    expect(fiscalYearStartFor("2026-01-15", 4)).toBe("2025-04-01");
  });

  it("gives a balance sheet account all history, and a profit and loss account the year to date", () => {
    expect(chartRange("balance_sheet", "2026-10-10", 4)).toEqual({ from: null, to: "2026-10-10" });
    expect(chartRange("profit_and_loss", "2026-10-10", 4)).toEqual({ from: "2026-04-01", to: "2026-10-10" });
    expect(chartRange("profit_and_loss", "2026-02-10", 4)).toEqual({ from: "2025-04-01", to: "2026-02-10" });
    expect(chartRange("profit_and_loss", "2026-10-10", 1)).toEqual({ from: "2026-01-01", to: "2026-10-10" });
  });
});

describe("chartFigures", () => {
  const accounts = [
    { id: "bank", account_type: "bank" as const, is_contra: false },
    { id: "payable", account_type: "accounts_payable" as const, is_contra: false },
    { id: "accum", account_type: "fixed_asset" as const, is_contra: true },
    { id: "sales", account_type: "income" as const, is_contra: false },
    { id: "rent", account_type: "expense" as const, is_contra: false },
    { id: "idle", account_type: "expense" as const, is_contra: false },
  ];
  const sheet = [
    { accountId: "bank", debitBase: 900_00, creditBase: 400_00 },
    { accountId: "payable", debitBase: 50_00, creditBase: 250_00 },
    { accountId: "accum", debitBase: 0, creditBase: 80_00 },
    // Not read: sales is profit and loss, so only the year-to-date ledger counts.
    { accountId: "sales", debitBase: 0, creditBase: 99_999_00 },
  ];
  const pnl = [
    { accountId: "sales", debitBase: 0, creditBase: 700_00 },
    { accountId: "rent", debitBase: 30_00, creditBase: 90_00 },
    // Not read: bank is balance sheet.
    { accountId: "bank", debitBase: 1_00, creditBase: 0 },
  ];

  it("reads each account from the ledger of its own statement", () => {
    const figures = chartFigures(accounts, sheet, pnl);
    expect(figures.bank).toBe(500_00);
    expect(figures.payable).toBe(200_00);
    expect(figures.sales).toBe(700_00);
  });

  it("treats a contra account's normal side as the opposite", () => {
    expect(chartFigures(accounts, sheet, pnl).accum).toBe(80_00);
  });

  it("shows a wrong-way balance as negative", () => {
    expect(chartFigures(accounts, sheet, pnl).rent).toBe(-60_00);
  });

  it("gives an account missing from its ledger zero", () => {
    expect(chartFigures(accounts, sheet, pnl).idle).toBe(0);
    expect(chartFigures(accounts, [], [])).toEqual({ bank: 0, payable: 0, accum: 0, sales: 0, rent: 0, idle: 0 });
  });
});

describe("chartZoomSpec", () => {
  it("opens the one account over its range with the figure shown", () => {
    expect(
      chartZoomSpec({ id: "a1", account_code: "6100", name: "Rent" }, { from: "2026-04-01", to: "2026-10-10" }, -60_00),
    ).toEqual({
      title: "6100 Rent",
      accountIds: ["a1"],
      from: "2026-04-01",
      to: "2026-10-10",
      figure: -60_00,
    });
  });

  it("keeps a null from for a balance sheet account", () => {
    const spec = chartZoomSpec({ id: "a2", account_code: "1000", name: "Checking" }, { from: null, to: "2026-10-10" }, 5);
    expect(spec.from).toBeNull();
  });
});

describe("the lede and the range label", () => {
  it("reads in the plural", () => {
    expect(chartLede(45, 28, "2026-10-10")).toBe("45 accounts, 28 carrying a balance at Oct 10, 2026.");
    expect(chartLede(0, 0, "2026-10-10")).toBe("0 accounts, 0 carrying a balance at Oct 10, 2026.");
  });

  it("reads in the singular", () => {
    expect(chartLede(1, 1, "2026-01-05")).toBe("1 account, 1 carrying a balance at Jan 5, 2026.");
  });

  it("names the year to date", () => {
    expect(groupRangeLabel("2026-01-01")).toBe("Year to date, from Jan 1, 2026");
    expect(groupRangeLabel("2025-04-01")).toBe("Year to date, from Apr 1, 2025");
  });
});
```

- [ ] **Step 2: Edit `ctyhp-accounting/tests/unit/account-sections.test.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
  ACCOUNT_SECTIONS,
  accountSections,
```

replace with:

```ts
  ACCOUNT_SECTIONS,
  accountGroups,
  accountSections,
```

Edit 2 of 2 — find:

```ts

describe("account-sections module", () => {
```

replace with:

```ts

describe("accountGroups", () => {
  const groups = [
    { key: "big", title: "Big" },
    { key: "small", title: "Small" },
    { key: "none", title: "Empty" },
  ] as const;
  const byCode = (a: SectionAccount) => (Number(a.account_code) >= 2000 ? "small" : "big");

  it("groups by any function, in the order given, dropping empty groups", () => {
    const out = accountGroups(
      [acc("b", "2100", "expense"), acc("a", "1000", "bank"), acc("c", "1500", "bank")],
      groups,
      (a) => byCode(a) as "big" | "small" | "none",
    );
    expect(out.map((g) => g.key)).toEqual(["big", "small"]);
    expect(out[0].rows.map((r) => r.account.id)).toEqual(["a", "c"]);
    expect(out[1].rows.map((r) => r.account.id)).toEqual(["b"]);
  });

  it("nests a sub-account only under a parent in the same group", () => {
    const out = accountGroups(
      [
        acc("p", "1000", "bank"),
        acc("same", "1010", "bank", "p"),
        acc("other", "2010", "bank", "p"),
      ],
      groups,
      (a) => byCode(a) as "big" | "small" | "none",
    );
    expect(out[0].rows.map((r) => [r.account.id, r.depth])).toEqual([
      ["p", 0],
      ["same", 1],
    ]);
    expect(out[1].rows.map((r) => [r.account.id, r.depth])).toEqual([["other", 0]]);
  });
});

describe("account-sections module", () => {
```

- [ ] **Step 3: Create `ctyhp-accounting/tests/unit/chart-balances-service.test.ts`** with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getChartBalances } from "@/lib/services/chart-balances";

const ledgerRow = (id: string, debit: number, credit: number) => ({
  account_id: id,
  account_code: id,
  name: id,
  account_type: "bank",
  debit_base: debit,
  credit_base: credit,
});

/** A client whose tables hold the given rows and whose ledger answers by the range asked for. */
function fakeClient(opts: {
  startMonth: number | null;
  accounts: { id: string; name?: string; account_type: string; is_contra: boolean; cash_flow_role?: string | null }[];
  ledger: (from: string | null) => Record<string, unknown>[];
}) {
  const rpc = vi.fn((name: string, args: { p_from: string | null; p_to: string }) => ({
    range: async () => ({ data: name === "acc_ledger_balances" ? opts.ledger(args.p_from) : [], error: null }),
  }));
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "order", "limit"]) builder[m] = () => builder;
    builder.range = async () => ({ data: table === "acc_account" ? opts.accounts : [], error: null });
    builder.maybeSingle = async () => ({
      data: opts.startMonth === null ? null : { fiscal_year_start_month: opts.startMonth, time_zone: "UTC" },
      error: null,
    });
    return builder;
  });
  return { sb: { from, rpc } as unknown as SupabaseClient, rpc };
}

const accounts = [
  { id: "bank", account_type: "bank", is_contra: false },
  { id: "sales", account_type: "income", is_contra: false },
  { id: "rent", account_type: "expense", is_contra: false },
  { id: "stock", name: "Inventory", account_type: "current_asset", is_contra: false },
];

describe("getChartBalances", () => {
  it("reads balance sheet accounts from the full history and profit and loss from the fiscal year start", async () => {
    const { sb, rpc } = fakeClient({
      startMonth: 4,
      accounts,
      ledger: (from) =>
        from === null
          ? [ledgerRow("bank", 900_00, 400_00), ledgerRow("sales", 0, 9_000_00), ledgerRow("stock", 70_00, 0)]
          : [ledgerRow("sales", 0, 600_00), ledgerRow("rent", 80_00, 20_00), ledgerRow("bank", 5_00, 0)],
    });

    const out = await getChartBalances(sb, "2026-10-10");

    expect(rpc).toHaveBeenCalledWith("acc_ledger_balances", { p_from: null, p_to: "2026-10-10" });
    expect(rpc).toHaveBeenCalledWith("acc_ledger_balances", { p_from: "2026-04-01", p_to: "2026-10-10" });
    expect(out.asOf).toBe("2026-10-10");
    expect(out.fiscalYearStart).toBe("2026-04-01");
    expect(out.figures).toEqual({ bank: 500_00, sales: 600_00, rent: 60_00, stock: 70_00 });
  });

  it("uses the earlier calendar year when the date falls before the fiscal start month", async () => {
    const { sb, rpc } = fakeClient({ startMonth: 7, accounts, ledger: () => [] });
    const out = await getChartBalances(sb, "2026-02-01");
    expect(out.fiscalYearStart).toBe("2025-07-01");
    expect(rpc).toHaveBeenCalledWith("acc_ledger_balances", { p_from: "2025-07-01", p_to: "2026-02-01" });
  });

  it("starts the fiscal year in January when the company has no settings", async () => {
    const { sb } = fakeClient({ startMonth: null, accounts, ledger: () => [] });
    const out = await getChartBalances(sb, "2026-10-10");
    expect(out.fiscalYearStart).toBe("2026-01-01");
    expect(out.figures).toEqual({ bank: 0, sales: 0, rent: 0, stock: 0 });
  });

  it("returns the inventory accounts the shared rule picks", async () => {
    const { sb } = fakeClient({ startMonth: 1, accounts, ledger: () => [] });
    const out = await getChartBalances(sb, "2026-10-10");
    expect(out.inventoryAccountIds).toEqual(["stock"]);
  });
});
```

- [ ] **Step 4: Run the tests to see them fail**

```bash
npx vitest run tests/unit/chart-groups.test.ts tests/unit/account-sections.test.ts tests/unit/chart-balances-service.test.ts
```

Expected: FAIL — `lib/domain/chart-groups.ts`, `accountGroups` and `lib/services/chart-balances.ts` do not exist yet.

- [ ] **Step 5: Edit `ctyhp-accounting/lib/domain/account-sections.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts

/** The sections that have accounts, in order, each as a tree in code order. */
```

replace with:

```ts

/**
 * The groups that have accounts, in the order given, each as a tree in code
 * order. A sub-account nests under its parent only when both are in the same
 * group; otherwise it stands at the top of its own group.
 */
export function accountGroups<T extends SectionAccount, K extends string>(
  accounts: readonly T[],
  groups: readonly { key: K; title: string }[],
  groupOf: (account: T) => K,
): { key: K; title: string; rows: AccountTreeRow<T>[] }[] {
  const byGroup = new Map<K, T[]>();
  for (const a of accounts) {
    const key = groupOf(a);
    const list = byGroup.get(key) ?? [];
    list.push(a);
    byGroup.set(key, list);
  }
  return groups.flatMap(({ key, title }) => {
    const members = byGroup.get(key);
    return members && members.length > 0 ? [{ key, title, rows: treeRows(members) }] : [];
  });
}

/** The sections that have accounts, in order, each as a tree in code order. */
```

Edit 2 of 2 — find:

```ts
export function accountSections<T extends SectionAccount>(accounts: readonly T[]): AccountSection<T>[] {
  const bySection = new Map<AccountSectionKey, T[]>();
  for (const a of accounts) {
    const key = sectionOf(a);
    const list = bySection.get(key) ?? [];
    list.push(a);
    bySection.set(key, list);
  }
  return ACCOUNT_SECTIONS.flatMap(({ key, title }) => {
    const members = bySection.get(key);
    return members && members.length > 0 ? [{ key, title, rows: treeRows(members) }] : [];
  });
}
```

replace with:

```ts
export function accountSections<T extends SectionAccount>(accounts: readonly T[]): AccountSection<T>[] {
  return accountGroups(accounts, ACCOUNT_SECTIONS, sectionOf);
}
```

- [ ] **Step 6: Create `ctyhp-accounting/lib/domain/chart-groups.ts`** with exactly this content:

```ts
/**
 * The Chart of Accounts read with balances: the fourteen groups an account
 * falls under, the figure each account shows, and the range that figure covers.
 *
 * Pure: accounts and ledger rows in, groups and figures out. The old ten
 * `ACCOUNT_SECTIONS` stay for the new-company chart templates; this module is
 * what the `/accounts` page reads.
 */
import {
  accountNormalBalance,
  statementSectionOf,
  type AccountType,
  type NormalBalance,
} from "./accounts";
import { isBankSectionDetail } from "./account-detail";
import { fiscalYearForDate } from "./fiscal";
import { shortDate } from "./report-presets";
import type { ZoomSpec } from "./statement";

export type ChartGroupKey =
  | "bank_cash"
  | "receivables"
  | "inventory"
  | "other_current_assets"
  | "long_term_assets"
  | "credit_cards"
  | "payables"
  | "other_current_liabilities"
  | "long_term_liabilities"
  | "equity"
  | "income"
  | "cost_of_sales"
  | "expenses"
  | "other_expenses";

export type ChartClass = "asset" | "liability" | "equity" | "income" | "expense";
export type ChartStatement = "balance_sheet" | "profit_and_loss";

/** The groups in statement order. */
export const CHART_GROUPS: readonly {
  key: ChartGroupKey;
  title: string;
  chartClass: ChartClass;
  statement: ChartStatement;
}[] = [
  { key: "bank_cash", title: "Bank and cash", chartClass: "asset", statement: "balance_sheet" },
  { key: "receivables", title: "Receivables", chartClass: "asset", statement: "balance_sheet" },
  { key: "inventory", title: "Inventory", chartClass: "asset", statement: "balance_sheet" },
  { key: "other_current_assets", title: "Other current assets", chartClass: "asset", statement: "balance_sheet" },
  { key: "long_term_assets", title: "Long-term assets", chartClass: "asset", statement: "balance_sheet" },
  { key: "credit_cards", title: "Credit cards", chartClass: "liability", statement: "balance_sheet" },
  { key: "payables", title: "Payables", chartClass: "liability", statement: "balance_sheet" },
  { key: "other_current_liabilities", title: "Other current liabilities", chartClass: "liability", statement: "balance_sheet" },
  { key: "long_term_liabilities", title: "Long-term liabilities", chartClass: "liability", statement: "balance_sheet" },
  { key: "equity", title: "Equity", chartClass: "equity", statement: "balance_sheet" },
  { key: "income", title: "Income", chartClass: "income", statement: "profit_and_loss" },
  { key: "cost_of_sales", title: "Cost of sales", chartClass: "expense", statement: "profit_and_loss" },
  { key: "expenses", title: "Expenses", chartClass: "expense", statement: "profit_and_loss" },
  { key: "other_expenses", title: "Other expenses", chartClass: "expense", statement: "profit_and_loss" },
];

/**
 * The group an account is listed under. An inventory-set current asset is
 * Inventory even if its detail type reads as money in transit: Inventory wins,
 * and only when the account is in the inventory set.
 */
export function chartGroupOf(
  account: { id: string; account_type: AccountType; detail_type: string | null },
  inventoryAccountIds: ReadonlySet<string>,
): ChartGroupKey {
  switch (account.account_type) {
    case "bank":
      return "bank_cash";
    case "current_asset":
      if (inventoryAccountIds.has(account.id)) return "inventory";
      return isBankSectionDetail(account.detail_type) ? "bank_cash" : "other_current_assets";
    case "accounts_receivable":
      return "receivables";
    case "fixed_asset":
      return "long_term_assets";
    case "credit_card":
      return "credit_cards";
    case "accounts_payable":
      return "payables";
    case "current_liability":
      return "other_current_liabilities";
    case "long_term_liability":
      return "long_term_liabilities";
    case "equity":
      return "equity";
    case "income":
    case "other_income":
      return "income";
    case "cost_of_goods_sold":
      return "cost_of_sales";
    case "expense":
      return "expenses";
    case "other_expense":
      return "other_expenses";
  }
}

export function chartClassOf(type: AccountType): ChartClass {
  switch (type) {
    case "bank":
    case "accounts_receivable":
    case "current_asset":
    case "fixed_asset":
      return "asset";
    case "accounts_payable":
    case "credit_card":
    case "current_liability":
    case "long_term_liability":
      return "liability";
    case "equity":
      return "equity";
    case "income":
    case "other_income":
      return "income";
    case "cost_of_goods_sold":
    case "expense":
    case "other_expense":
      return "expense";
  }
}

export function statementOf(type: AccountType): ChartStatement {
  return statementSectionOf(type);
}

export const CHART_FILTERS: readonly { key: "all" | ChartClass; label: string }[] = [
  { key: "all", label: "All" },
  { key: "asset", label: "Assets" },
  { key: "liability", label: "Liabilities" },
  { key: "equity", label: "Equity" },
  { key: "income", label: "Income" },
  { key: "expense", label: "Expenses" },
];

export function filterCounts(
  accounts: readonly { account_type: AccountType }[],
): Record<"all" | ChartClass, number> {
  const counts: Record<"all" | ChartClass, number> = {
    all: accounts.length,
    asset: 0,
    liability: 0,
    equity: 0,
    income: 0,
    expense: 0,
  };
  for (const a of accounts) counts[chartClassOf(a.account_type)] += 1;
  return counts;
}

/** The first day of the fiscal year that contains `asOf`. */
export function fiscalYearStartFor(asOf: string, fiscalStartMonth: number): string {
  const year = fiscalYearForDate(asOf, fiscalStartMonth);
  return `${String(year).padStart(4, "0")}-${String(fiscalStartMonth).padStart(2, "0")}-01`;
}

/** Balance sheet accounts run from the start of the books; profit and loss from the fiscal year start. */
export function chartRange(
  statement: ChartStatement,
  asOf: string,
  fiscalStartMonth: number,
): { from: string | null; to: string } {
  return statement === "balance_sheet"
    ? { from: null, to: asOf }
    : { from: fiscalYearStartFor(asOf, fiscalStartMonth), to: asOf };
}

/** The balance on the account's own normal side; a negative figure is the wrong way round. */
export function naturalBalanceMinor(debitBase: number, creditBase: number, normal: NormalBalance): number {
  return normal === "debit" ? debitBase - creditBase : creditBase - debitBase;
}

interface LedgerSide {
  accountId: string;
  debitBase: number;
  creditBase: number;
}

/** Each account's figure, from the ledger that matches its statement; absent from it is 0. */
export function chartFigures(
  accounts: readonly { id: string; account_type: AccountType; is_contra: boolean }[],
  balanceSheetLedger: readonly LedgerSide[],
  profitAndLossLedger: readonly LedgerSide[],
): Record<string, number> {
  const index = (rows: readonly LedgerSide[]) => new Map(rows.map((r) => [r.accountId, r]));
  const sheet = index(balanceSheetLedger);
  const pnl = index(profitAndLossLedger);
  const figures: Record<string, number> = {};
  for (const a of accounts) {
    const row = (statementOf(a.account_type) === "balance_sheet" ? sheet : pnl).get(a.id);
    figures[a.id] = row
      ? naturalBalanceMinor(row.debitBase, row.creditBase, accountNormalBalance(a.account_type, a.is_contra))
      : 0;
  }
  return figures;
}

/** What clicking an account's figure opens. */
export function chartZoomSpec(
  account: { id: string; account_code: string; name: string },
  range: { from: string | null; to: string },
  figure: number,
): ZoomSpec {
  return {
    title: `${account.account_code} ${account.name}`,
    accountIds: [account.id],
    from: range.from,
    to: range.to,
    figure,
  };
}

/** "45 accounts, 28 carrying a balance at Oct 10, 2026." */
export function chartLede(total: number, withBalance: number, asOf: string): string {
  return `${total} ${total === 1 ? "account" : "accounts"}, ${withBalance} carrying a balance at ${shortDate(asOf)}.`;
}

/** "Year to date, from Jan 1, 2026" */
export function groupRangeLabel(fiscalYearStart: string): string {
  return `Year to date, from ${shortDate(fiscalYearStart)}`;
}
```

- [ ] **Step 7: Create `ctyhp-accounting/lib/services/chart-balances.ts`** with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "@/lib/domain/accounts";
import { chartFigures, fiscalYearStartFor } from "@/lib/domain/chart-groups";
import { readAllPages } from "./paging";
import { getCurrentCompanySettings } from "./company";
import { getInventoryAccounts } from "./inventory-accounts";
import { getLedgerBalances } from "./reports";

export class ChartBalancesError extends Error {}

/** What the Chart of Accounts shows beside each account. Reads only. */
export interface ChartBalances {
  asOf: string;
  /** The first day of the fiscal year containing `asOf`: where profit and loss figures begin. */
  fiscalYearStart: string;
  /** Natural balance in base-currency minor units, by account id. */
  figures: Record<string, number>;
  /** The accounts the Inventory group is made of. */
  inventoryAccountIds: string[];
}

/**
 * Every account's figure at `asOf`: balance sheet accounts from the start of
 * the books, profit and loss accounts from the fiscal year start. Both ledger
 * reads and the account read page past PostgREST's 1,000-row cap.
 */
export async function getChartBalances(sb: SupabaseClient, asOf: string): Promise<ChartBalances> {
  const settings = await getCurrentCompanySettings(sb);
  const fiscalYearStart = fiscalYearStartFor(asOf, settings?.fiscal_year_start_month ?? 1);
  const [accounts, inventory, sheet, pnl] = await Promise.all([
    readAllPages<{ id: string; account_type: AccountType; is_contra: boolean }>(
      (from, to) => sb.from("acc_account").select("id,account_type,is_contra").order("id").range(from, to),
      (message) => new ChartBalancesError(message),
    ),
    getInventoryAccounts(sb),
    getLedgerBalances(sb, null, asOf),
    getLedgerBalances(sb, fiscalYearStart, asOf),
  ]);
  return {
    asOf,
    fiscalYearStart,
    figures: chartFigures(accounts, sheet, pnl),
    inventoryAccountIds: inventory.accountIds,
  };
}
```

- [ ] **Step 8: Edit `ctyhp-accounting/app/(app)/accounts/actions.ts`** — apply these 3 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 3 — find:

```ts
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
```

replace with:

```ts
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
```

Edit 2 of 3 — find:

```ts
} from "@/lib/services/account-classification";

```

replace with:

```ts
} from "@/lib/services/account-classification";
import { getChartBalances, type ChartBalances } from "@/lib/services/chart-balances";

```

Edit 3 of 3 — find:

```ts

export async function setAccountStatusAction(id: string, status: unknown): Promise<ActionResult> {
```

replace with:

```ts

const asOfSchema = z.iso.date({ error: "Enter a valid date" });

/** Every account’s figure at a date, for the chart. Reads only; any signed-in role may call it. */
export async function chartBalancesAction(asOf: unknown): Promise<ActionResult<ChartBalances>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  const parsed = asOfSchema.safeParse(asOf);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid date" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getChartBalances(sb, parsed.data) };
  } catch (err) {
    return { ok: false, error: messageFrom(err) };
  }
}

export async function setAccountStatusAction(id: string, status: unknown): Promise<ActionResult> {
```

- [ ] **Step 9: Create `ctyhp-accounting/tests/live/chart-balances.live.ts`** with exactly this content:

```ts
/**
 * The Chart of Accounts balances, checked against every company's books — read-only.
 *
 * For every company the smoke user belongs to, at the company's today:
 *  (a) each account's chart figure equals its natural ledger balance over the
 *      right range (balance sheet: all history; profit and loss: fiscal year
 *      to date), recomputed here straight from `getLedgerBalances`;
 *  (b) for each account with a non-zero figure, the QuickZoom list for the
 *      chart's drill-down adds up to that figure.
 * Counts and agree/disagree are logged; names and amounts never are.
 * Nothing is written: every call is a select or a read-only RPC.
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/chart-balances.live.ts --silent=false --reporter=verbose
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import { accountNormalBalance, statementSectionOf } from "@/lib/domain/accounts";
import { chartRange, chartZoomSpec, fiscalYearStartFor } from "@/lib/domain/chart-groups";
import { listAccounts } from "@/lib/services/accounts";
import { getChartBalances } from "@/lib/services/chart-balances";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { getLedgerBalances } from "@/lib/services/reports";
import { getZoom } from "@/lib/services/zoom";

interface Company {
  name: string;
  sb: SupabaseClient;
  today: string;
  fiscalStartMonth: number;
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
    const settings = await getCurrentCompanySettings(sb);
    companies.push({
      name: row.schema_name,
      sb,
      today: todayInTimeZone(settings?.time_zone ?? "UTC"),
      fiscalStartMonth: settings?.fiscal_year_start_month ?? 1,
    });
  }
  if (companies.length === 0) throw new Error("The smoke user belongs to no company.");
});

describe("Chart of Accounts balances on every company's books", () => {
  it("every account's figure equals its natural ledger balance over the right range", async () => {
    for (const c of companies) {
      const [accounts, chart, sheet, pnl] = await Promise.all([
        listAccounts(c.sb),
        getChartBalances(c.sb, c.today),
        getLedgerBalances(c.sb, null, c.today),
        getLedgerBalances(c.sb, fiscalYearStartFor(c.today, c.fiscalStartMonth), c.today),
      ]);
      const sheetBy = new Map(sheet.map((b) => [b.accountId, b]));
      const pnlBy = new Map(pnl.map((b) => [b.accountId, b]));
      let disagree = 0;
      for (const a of accounts) {
        const row = (statementSectionOf(a.account_type) === "balance_sheet" ? sheetBy : pnlBy).get(a.id);
        const debit = row?.debitBase ?? 0;
        const credit = row?.creditBase ?? 0;
        const expected = accountNormalBalance(a.account_type, a.is_contra) === "debit" ? debit - credit : credit - debit;
        if (chart.figures[a.id] !== expected) disagree += 1;
      }
      console.log(`${c.name}: ${accounts.length} accounts, ${disagree === 0 ? "all figures agree" : `${disagree} DISAGREE`}`);
      expect(disagree, c.name).toBe(0);
    }
  });

  it("every non-zero figure's drill-down adds up to it", async () => {
    for (const c of companies) {
      const [accounts, chart] = await Promise.all([listAccounts(c.sb), getChartBalances(c.sb, c.today)]);
      let checked = 0;
      let disagree = 0;
      for (const a of accounts) {
        const figure = chart.figures[a.id] ?? 0;
        if (figure === 0) continue;
        const range = chartRange(statementSectionOf(a.account_type), c.today, c.fiscalStartMonth);
        const zoom = await getZoom(c.sb, chartZoomSpec(a, range, figure));
        checked += 1;
        if (!zoom.matches) disagree += 1;
      }
      console.log(`${c.name}: ${checked} drill-downs, ${disagree === 0 ? "all add up" : `${disagree} DO NOT add up`}`);
      expect(disagree, c.name).toBe(0);
    }
  });
});
```

- [ ] **Step 10: Do not run the live check**

`tests/live/chart-balances.live.ts` reads every company's real books. The controller runs it alone in Task 4. Do not run it here, and run nothing else that connects to the database.

- [ ] **Step 11: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/chart-groups.test.ts" "tests/unit/account-sections.test.ts" "tests/unit/chart-balances-service.test.ts" "lib/domain/account-sections.ts" "lib/domain/chart-groups.ts" "lib/services/chart-balances.ts" "app/(app)/accounts/actions.ts" "tests/live/chart-balances.live.ts"
npx vitest run tests/unit/chart-groups.test.ts tests/unit/account-sections.test.ts tests/unit/chart-balances-service.test.ts tests/unit/chart-templates.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; chart-groups + account-sections + chart-balances-service: 44 tests passing; chart-templates (11 tests) passes unchanged.

- [ ] **Step 12: Commit**

```bash
git add "ctyhp-accounting/tests/unit/chart-groups.test.ts" "ctyhp-accounting/tests/unit/account-sections.test.ts" "ctyhp-accounting/tests/unit/chart-balances-service.test.ts" "ctyhp-accounting/lib/domain/account-sections.ts" "ctyhp-accounting/lib/domain/chart-groups.ts" "ctyhp-accounting/lib/services/chart-balances.ts" "ctyhp-accounting/app/(app)/accounts/actions.ts" "ctyhp-accounting/tests/live/chart-balances.live.ts"
git commit -m "feat(accounts): chart groups, balances service and read-only action"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 2: The Chart of Accounts screen, and QuickZoom's line count

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/accounts-screen.test.ts`
- Create: `ctyhp-accounting/lib/domain/chart-list.ts`
- Modify: `ctyhp-accounting/app/(app)/accounts/accounts.module.css`
- Modify: `ctyhp-accounting/app/(app)/accounts/AccountsClient.tsx`
- Modify: `ctyhp-accounting/app/(app)/accounts/page.tsx`
- Modify: `ctyhp-accounting/components/reports/ZoomSheet.tsx`

**Interfaces:**
- Consumes: everything Task 1 produces (names above); existing `ZoomSheet` and `EntryDetailDrawer`, `DataTable`/`ReportTable`, `FilterBar`, `PageHeader`, `companyClock`, `listAccounts`, `withAncestors`, `parentChoices`, the account edit modal and actions.
- Produces: the redesigned `/accounts` page — Balances (default) and Setup (`?view=setup`, written with `history.replaceState`), type pills with counts, search, As of, one list in the fourteen groups with pinned group headings, a balance column whose figures open `ZoomSheet`; `lib/domain/chart-list.ts` (the screen's pure helpers, e.g. `chartViewHref`, `openAccountLabel`, `chartFigureText`, `chartFigureSpoken`, and the fixed column widths the screen test checks); QuickZoom's total line says "1 line" for one line.

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/accounts-screen.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import { TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";
import {
  ACCOUNT_FLOOR,
  BALANCES_FIXED_WIDTHS,
  SETUP_FIXED_WIDTHS,
} from "@/app/(app)/accounts/AccountsClient";
import type { AccountType } from "@/lib/domain/accounts";
import { chartRange, chartZoomSpec, fiscalYearStartFor } from "@/lib/domain/chart-groups";
import {
  accountsInView,
  chartFigureSpoken,
  chartFigureText,
  chartListing,
  chartViewHref,
  chartViewOf,
  fiscalStartMonthOf,
  isRetired,
  matchesAccountSearch,
  openAccountLabel,
  type ChartListOptions,
  type ChartListRow,
} from "@/lib/domain/chart-list";

interface TestAccount {
  id: string;
  account_code: string;
  name: string;
  account_type: AccountType;
  detail_type: string | null;
  parent_account_id: string | null;
  status: string;
  cash_flow_role: string;
}

/** Invented accounts only. */
function account(
  id: string,
  code: string,
  name: string,
  type: AccountType,
  extra: Partial<TestAccount> = {},
): TestAccount {
  return {
    id,
    account_code: code,
    name,
    account_type: type,
    detail_type: null,
    parent_account_id: null,
    status: "active",
    cash_flow_role: "operating",
    ...extra,
  };
}

const CHART: TestAccount[] = [
  account("cash", "1000", "Petty Cash", "bank"),
  account("bank", "1010", "Harbor Checking", "bank"),
  account("ar", "1100", "Accounts Receivable", "accounts_receivable"),
  account("stock", "1200", "Stock on Hand", "current_asset"),
  account("prepaid", "1300", "Prepaid Rent", "current_asset"),
  account("old", "1310", "Old Deposit", "current_asset", { status: "inactive" }),
  account("kept", "1320", "Closed Escrow", "current_asset", { status: "inactive" }),
  account("ap", "2000", "Accounts Payable", "accounts_payable"),
  account("card", "2050", "Example Card", "credit_card"),
  account("equity", "3000", "Owner Equity", "equity"),
  account("sales", "4000", "Sales", "income"),
  account("sales-web", "4010", "Web Sales", "income", { parent_account_id: "sales" }),
  account("interest", "7000", "Interest Earned", "other_income", { cash_flow_role: "unclassified" }),
  account("cogs", "5000", "Cost of Goods Sold", "cost_of_goods_sold"),
  account("rent", "6100", "Rent Expense", "expense"),
  account("fees", "8100", "Bank Fees", "other_expense", { status: "archived" }),
];

const FIGURES: Record<string, number> = {
  cash: 12_500,
  bank: 1_250_000,
  ar: 300_000,
  stock: 0,
  prepaid: 60_000,
  old: 0,
  kept: -4_000,
  ap: 210_000,
  card: 0,
  equity: 500_000,
  sales: 900_000,
  "sales-web": 150_000,
  cogs: 400_000,
  rent: 120_000,
};

function options(patch: Partial<ChartListOptions<TestAccount>> = {}): ChartListOptions<TestAccount> {
  return {
    figures: FIGURES,
    inventoryAccountIds: new Set(["stock"]),
    view: "balances",
    search: "",
    filter: "all",
    ...patch,
  };
}

const headings = (rows: ChartListRow<TestAccount>[]) =>
  rows.flatMap((r) => (r.kind === "group" ? [`${r.title} (${r.count})`] : []));
const codes = (rows: ChartListRow<TestAccount>[]) =>
  rows.flatMap((r) => (r.kind === "account" ? [`${"  ".repeat(r.depth)}${r.account.account_code}`] : []));

describe("table fit", () => {
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

  it("fits Balances at a 1280px window", () => {
    expect(fitsBox(sum(BALANCES_FIXED_WIDTHS), ACCOUNT_FLOOR)).toBe(true);
  });

  it("fits Setup at a 1280px window, with the action buttons", () => {
    expect(fitsBox(sum(SETUP_FIXED_WIDTHS), ACCOUNT_FLOOR)).toBe(true);
  });

  it("measures against the 984px box, with an account column no narrower than its floor", () => {
    expect(TABLE_BOX_AT_1280).toBe(984);
    expect(ACCOUNT_FLOOR).toBeGreaterThanOrEqual(200);
    expect(TABLE_BOX_AT_1280 - sum(SETUP_FIXED_WIDTHS)).toBeGreaterThanOrEqual(ACCOUNT_FLOOR);
  });
});

describe("the view in the address", () => {
  it("opens Setup only for view=setup", () => {
    expect(chartViewOf("setup")).toBe("setup");
    expect(chartViewOf(["setup", "balances"])).toBe("setup");
    expect(chartViewOf(undefined)).toBe("balances");
    expect(chartViewOf(null)).toBe("balances");
    expect(chartViewOf("balances")).toBe("balances");
    expect(chartViewOf("Setup")).toBe("balances");
    expect(chartViewOf("anything")).toBe("balances");
  });

  it("writes Setup into the address and leaves Balances out of it", () => {
    expect(chartViewHref("setup")).toBe("/accounts?view=setup");
    expect(chartViewHref("balances")).toBe("/accounts");
    expect(chartViewOf(new URL(chartViewHref("setup"), "https://example.test").searchParams.get("view"))).toBe("setup");
  });
});

describe("which accounts a view lists", () => {
  it("counts inactive and archived accounts as out of use, and nothing else", () => {
    expect(isRetired("inactive")).toBe(true);
    expect(isRetired("archived")).toBe(true);
    expect(isRetired("active")).toBe(false);
    expect(isRetired("draft")).toBe(false);
  });

  it("hides an inactive account with nothing in it from Balances, and keeps one that still holds money", () => {
    const ids = accountsInView(CHART, FIGURES, "balances").map((a) => a.id);
    expect(ids).not.toContain("old");
    expect(ids).not.toContain("fees");
    expect(ids).toContain("kept");
    // An active account with a zero balance is still listed.
    expect(ids).toContain("card");
    expect(ids).toHaveLength(CHART.length - 2);
  });

  it("lists every account in Setup", () => {
    expect(accountsInView(CHART, FIGURES, "setup")).toHaveLength(CHART.length);
  });
});

describe("search", () => {
  it("matches the code or the name, ignoring case and outer spaces", () => {
    const sales = CHART.find((a) => a.id === "sales")!;
    expect(matchesAccountSearch(sales, "40")).toBe(true);
    expect(matchesAccountSearch(sales, "  SALES ")).toBe(true);
    expect(matchesAccountSearch(sales, "rent")).toBe(false);
    expect(matchesAccountSearch(sales, "")).toBe(true);
  });
});

describe("the listing", () => {
  it("draws each group with accounts under its heading, in statement order, and no empty group", () => {
    const { rows } = chartListing(CHART, options());
    expect(headings(rows)).toEqual([
      "Bank and cash (2)",
      "Receivables (1)",
      "Inventory (1)",
      "Other current assets (2)",
      "Credit cards (1)",
      "Payables (1)",
      "Equity (1)",
      "Income (3)",
      "Cost of sales (1)",
      "Expenses (1)",
    ]);
    expect(rows[0]).toMatchObject({ kind: "group", group: "bank_cash", statement: "balance_sheet", key: "group:bank_cash" });
    const income = rows.find((r) => r.kind === "group" && r.group === "income");
    expect(income).toMatchObject({ statement: "profit_and_loss" });
  });

  it("nests a sub-account under its parent, in code order", () => {
    const { rows } = chartListing(CHART, options());
    const codesInIncome = codes(rows).filter((c) => c.trim().startsWith("4") || c.trim().startsWith("7"));
    expect(codesInIncome).toEqual(["4000", "  4010", "7000"]);
  });

  it("keys every row uniquely, so a group heading never collides with an account", () => {
    const { rows } = chartListing(CHART, options({ view: "setup" }));
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("gives the lede every listed account and the ones carrying a balance", () => {
    const balances = chartListing(CHART, options());
    expect(balances.total).toBe(CHART.length - 2);
    // cash, bank, ar, prepaid, kept, ap, equity, sales, sales-web, cogs, rent
    expect(balances.withBalance).toBe(11);
    const setup = chartListing(CHART, options({ view: "setup" }));
    expect(setup.total).toBe(CHART.length);
    expect(setup.withBalance).toBe(11);
  });

  it("counts the pills from what the search found, before the pill narrows it", () => {
    const all = chartListing(CHART, options());
    expect(all.counts).toEqual({ all: 14, asset: 6, liability: 2, equity: 1, income: 3, expense: 2 });

    const searched = chartListing(CHART, options({ search: "sales", filter: "expense" }));
    expect(searched.counts).toEqual({ all: 2, asset: 0, liability: 0, equity: 0, income: 2, expense: 0 });
    expect(searched.matched).toBe(0);
    expect(searched.rows).toEqual([]);
  });

  it("narrows to one class with a pill", () => {
    const { rows, matched } = chartListing(CHART, options({ filter: "liability" }));
    expect(matched).toBe(2);
    expect(headings(rows)).toEqual(["Credit cards (1)", "Payables (1)"]);
  });

  it("keeps the parent of a matching sub-account, so the match reads in its place", () => {
    const { rows, matched } = chartListing(CHART, options({ search: "web" }));
    expect(matched).toBe(1);
    expect(codes(rows)).toEqual(["4000", "  4010"]);
    expect(headings(rows)).toEqual(["Income (2)"]);
  });

  it("stands a sub-account at the top of its own group when the parent is in another", () => {
    const chart = [
      account("float", "1050", "Card Float", "current_asset", { parent_account_id: "bank", detail_type: "undeposited_funds" }),
      account("bank", "1010", "Harbor Checking", "bank"),
      account("deposit", "1060", "Rent Deposit", "current_asset", { parent_account_id: "bank" }),
    ];
    const { rows } = chartListing(chart, options({ figures: {} }));
    expect(codes(rows)).toEqual(["1010", "  1050", "1060"]);
    expect(headings(rows)).toEqual(["Bank and cash (2)", "Other current assets (1)"]);
  });

  it("applies a further narrowing, such as Setup's cash flow role, with the search", () => {
    const { rows, matched, counts } = chartListing(CHART, {
      ...options({ view: "setup" }),
      keep: (a) => a.cash_flow_role === "unclassified",
    });
    expect(matched).toBe(1);
    expect(counts.all).toBe(1);
    expect(codes(rows)).toEqual(["7000"]);
  });

  it("finds an inactive account in Balances only while it carries a balance", () => {
    expect(chartListing(CHART, options({ search: "old deposit" })).matched).toBe(0);
    expect(chartListing(CHART, options({ search: "closed escrow" })).matched).toBe(1);
    expect(chartListing(CHART, options({ view: "setup", search: "old deposit" })).matched).toBe(1);
  });
});

describe("what a click opens", () => {
  it("reads the fiscal year's first month off the start date the figures used", () => {
    expect(fiscalStartMonthOf("2026-01-01")).toBe(1);
    expect(fiscalStartMonthOf("2025-07-01")).toBe(7);
    expect(fiscalStartMonthOf("not a date")).toBe(1);
  });

  it("opens a profit and loss account over the same dates as its figure, in a year that starts in July", () => {
    const asOf = "2026-03-15";
    const start = fiscalYearStartFor(asOf, 7);
    expect(start).toBe("2025-07-01");
    const range = chartRange("profit_and_loss", asOf, fiscalStartMonthOf(start));
    expect(range).toEqual({ from: "2025-07-01", to: asOf });
    const spec = chartZoomSpec({ id: "rent", account_code: "6100", name: "Rent Expense" }, range, 120_000);
    expect(spec).toEqual({ title: "6100 Rent Expense", accountIds: ["rent"], from: "2025-07-01", to: asOf, figure: 120_000 });
  });

  it("opens a balance sheet account from the start of the books", () => {
    expect(chartRange("balance_sheet", "2026-03-15", fiscalStartMonthOf("2025-07-01"))).toEqual({ from: null, to: "2026-03-15" });
  });
});

describe("figures", () => {
  const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

  it("prints a negative figure in parentheses, and a zero as a plain zero", () => {
    expect(chartFigureText(1_250_000, money)).toBe("$12500.00");
    expect(chartFigureText(-420_000, money)).toBe("($4200.00)");
    expect(chartFigureText(0, money)).toBe("$0.00");
    expect(chartFigureText(-0, money)).toBe("$0.00");
  });

  it("says “negative” to a screen reader instead of a parenthesis", () => {
    expect(chartFigureSpoken(-420_000, money)).toBe("negative $4200.00");
    expect(chartFigureSpoken(5, money)).toBe("$0.05");
    expect(chartFigureSpoken(-0, money)).toBe("$0.00");
  });

  it("names what a click opens", () => {
    expect(openAccountLabel({ account_code: "1000", name: "Petty Cash" })).toBe("Open 1000 Petty Cash");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run tests/unit/accounts-screen.test.ts
```

Expected: FAIL — `lib/domain/chart-list.ts` does not exist yet.

- [ ] **Step 3: Create `ctyhp-accounting/lib/domain/chart-list.ts`** with exactly this content:

```ts
/**
 * The Chart of Accounts screen's list: which accounts a view shows, what the
 * search and the type pills keep, and the rows the table draws — a heading for
 * each group, then the group's accounts as a tree.
 *
 * Pure: accounts and figures in, rows and counts out. Which group an account
 * falls under and what its figure is are lib/domain/chart-groups.ts.
 */
import { accountGroups, withAncestors, type SectionAccount } from "./account-sections";
import {
  CHART_GROUPS,
  chartClassOf,
  chartGroupOf,
  filterCounts,
  type ChartClass,
  type ChartGroupKey,
  type ChartStatement,
} from "./chart-groups";

/** Balances is the default: every account with its figure. Setup is the same list with type, cash flow and status. */
export type ChartView = "balances" | "setup";

/** `?view=setup` opens Setup; anything else, or nothing, opens Balances. */
export function chartViewOf(param: string | string[] | null | undefined): ChartView {
  const value = Array.isArray(param) ? param[0] : param;
  return value === "setup" ? "setup" : "balances";
}

/** The address of a view. Balances is the default, so it carries no parameter. */
export function chartViewHref(view: ChartView): string {
  return view === "setup" ? "/accounts?view=setup" : "/accounts";
}

/**
 * The fiscal year's first month, read off the start date the figures were
 * worked out from (`fiscalYearStartFor` always names the 1st of that month),
 * so what a click opens covers the same dates as the figure clicked.
 */
export function fiscalStartMonthOf(fiscalYearStart: string): number {
  const month = Number(fiscalYearStart.slice(5, 7));
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : 1;
}

/** Inactive and archived accounts are out of use, though they may still hold money. */
export function isRetired(status: string): boolean {
  return status === "inactive" || status === "archived";
}

/**
 * The accounts a view lists. Setup lists every account. Balances leaves out an
 * account that is out of use and holds nothing, and keeps one that still does.
 */
export function accountsInView<T extends { id: string; status: string }>(
  accounts: readonly T[],
  figures: Readonly<Record<string, number>>,
  view: ChartView,
): T[] {
  if (view === "setup") return [...accounts];
  return accounts.filter((a) => !isRetired(a.status) || (figures[a.id] ?? 0) !== 0);
}

/** A search matches the code or the name, ignoring case. An empty search matches everything. */
export function matchesAccountSearch(account: { account_code: string; name: string }, search: string): boolean {
  const q = search.trim().toLowerCase();
  return q === "" || account.account_code.toLowerCase().includes(q) || account.name.toLowerCase().includes(q);
}

export type ChartFilter = "all" | ChartClass;

export interface ChartListAccount extends SectionAccount {
  name: string;
  status: string;
}

/** A group's heading row: its title, and how many accounts are listed under it. */
export interface ChartGroupHeading {
  kind: "group";
  key: string;
  group: ChartGroupKey;
  title: string;
  statement: ChartStatement;
  count: number;
}

export interface ChartAccountLine<T> {
  kind: "account";
  key: string;
  account: T;
  /** 0 for a top-level account; each sub-account level adds one. */
  depth: number;
}

export type ChartListRow<T> = ChartGroupHeading | ChartAccountLine<T>;

export interface ChartListOptions<T> {
  figures: Readonly<Record<string, number>>;
  inventoryAccountIds: ReadonlySet<string>;
  view: ChartView;
  search: string;
  filter: ChartFilter;
  /** A further narrowing applied with the search, such as Setup's cash flow role. */
  keep?: (account: T) => boolean;
}

export interface ChartListing<T> {
  rows: ChartListRow<T>[];
  /** The pills' counts: what the search found, by class. */
  counts: Record<ChartFilter, number>;
  /** Accounts both the search and the pill keep. The parents listed with them are not counted. */
  matched: number;
  /** For the lede: every account the view lists, before any search. */
  total: number;
  /** For the lede: how many of those carry a balance. */
  withBalance: number;
}

/**
 * The list a view draws. A match reads in its place in the tree, so the parents
 * above it come along; the pill counts follow the search, not the pill.
 */
export function chartListing<T extends ChartListAccount>(
  accounts: readonly T[],
  { figures, inventoryAccountIds, view, search, filter, keep }: ChartListOptions<T>,
): ChartListing<T> {
  const universe = accountsInView(accounts, figures, view);
  const searched = universe.filter((a) => matchesAccountSearch(a, search) && (!keep || keep(a)));
  const matches = filter === "all" ? searched : searched.filter((a) => chartClassOf(a.account_type) === filter);
  const narrowed = search.trim() !== "" || filter !== "all" || keep !== undefined;
  const listed = narrowed ? withAncestors(universe, matches) : universe;

  const statementOfGroup = new Map(CHART_GROUPS.map((g) => [g.key, g.statement]));
  const rows = accountGroups(listed, CHART_GROUPS, (a) => chartGroupOf(a, inventoryAccountIds)).flatMap(
    (group): ChartListRow<T>[] => [
      {
        kind: "group",
        key: `group:${group.key}`,
        group: group.key,
        title: group.title,
        statement: statementOfGroup.get(group.key) ?? "balance_sheet",
        count: group.rows.length,
      },
      ...group.rows.map(({ account, depth }): ChartAccountLine<T> => ({ kind: "account", key: account.id, account, depth })),
    ],
  );

  return {
    rows,
    counts: filterCounts(searched),
    matched: matches.length,
    total: universe.length,
    withBalance: universe.filter((a) => (figures[a.id] ?? 0) !== 0).length,
  };
}

/**
 * A figure as the chart prints it. A negative one is the wrong way round for
 * its account, and reads in parentheses: `($4,200.00)`.
 */
export function chartFigureText(minor: number, money: (minor: number) => string): string {
  if (minor === 0) return money(0);
  return minor < 0 ? `(${money(-minor)})` : money(minor);
}

/** The same figure as a screen reader says it: a parenthesis is easy to miss, "negative" is not. */
export function chartFigureSpoken(minor: number, money: (minor: number) => string): string {
  if (minor === 0) return money(0);
  return minor < 0 ? `negative ${money(-minor)}` : money(minor);
}

/** The accessible name of what opens an account: "Open 1000 Cash on Hand". */
export function openAccountLabel(account: { account_code: string; name: string }): string {
  return `Open ${account.account_code} ${account.name}`;
}
```

- [ ] **Step 4: Replace the whole of `ctyhp-accounting/app/(app)/accounts/accounts.module.css`** (most of it changes) with exactly this content:

```css
/*
 * The Chart of Accounts (AccountsClient.tsx), drawn the way the client's
 * prototype draws it: type pills, one bordered list, small upper-case group
 * headings that pin while the page scrolls, and figures that open QuickZoom.
 * Every colour is a token, so the dark theme follows.
 */

.root {
  /* Where a group's heading pins: under the top bar and the filter bar. The
     client measures the filter bar and writes the real figure here. */
  --coa-pin-top: 120px;
}

/* ---------- type pills ---------- */

.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 14px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 13px;
  border: 1px solid var(--ob-border-default);
  border-radius: 999px;
  background: var(--ob-surface-card);
  color: var(--ob-text-secondary);
  font: inherit;
  font-size: 12.5px;
  line-height: 1.4;
  cursor: pointer;
  transition:
    color 140ms ease,
    background-color 140ms ease,
    border-color 140ms ease;
}

.pill:hover {
  color: var(--ob-text-heading);
  border-color: var(--ob-border-muted);
}

.pill:focus-visible {
  outline: 2px solid var(--ob-intent-primary);
  outline-offset: 2px;
}

/* The pressed pill is filled with ink: dark on a light page, light on a dark one. */
.pill[aria-pressed="true"] {
  color: var(--ob-surface-card);
  background: var(--ob-text-heading);
  border-color: var(--ob-text-heading);
  font-weight: 600;
}

.pillCount {
  font-variant-numeric: tabular-nums;
}

/* ---------- filter bar ---------- */

/* Under .root: Ant Design's affix wrapper sets its own width at the same weight as one class. */
.root .search {
  width: 280px;
  max-width: 100%;
}

.field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ob-text-secondary);
  font-size: 13px;
  white-space: nowrap;
}

.updating {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ob-text-secondary);
  font-size: 12px;
}

/* ---------- the list ---------- */

/*
 * Ant Design writes its table rules under `.ant-table-wrapper
 * .ant-table.ant-table-small`. Naming the same chain under `.list` outranks
 * them without !important, and keeps every override on this page.
 */
.list :global(.ant-table-wrapper .ant-table.ant-table-small .ant-table-thead) > tr > th {
  padding: 9px 12px;
  color: var(--ob-text-secondary);
  background: var(--ob-surface-muted);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

/* No dividers between the head cells. Ant Design's own rule chains four :not()s,
   which no reasonable selector here outranks. */
.list :global(.ant-table-wrapper .ant-table-thead) > tr > th::before {
  display: none !important;
}

.list :global(.ant-table-wrapper .ant-table.ant-table-small .ant-table-tbody) > tr > td {
  padding: 7px 12px;
  border-bottom-color: var(--ob-border-default);
  font-size: 13px;
}

.list :global(.ant-table-wrapper .ant-table-tbody) > tr.accountRow:hover > td,
.list :global(.ant-table-wrapper .ant-table-tbody) > tr.accountRow > td:global(.ant-table-cell-row-hover) {
  background: var(--ob-surface-muted);
}

/* A group's heading: one cell across the row, on its own ground, under a firmer rule. */
.list :global(.ant-table-wrapper .ant-table.ant-table-small .ant-table-tbody) > tr.groupRow > td {
  padding: 7px 12px;
  background: var(--ob-surface-subtle);
  border-top: 1px solid var(--ob-border-muted);
  border-bottom: 1px solid var(--ob-border-default);
}

.list :global(.ant-table-wrapper .ant-table.ant-table-small .ant-table-tbody) > tr.groupRow:first-child > td {
  border-top: 0;
}

/*
 * Pinned headings, where the list fits its box.
 *
 * Sticky needs every box between the heading and the page to leave scrolling
 * alone. The shared table frame clips with `overflow: hidden`, and a table held
 * to its box scrolls sideways inside `.ant-table-content`; both make a box that
 * a sticky cell sticks to instead of the page. `clip` cuts the same corners
 * without making one. Below the 984px box (a 1280 window, less the sidebar and
 * margins) the columns stop fitting and the frame has to scroll, so the
 * headings scroll with it there.
 */
@container app-workspace (min-width: 1032px) {
  .list :global(.accounting-data-table) {
    overflow: clip;
  }

  .list :global(.accounting-table--fit .ant-table-content) {
    overflow: visible;
  }

  .list :global(.ant-table-wrapper .ant-table.ant-table-small .ant-table-tbody) > tr.groupRow > td {
    position: sticky;
    top: var(--coa-pin-top);
    z-index: 3;
  }
}

.groupHead {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.groupTitle {
  color: var(--ob-text-strong);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  white-space: nowrap;
}

.groupRange {
  min-width: 0;
  overflow: hidden;
  color: var(--ob-text-faint);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.groupCount {
  margin-left: auto;
  color: var(--ob-text-faint);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* ---------- account rows ---------- */

.code {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--ob-text-strong);
  font-family: ui-monospace, "Cascadia Mono", Consolas, "SF Mono", monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

/*
 * The class dot. The chart series already give each class its hue — income and
 * expense their own, payables the liabilities, net the equity, inventory the
 * assets — so the dot reads the same as the charts do.
 */
.dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--ob-series-other);
}

.dot[data-class="asset"] {
  background: var(--ob-series-inventory);
}

.dot[data-class="liability"] {
  background: var(--ob-series-payable);
}

.dot[data-class="equity"] {
  background: var(--ob-series-net);
}

.dot[data-class="income"] {
  background: var(--ob-series-income);
}

.dot[data-class="expense"] {
  background: var(--ob-series-expense);
}

.nameLine {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.nameLine :global(.ant-tag) {
  flex: 0 0 auto;
  margin-inline: 0;
}

.subMark {
  flex: 0 0 auto;
  color: var(--ob-text-faint);
}

/* The name and the figure are buttons that read as text until pointed at. */
.nameLink,
.figure {
  padding: 1px 3px;
  margin: -1px -3px;
  border: 0;
  border-radius: 3px;
  background: none;
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-decoration-thickness: 1px;
  text-underline-offset: 2.5px;
  transition:
    color 120ms ease,
    background-color 120ms ease,
    text-decoration-color 120ms ease;
}

.nameLink {
  min-width: 0;
  overflow: hidden;
  color: var(--ob-text-body);
  text-align: start;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nameLink:hover,
.figure:hover {
  color: var(--ob-intent-primary);
  text-decoration-color: currentColor;
}

.nameLink:focus-visible,
.figure:focus-visible {
  outline: 2px solid var(--ob-intent-primary);
  outline-offset: 1px;
}

.currency {
  color: var(--ob-text-faint);
  font-size: 11.5px;
  letter-spacing: 0.02em;
}

.balanceHead {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}

.figure {
  color: var(--ob-text-body);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.figure:hover {
  background: var(--ob-accent-wash);
}

/* The wrong way round for its account: in parentheses, in the negative colour. */
.figure.negative,
.figure.negative:hover {
  color: var(--ob-money-negative);
}

/* Nothing to open. */
.zero {
  color: var(--ob-text-faint);
  font-variant-numeric: tabular-nums;
}

/* The figures shown are for the old date while the new ones are read. */
.busy .figure,
.busy .zero {
  opacity: 0.45;
  transition: opacity 160ms ease;
}
```

- [ ] **Step 5: Replace the whole of `ctyhp-accounting/app/(app)/accounts/AccountsClient.tsx`** (most of it changes) with exactly this content:

```tsx
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  type TableColumnsType,
} from "antd";
import { CheckOutlined, EditOutlined, PlusOutlined, SearchOutlined, StopOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "@/components/PageHeader";
import ZoomSheet from "@/components/reports/ZoomSheet";
import DataTable from "@/components/ui/DataTable";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import FilterBar from "@/components/ui/FilterBar";
import IconActionButton from "@/components/ui/IconActionButton";
import { COLUMN } from "@/lib/design/table-metrics";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABEL,
  accountNormalBalance,
  statementSectionOf,
  type AccountType,
} from "@/lib/domain/accounts";
import { detailLabel, detailTypeOptions } from "@/lib/domain/account-detail";
import { parentChoices } from "@/lib/domain/account-sections";
import { CASH_FLOW_ROLES, defaultCashFlowRole, type CashFlowRole } from "@/lib/domain/cashflow";
import {
  CHART_FILTERS,
  chartClassOf,
  chartLede,
  chartRange,
  chartZoomSpec,
  groupRangeLabel,
  statementOf,
  type ChartClass,
} from "@/lib/domain/chart-groups";
import {
  chartFigureSpoken,
  chartFigureText,
  chartListing,
  chartViewHref,
  fiscalStartMonthOf,
  isRetired,
  openAccountLabel,
  type ChartFilter,
  type ChartListRow,
  type ChartView,
} from "@/lib/domain/chart-list";
import { shortDate } from "@/lib/domain/report-presets";
import type { ZoomSpec } from "@/lib/domain/statement";
import { formatMoney } from "@/lib/format";
import type { AccountRow, CurrencyRow, TaxCodeRow, AccountStatus } from "@/lib/db/types";
import type { ChartBalances } from "@/lib/services/chart-balances";
import ClassifyAccountsButton from "./ClassifyAccountsButton";
import {
  chartBalancesAction,
  createAccountAction,
  updateAccountAction,
  setAccountStatusAction,
} from "./actions";
import styles from "./accounts.module.css";

const STATUS_LABELS: Record<AccountStatus, { text: string; color: string }> = {
  draft: { text: "Draft", color: "default" },
  active: { text: "Active", color: "green" },
  inactive: { text: "Inactive", color: "orange" },
  archived: { text: "Archived", color: "default" },
};

const CASH_FLOW_ROLE_LABELS: Record<CashFlowRole, string> = {
  cash: "Cash",
  cash_equivalent: "Cash equivalent",
  restricted_cash: "Restricted cash",
  operating: "Operating",
  operating_receivable: "Operating — receivable",
  operating_inventory: "Operating — inventory",
  operating_payable: "Operating — payable",
  operating_asset: "Operating — other asset",
  operating_liability: "Operating — other liability",
  investing: "Investing",
  financing: "Financing",
  exclude: "Exclude",
  unclassified: "Unclassified",
};

const CLASS_LABEL: Record<ChartClass, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
};

/**
 * Column widths. The Account column carries none and takes what is left, never
 * less than ACCOUNT_FLOOR; tests/unit/accounts-screen adds each view's fixed
 * widths up against the 984px box at a 1280px window.
 */
export const CODE_WIDTH = COLUMN.CODE;
export const CURRENCY_WIDTH = 84;
/** Room for `($1,234,567.89)`: a seven-figure balance the wrong way round. */
export const BALANCE_WIDTH = 140;
export const TYPE_WIDTH = 150;
export const ACTIONS_WIDTH = COLUMN.ACTION * 2;
export const ACCOUNT_FLOOR = COLUMN.TEXT_MIN;
/** Balances: Code, Currency, Balance. */
export const BALANCES_FIXED_WIDTHS = [CODE_WIDTH, CURRENCY_WIDTH, BALANCE_WIDTH] as const;
/** Setup, for someone who can write: Code, Currency, Type, Cash flow, Status, Actions. */
export const SETUP_FIXED_WIDTHS = [CODE_WIDTH, CURRENCY_WIDTH, TYPE_WIDTH, COLUMN.STATUS, COLUMN.STATUS, ACTIONS_WIDTH] as const;

/**
 * The app's top bar: Ant Design's Layout header, 64px high and pinned at the
 * top of the page, which is the scrolling container. The filter bar pins under
 * it at the same 64px (app/globals.css), and a group's heading under both.
 */
const APP_HEADER_HEIGHT = 64;

type ListRow = ChartListRow<AccountRow>;

interface FormValues {
  account_code: string;
  name: string;
  account_type: AccountType;
  cash_flow_role?: CashFlowRole;
  /** Offered for bank and current-asset types; see lib/domain/account-detail. */
  detail_type?: string | null;
  is_contra: boolean;
  parent_account_id?: string | null;
  currency_code?: string | null;
  default_tax_code_id?: string | null;
  is_posting_account: boolean;
  description?: string | null;
}

/**
 * The chart of accounts as one grouped list, in the fourteen groups of
 * lib/domain/chart-groups.ts, each a tree of sub-accounts in code order.
 *
 * Balances, the default view, shows every account's figure at the As of date:
 * balance sheet accounts from the start of the books, profit and loss accounts
 * from the start of the fiscal year. The name or the figure opens QuickZoom on
 * the entries behind it. Setup shows the same list with type, cash flow and
 * status, and is where accounts are edited and deactivated.
 */
export default function AccountsClient({
  accounts,
  currencies,
  taxCodes,
  canWrite,
  initialView,
  initialBalances,
  baseCurrency,
  baseDecimals,
}: {
  accounts: AccountRow[];
  currencies: CurrencyRow[];
  taxCodes: TaxCodeRow[];
  canWrite: boolean;
  initialView: ChartView;
  /** Read on the server at the company's today. */
  initialBalances: ChartBalances;
  baseCurrency: string;
  baseDecimals: number;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const watchedType = Form.useWatch("account_type", form);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [view, setView] = useState<ChartView>(initialView);
  // A link or the back button can change the view under a mounted page; follow it.
  const [viewFromServer, setViewFromServer] = useState<ChartView>(initialView);
  if (viewFromServer !== initialView) {
    setViewFromServer(initialView);
    setView(initialView);
  }

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ChartFilter>("all");
  const [cashFlowFilter, setCashFlowFilter] = useState<CashFlowRole | "all">("all");

  const [balances, setBalances] = useState<ChartBalances>(initialBalances);
  /** The date asked for while its figures are on their way; null when the figures shown are for the date shown. */
  const [requestedAsOf, setRequestedAsOf] = useState<string | null>(null);
  const latestRun = useRef(0);
  const [zoom, setZoom] = useState<ZoomSpec | null>(null);

  const money = useCallback((minor: number) => formatMoney(minor, baseCurrency, baseDecimals), [baseCurrency, baseDecimals]);
  const inventoryAccountIds = useMemo(() => new Set(balances.inventoryAccountIds), [balances.inventoryAccountIds]);

  const listing = useMemo(
    () =>
      chartListing(accounts, {
        figures: balances.figures,
        inventoryAccountIds,
        view,
        search,
        filter,
        // How a reader finds every unclassified account: the one question the cash flow column is asked.
        keep: view === "setup" && cashFlowFilter !== "all" ? (a) => a.cash_flow_role === cashFlowFilter : undefined,
      }),
    [accounts, balances.figures, inventoryAccountIds, view, search, filter, cashFlowFilter],
  );

  const labelById = useMemo(
    () => new Map(accounts.map((a) => [a.id, `${a.account_code} — ${a.name}`])),
    [accounts],
  );

  // A group's heading pins under the filter bar, which is pinned itself and
  // whose height follows what it holds. Measure it rather than guess.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const bar = root?.querySelector<HTMLElement>(".accounting-filter-bar");
    if (!root || !bar) return;
    const place = () => root.style.setProperty("--coa-pin-top", `${APP_HEADER_HEIGHT + bar.offsetHeight}px`);
    place();
    const observer = new ResizeObserver(place);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const detailOptions = watchedType ? detailTypeOptions(watchedType) : [];

  function changeView(next: ChartView) {
    setView(next);
    // In the address, so a reload or a link opens the same view. Written with
    // history.replaceState as lib/client/use-table-url-state.ts does: the rows
    // are already here, and router.replace would re-read every balance.
    window.history.replaceState(window.history.state, "", chartViewHref(next));
  }

  async function changeAsOf(date: dayjs.Dayjs | null) {
    if (!date) return;
    const next = date.format("YYYY-MM-DD");
    if (next === (requestedAsOf ?? balances.asOf)) return;
    const run = ++latestRun.current;
    setRequestedAsOf(next);
    try {
      const result = await chartBalancesAction(next);
      // A later date was picked while this one was being read: its answer wins.
      if (run !== latestRun.current) return;
      if (result.ok && result.data) setBalances(result.data);
      else message.error(result.error ?? "The balances could not be read for that date");
    } catch {
      if (run === latestRun.current) message.error("The balances could not be read for that date. Check the connection and try again.");
    } finally {
      if (run === latestRun.current) setRequestedAsOf(null);
    }
  }

  /** QuickZoom on the account's figure, over the same dates the figure covers, so the list adds up to it. */
  function openAccount(account: AccountRow) {
    const figure = balances.figures[account.id] ?? 0;
    const range = chartRange(statementOf(account.account_type), balances.asOf, fiscalStartMonthOf(balances.fiscalYearStart));
    setZoom(chartZoomSpec(account, range, figure));
  }

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ currency_code: "USD", is_posting_account: true, is_contra: false });
    setOpen(true);
  }

  function openEdit(row: AccountRow) {
    setEditing(row);
    form.setFieldsValue({
      account_code: row.account_code,
      name: row.name,
      account_type: row.account_type,
      cash_flow_role: row.cash_flow_role,
      detail_type: row.detail_type,
      is_contra: row.is_contra,
      parent_account_id: row.parent_account_id,
      currency_code: row.currency_code,
      default_tax_code_id: row.default_tax_code_id,
      is_posting_account: row.is_posting_account,
      description: row.description,
    });
    setOpen(true);
  }

  function onTypeChange(type: AccountType) {
    form.setFieldValue("cash_flow_role", defaultCashFlowRole(type));
    const detail = form.getFieldValue("detail_type") as string | null | undefined;
    if (!detailTypeOptions(type).some((o) => o.value === detail)) form.setFieldValue("detail_type", null);
    const parentId = form.getFieldValue("parent_account_id") as string | null | undefined;
    if (parentId && accounts.find((a) => a.id === parentId)?.account_type !== type) {
      form.setFieldValue("parent_account_id", null);
    }
  }

  async function onSubmit() {
    const values = await form.validateFields();
    setSaving(true);
    const result = editing ? await updateAccountAction(editing.id, values) : await createAccountAction(values);
    setSaving(false);
    if (result.ok) {
      message.success(editing ? "Account updated" : "Account created");
      setOpen(false);
    } else {
      message.error(result.error ?? "Save failed");
    }
  }

  async function toggleStatus(row: AccountRow) {
    const next: AccountStatus = row.status === "active" ? "inactive" : "active";
    setBusyId(row.id);
    const result = await setAccountStatusAction(row.id, next);
    setBusyId(null);
    if (result.ok) message.success(next === "active" ? "Account activated" : "Account deactivated");
    else message.error(result.error ?? "Failed to update status");
  }

  const loading = requestedAsOf !== null;
  const balancesView = view === "balances";

  const groupHeading = (row: Extract<ListRow, { kind: "group" }>) => (
    <div className={styles.groupHead}>
      <span className={styles.groupTitle}>{row.title}</span>
      {balancesView && row.statement === "profit_and_loss" ? (
        <span className={styles.groupRange}>{groupRangeLabel(balances.fiscalYearStart)}</span>
      ) : null}
      <span className={styles.groupCount}>
        {row.count}
        <span className="accounting-sr-only">{row.count === 1 ? " account" : " accounts"}</span>
      </span>
    </div>
  );

  const nameCell = (account: AccountRow, depth: number) => {
    const under = [
      detailLabel(account.account_type, account.detail_type),
      CASH_FLOW_ROLE_LABELS[account.cash_flow_role],
      accountNormalBalance(account.account_type, account.is_contra) === "debit" ? "Debit normal" : "Credit normal",
      statementSectionOf(account.account_type) === "balance_sheet" ? "Balance Sheet" : "Profit & Loss",
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <div style={{ minWidth: 0, paddingLeft: depth * 18 }}>
        <div className={styles.nameLine}>
          {depth > 0 ? (
            <span className={styles.subMark} aria-hidden="true">
              ↳
            </span>
          ) : null}
          <button
            type="button"
            className={styles.nameLink}
            onClick={() => openAccount(account)}
            aria-label={openAccountLabel(account)}
            title={account.name}
          >
            {account.name}
          </button>
          {account.is_contra ? <Tag color="purple">Contra</Tag> : null}
          {balancesView && isRetired(account.status) ? (
            <Tag color={STATUS_LABELS[account.status].color}>{STATUS_LABELS[account.status].text}</Tag>
          ) : null}
        </div>
        {balancesView ? null : secondaryLine(under)}
      </div>
    );
  };

  const balanceCell = (account: AccountRow) => {
    const figure = balances.figures[account.id] ?? 0;
    if (figure === 0) return <span className={styles.zero}>{money(0)}</span>;
    return (
      <button
        type="button"
        className={`${styles.figure}${figure < 0 ? ` ${styles.negative}` : ""}`}
        onClick={() => openAccount(account)}
        aria-label={`${openAccountLabel(account)}, balance ${chartFigureSpoken(figure, money)}`}
        title="Open the entries behind this balance"
      >
        {chartFigureText(figure, money)}
      </button>
    );
  };

  const leading: TableColumnsType<ListRow> = [
    {
      title: "Code",
      key: "code",
      width: CODE_WIDTH,
      render: (_: unknown, row: ListRow) => {
        if (row.kind === "group") return groupHeading(row);
        const chartClass = chartClassOf(row.account.account_type);
        return (
          <span className={styles.code}>
            <span className={styles.dot} data-class={chartClass} title={CLASS_LABEL[chartClass]} aria-hidden="true" />
            {row.account.account_code}
          </span>
        );
      },
    },
    flexColumn<ListRow>({
      title: "Account",
      key: "name",
      floor: ACCOUNT_FLOOR,
      render: (_: unknown, row: ListRow) => (row.kind === "account" ? nameCell(row.account, row.depth) : null),
    }),
    {
      title: "Currency",
      key: "currency",
      width: CURRENCY_WIDTH,
      render: (_: unknown, row: ListRow) =>
        row.kind === "account" ? <span className={styles.currency}>{row.account.currency_code ?? baseCurrency}</span> : null,
    },
  ];

  const balanceColumns: TableColumnsType<ListRow> = [
    {
      title: (
        <span className={styles.balanceHead}>
          <span>Balance</span>
          <span>{shortDate(balances.asOf)}</span>
        </span>
      ),
      key: "balance",
      width: BALANCE_WIDTH,
      align: "right",
      render: (_: unknown, row: ListRow) => (row.kind === "account" ? balanceCell(row.account) : null),
    },
  ];

  const setupColumns: TableColumnsType<ListRow> = [
    {
      title: "Type",
      key: "type",
      width: TYPE_WIDTH,
      render: (_: unknown, row: ListRow) =>
        row.kind === "account" ? <Tag>{ACCOUNT_TYPE_LABEL[row.account.account_type]}</Tag> : null,
    },
    {
      title: "Cash flow",
      key: "cashFlow",
      width: COLUMN.STATUS,
      render: (_: unknown, row: ListRow) =>
        row.kind !== "account" ? null : row.account.cash_flow_role === "unclassified" ? (
          <Tag color="orange">Unclassified</Tag>
        ) : (
          <Tag color="blue">Set</Tag>
        ),
    },
    {
      title: "Status",
      key: "status",
      width: COLUMN.STATUS,
      render: (_: unknown, row: ListRow) =>
        row.kind === "account" ? (
          <Tag color={STATUS_LABELS[row.account.status].color}>{STATUS_LABELS[row.account.status].text}</Tag>
        ) : null,
    },
    ...(canWrite
      ? [
          {
            title: "Actions",
            key: "actions",
            width: ACTIONS_WIDTH,
            align: "right" as const,
            render: (_: unknown, row: ListRow) =>
              row.kind !== "account" ? null : (
                <Space size={4}>
                  <IconActionButton label="Edit account" icon={<EditOutlined />} onClick={() => openEdit(row.account)} />
                  <IconActionButton
                    label={row.account.status === "active" ? "Deactivate account" : "Activate account"}
                    icon={row.account.status === "active" ? <StopOutlined /> : <CheckOutlined />}
                    loading={busyId === row.account.id}
                    onClick={() => toggleStatus(row.account)}
                    disabled={row.account.status !== "active" && row.account.status !== "inactive"}
                  />
                </Space>
              ),
          } as TableColumnsType<ListRow>[number],
        ]
      : []),
  ];

  const shown = [...leading, ...(balancesView ? balanceColumns : setupColumns)];
  // A group's heading is one cell across the whole row.
  const columns: TableColumnsType<ListRow> = shown.map((column, i) => ({
    ...column,
    onCell: (row: ListRow) => (row.kind === "group" ? { colSpan: i === 0 ? shown.length : 0 } : {}),
  }));

  const narrowed = search.trim() !== "" || filter !== "all" || (view === "setup" && cashFlowFilter !== "all");

  return (
    <div ref={rootRef} className={styles.root}>
      <PageHeader
        title="Chart of Accounts"
        description={chartLede(listing.total, listing.withBalance, balances.asOf)}
        actions={
          <Segmented<ChartView>
            aria-label="View"
            value={view}
            onChange={changeView}
            options={[
              { value: "balances", label: "Balances" },
              { value: "setup", label: "Setup" },
            ]}
          />
        }
      />

      <div className={styles.pills} role="group" aria-label="Account type">
        {CHART_FILTERS.map((pill) => (
          <button
            key={pill.key}
            type="button"
            className={styles.pill}
            aria-pressed={filter === pill.key}
            onClick={() => setFilter(pill.key)}
          >
            {pill.label}{" "}
            <span className={styles.pillCount}>({listing.counts[pill.key]})</span>
          </button>
        ))}
      </div>

      <FilterBar
        resultCount={listing.matched}
        actions={
          <Space wrap>
            <ClassifyAccountsButton canWrite={canWrite} />
            {canWrite ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                New account
              </Button>
            ) : null}
          </Space>
        }
      >
        <Input
          aria-label="Search accounts"
          placeholder="Search by code or name"
          allowClear
          prefix={<SearchOutlined aria-hidden="true" />}
          className={styles.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {balancesView ? (
          <>
            <label className={styles.field}>
              As of
              <DatePicker
                aria-label="As of"
                value={dayjs(requestedAsOf ?? balances.asOf)}
                allowClear={false}
                onChange={(d) => void changeAsOf(d)}
              />
            </label>
            <span className={styles.updating} aria-live="polite">
              {loading ? (
                <>
                  <Spin size="small" />
                  Updating balances…
                </>
              ) : null}
            </span>
          </>
        ) : (
          <Select<CashFlowRole | "all">
            aria-label="Cash flow role"
            value={cashFlowFilter}
            onChange={setCashFlowFilter}
            style={{ width: 200 }}
            popupMatchSelectWidth={false}
            options={[
              { value: "all", label: "All cash flow roles" },
              ...CASH_FLOW_ROLES.map((role) => ({ value: role, label: CASH_FLOW_ROLE_LABELS[role] })),
            ]}
          />
        )}
      </FilterBar>

      <div className={`${styles.list}${loading ? ` ${styles.busy}` : ""}`} aria-busy={loading}>
        <DataTable<ListRow>
          rowKey={(row) => row.key}
          columns={columns}
          dataSource={listing.rows}
          // One continuous list: a page break would split a group from its heading.
          pagination={false}
          rowClassName={(row) => (row.kind === "group" ? styles.groupRow : styles.accountRow)}
          emptyTitle={narrowed ? "No accounts match that search" : "No accounts yet"}
          emptyDescription={
            narrowed
              ? "Try a different code or name, or another account type."
              : "Create an account to start building the chart of accounts."
          }
        />
      </div>

      <ZoomSheet spec={zoom} onClose={() => setZoom(null)} money={money} />

      <Modal
        title={editing ? "Edit account" : "New account"}
        open={open}
        onOk={onSubmit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Save"
        cancelText="Cancel"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="account_code" label="Account code" rules={[{ required: true, message: "Enter an account code" }]}>
            <Input disabled={!!editing} placeholder="e.g. 4000" />
          </Form.Item>
          <Form.Item name="name" label="Account name" rules={[{ required: true, message: "Enter a name" }]}>
            <Input placeholder="e.g. Sales Revenue" />
          </Form.Item>
          <Form.Item name="account_type" label="Account type" rules={[{ required: true, message: "Select a type" }]}>
            <Select
              options={ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] }))}
              placeholder="Select an account type"
              onChange={onTypeChange}
            />
          </Form.Item>
          <Form.Item
            name="cash_flow_role"
            label="Cash flow role"
            rules={[{ required: true, message: "Select a cash flow role" }]}
            extra="Unclassified accounts keep the Cash Flow Statement in review status until an accountant assigns a policy."
          >
            <Select
              options={CASH_FLOW_ROLES.map((role) => ({ value: role, label: CASH_FLOW_ROLE_LABELS[role] }))}
              placeholder="Select a cash flow role"
            />
          </Form.Item>
          {detailOptions.length > 0 ? (
            <Form.Item
              name="detail_type"
              label={watchedType === "bank" ? "Bank account detail" : "Detail"}
              rules={watchedType === "bank" ? [{ required: true, message: "Say which kind of account this is" }] : []}
              extra={
                watchedType === "bank"
                  ? "Cash on hand is physical cash; everything else is held at a financial institution."
                  : "Undeposited funds and transfer clearing are money on its way to a bank; the chart shows them with the bank accounts."
              }
            >
              <Select allowClear={watchedType !== "bank"} placeholder="Choose a detail" options={detailOptions} />
            </Form.Item>
          ) : null}
          <Form.Item
            name="parent_account_id"
            label="Parent account (optional)"
            extra="A sub-account has its parent's type, so only accounts of this type are offered."
          >
            <Select
              allowClear
              showSearch
              filterOption={(input, option) => String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
              placeholder="None"
              options={parentChoices(accounts, watchedType, editing?.id ?? null).map((a) => ({
                value: a.id,
                label: labelById.get(a.id)!,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="is_contra"
            label="Contra account"
            valuePropName="checked"
            tooltip="An account that reduces another in its section — Accumulated Depreciation, Sales Returns, Owner's Draw. Its balance runs the other way, and the Exception Report does not question it for that."
          >
            <Switch />
          </Form.Item>
          <Form.Item name="currency_code" label="Currency">
            <Select
              disabled
              placeholder="USD"
              options={currencies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
            />
          </Form.Item>
          <Form.Item name="default_tax_code_id" label="Default tax code (optional)">
            <Select
              allowClear
              placeholder="None"
              options={taxCodes.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))}
            />
          </Form.Item>
          <Form.Item
            name="is_posting_account"
            label="Posting account"
            valuePropName="checked"
            tooltip="Turn off for a summary account that does not receive direct postings"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 6: Replace the whole of `ctyhp-accounting/app/(app)/accounts/page.tsx`** (most of it changes) with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { listAccounts } from "@/lib/services/accounts";
import { getChartBalances } from "@/lib/services/chart-balances";
import { listCurrencies, listTaxCodes } from "@/lib/services/reference";
import { companyClock } from "@/lib/services/report-context";
import { getUserRole, canWrite } from "@/lib/auth";
import { chartViewOf } from "@/lib/domain/chart-list";
import AccountsClient from "./AccountsClient";

export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [params, sb] = await Promise.all([searchParams, createSupabaseServerClient()]);
  // The company's own day, in its time zone: at 6 p.m. in New York it is
  // already tomorrow in UTC, and the balances would run a day ahead.
  const clock = companyClock(sb);
  const [accounts, currencies, taxCodes, role, balances] = await Promise.all([
    listAccounts(sb),
    listCurrencies(sb),
    listTaxCodes(sb),
    getUserRole(),
    // Also says where the fiscal year starts, which is where profit and loss figures begin.
    clock.then(({ today }) => getChartBalances(sb, today)),
  ]);
  const base = currencies.find((c) => c.is_base);

  return (
    <AccountsClient
      accounts={accounts}
      currencies={currencies}
      taxCodes={taxCodes}
      canWrite={canWrite(role)}
      initialView={chartViewOf(params.view)}
      initialBalances={balances}
      baseCurrency={base?.code ?? "USD"}
      baseDecimals={base?.decimal_places ?? 2}
    />
  );
}
```

- [ ] **Step 7: Edit `ctyhp-accounting/components/reports/ZoomSheet.tsx`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```tsx
          <div className={styles.zoomTotal}>
            <span>{result.rows.length.toLocaleString("en-US")} lines</span>
            <strong>Total {money(result.total)}</strong>
```

replace with:

```tsx
          <div className={styles.zoomTotal}>
            <span>
              {result.rows.length.toLocaleString("en-US")} {result.rows.length === 1 ? "line" : "lines"}
            </span>
            <strong>Total {money(result.total)}</strong>
```

- [ ] **Step 8: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/accounts-screen.test.ts" "lib/domain/chart-list.ts" "app/(app)/accounts/AccountsClient.tsx" "app/(app)/accounts/page.tsx" "components/reports/ZoomSheet.tsx"
npx vitest run tests/unit/accounts-screen.test.ts tests/unit/chart-groups.test.ts tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/table-pagination-guard.test.ts tests/unit/rsc-antd.test.ts tests/unit/no-hardcoded-color.test.ts tests/unit/design-tokens.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; accounts-screen: 25 tests passing; chart-groups and the six table/design contract files (31 tests) pass.

- [ ] **Step 9: Commit**

```bash
git add "ctyhp-accounting/tests/unit/accounts-screen.test.ts" "ctyhp-accounting/lib/domain/chart-list.ts" "ctyhp-accounting/app/(app)/accounts/accounts.module.css" "ctyhp-accounting/app/(app)/accounts/AccountsClient.tsx" "ctyhp-accounting/app/(app)/accounts/page.tsx" "ctyhp-accounting/components/reports/ZoomSheet.tsx"
git commit -m "feat(accounts): Chart of Accounts with balances and drill-down"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 3: Release 1.97 and the Guide

**Files:**
- Modify: `ctyhp-accounting/lib/domain/changelog.ts`
- Modify: `ctyhp-accounting/lib/domain/system-guide.ts`

**Interfaces:**
- Consumes: the screen from Task 2 (the notes describe it).
- Produces: release 1.97 above 1.96 (date 2026-10-10 — if main has moved past 1.96 by the time this merges, the controller renumbers it to the next free number), including the "1 line" fix; the Guide's chart-of-accounts steps updated for Balances | Setup and the click-through.

- [ ] **Step 1: Edit `ctyhp-accounting/lib/domain/changelog.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
export const RELEASES: Release[] = [
  {
```

replace with:

```ts
export const RELEASES: Release[] = [
  {
    version: "1.97",
    date: "2026-10-10",
    headline: "Chart of Accounts shows every account’s balance, and a balance opens the entries behind it.",
    changes: [
      {
        kind: "changed",
        title: "Chart of Accounts is one list, with a balance on every account",
        detail:
          "The ten separate tables are now one list in fourteen groups, in statement order: Bank and cash, Receivables, Inventory, Other current assets, Long-term assets, Credit cards, Payables, Other current liabilities, Long-term liabilities, Equity, Income, Cost of sales, Expenses and Other expenses. A group’s heading stays at the top of the screen while you scroll through it, with its number of accounts on the right. Each account shows a coloured dot for assets, liabilities, equity, income or expenses, its code and name, its currency and its balance at the As of date. Balance sheet accounts show what they hold on that date. Income and expense accounts show the year to date, from the start of the fiscal year, and their groups say so. A balance the wrong way round for its account is in parentheses, in red. An inactive account appears only while it still holds a balance, marked Inactive.",
        route: "/accounts",
      },
      {
        kind: "added",
        title: "Click a balance to see the entries behind it",
        detail:
          "Click an account’s name, or its balance, and the same panel opens as on the financial statements: every posted line over the dates that balance covers, the account on the other side, a running balance, and a check that the lines add up to the figure you clicked. Click a line to see the whole transaction: its document, both sides of the entry, and Open in Journal. A zero balance has nothing behind it, so it does not open.",
        route: "/accounts",
      },
      {
        kind: "added",
        title: "Type pills, search and the As of date",
        detail:
          "All, Assets, Liabilities, Equity, Income and Expenses narrow the list, each with the number of accounts it holds; the numbers follow the search. Income takes in other income, and Expenses takes in cost of sales and other expenses. The search finds a code or a name and keeps a sub-account’s parent in view. As of starts at today in the company’s time zone; change it and every balance is read again for that date, and the line under the title says how many accounts carry a balance on it.",
        route: "/accounts",
      },
      {
        kind: "changed",
        title: "Setup holds the type, cash flow and status columns",
        detail:
          "Switch from Balances to Setup at the top right for the same list with Type, Cash flow and Status, the cash flow role filter, and the edit and deactivate buttons. The address remembers the view, so a reload or a shared link opens the same one. Classify and New account stay where they were.",
        route: "/accounts?view=setup",
      },
      {
        kind: "fixed",
        title: "The entries panel counts one line as “1 line”",
        detail: "Under the entries behind a figure, a single entry used to read “1 lines”.",
      },
    ],
  },
  {
```

- [ ] **Step 2: Edit `ctyhp-accounting/lib/domain/system-guide.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
      {
        action: "Close the period",
```

replace with:

```ts
      {
        action: "Read every account’s balance at the month end, and open any that looks wrong",
        control: "Chart of Accounts",
        route: "/accounts",
        note:
          "Balances, the default view, shows each account at the As of date: set it to the last day of the month. " +
          "Balance sheet accounts show what they hold on that date; income and expense accounts show the year to date. " +
          "A figure in parentheses is the wrong way round for its account. Click a name or a balance to list the entries " +
          "behind it with a running balance, then click an entry to see both sides. Setup, beside Balances, is where an " +
          "account is edited or deactivated.",
      },
      {
        action: "Close the period",
```

Edit 2 of 2 — find:

```ts
          "chart recognises. Or, when the file is somebody else's export and cannot be edited, " +
          "set the account you do not use to Inactive under Chart of accounts — one live account " +
          "of that name is no longer a question.",
```

replace with:

```ts
          "chart recognises. Or, when the file is somebody else's export and cannot be edited, " +
          "set the account you do not use to Inactive in Chart of Accounts, under Setup — one live account " +
          "of that name is no longer a question.",
```

- [ ] **Step 3: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "lib/domain/changelog.ts" "lib/domain/system-guide.ts"
npx vitest run tests/unit/changelog.test.ts tests/unit/system-guide.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; changelog + system-guide: 38 tests passing.

- [ ] **Step 4: Commit**

```bash
git add "ctyhp-accounting/lib/domain/changelog.ts" "ctyhp-accounting/lib/domain/system-guide.ts"
git commit -m "feat(accounts): release 1.97 and the Guide"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 4: Controller — whole-branch gates, live check, smoke on the sample company, approval

**Files:** none changed by this task (scratch scripts live outside the repo).

**Interfaces:**
- Consumes: the whole branch.

- [ ] **Step 1: The branch equals the pre-build.** `git diff prebuild/chart-balances HEAD -- ctyhp-accounting` is empty, unless a review fix was agreed. Every commit has no Co-Authored-By trailer and no mention of Claude or AI.
- [ ] **Step 2: Whole-suite gates.** `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`, `npm run quality:budget`. Expected: tsc 0; lint 0 errors; every test file passes (two known load-sensitive timeouts — `chart-templates` and `quality-query-timing` — must pass when rerun alone); build compiles; 11/11 within budget.
- [ ] **Step 3: Live check, alone and read-only** (`tests/live/chart-balances.live.ts`): 2/2 on six companies — every figure equals its natural ledger balance, and every non-zero figure's drill-down adds up (about five minutes).
- [ ] **Step 4: Smoke and screenshots on PC-Test, read-only**, against `next start` on a free port: Balances opens with the lede, the groups, the range labels and the pill counts; a balance sheet figure and an income figure each open entries that add up to the figure clicked; an entry opens its double entry; the Assets pill, the search and As of work; Setup is written to the address and survives a reload; dark Balances and Setup; no sideways scroll at 1280; no console errors. Staff emails blurred in every screenshot.
- [ ] **Step 5: Approval page** of the screenshots (light and dark) for the user. Nothing is pushed before the user approves.
- [ ] **Step 6: After approval** — scan the whole diff for real client data and secrets (separate command, read before pushing), check main has not moved (renumber the release up if it has), push the branch; the user opens the PR; then CI and a read-only production check.
