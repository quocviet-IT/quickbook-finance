# Cash Flow Statement + Dashboard (J) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a direct Cash Flow Statement that ties out to the change in cash balances, and rebuild the dashboard with actionable metric cards, both derived from the existing ledger and services.

**Architecture:** One migration adds two read-only aggregation RPCs (`acc_cash_flow`, `acc_unreconciled_bank`). A pure domain module classifies account types into cash-flow categories and assembles the statement; thin services (`cashflow`, `dashboard`) call the RPCs and reuse `getLedgerBalances`/`getArAgeing`/`getApAgeing`; the cash-flow report page and a rebuilt dashboard render the results. Read-only — no financial writes.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (Postgres/RLS), Ant Design, Zod, Vitest, `pg` for the verify script (DB reachable via the pooler; `scripts/migrate.mjs` applies migrations).

## Global Constraints

- Money is integer minor units (base currency); convert to decimal only at the UI edge via `fromMinor`.
- All aggregation runs in SQL (RPCs / `acc_ledger_balances`), not by pulling rows into the app. No SQL in components.
- Read-only module: no writes, no new audit events; RPCs are `language sql stable` (run as invoker, RLS applies).
- Cash = accounts of `account_type = 'bank'`. Cash-flow categories: Investing = `fixed_asset`; Financing = `equity`, `credit_card`; Operating = everything else. Documented simplification: current_liability (incl. loans) classifies as Operating — never breaks the tie-out.
- The statement must tie out: `operating + investing + financing == netChange == closingCash − openingCash`.
- Never swallow an error (always check `{ error }`). English is the canonical language.
- Dashboard omits cards whose data doesn't exist yet (pending approvals → Module C; failed imports → Module K).
- Commit messages must NOT contain any Claude attribution / Co-Authored-By / "Generated with Claude Code".
- All commands run from `c:/Users/pit010/QUICKBOOK_WEBAPP/ctyhp-accounting`. Migration applied via `scripts/migrate.mjs` before the Task 6 live E2E.
- Next migration number: `0030`.

---

## File Structure

- Create `supabase/migrations/0030_cashflow_dashboard.sql` — `acc_cash_flow` + `acc_unreconciled_bank` read RPCs.
- Create `lib/domain/cashflow.ts` — `cashFlowCategoryOf`, `assembleCashFlow`.
- Modify `lib/domain/schemas.ts` — `cashFlowRangeSchema`.
- Create `tests/unit/cashflow.test.ts`.
- Create `lib/services/cashflow.ts`, `lib/services/dashboard.ts`.
- Create `app/(app)/reports/cash-flow/{page.tsx,CashFlowClient.tsx,actions.ts}`.
- Modify `app/(app)/dashboard/page.tsx` + `app/(app)/dashboard/DashboardClient.tsx` — rebuild.
- Modify `components/AppShell.tsx` (only if a Cash Flow nav entry is added; Dashboard already exists).
- Create `scripts/verify-cashflow.mjs`.

---

## Task 1: Migration — cash-flow + unreconciled RPCs

**Files:**
- Create: `supabase/migrations/0030_cashflow_dashboard.sql`

**Interfaces:**
- Produces `acc_cash_flow(p_from date, p_to date) returns table(category text, amount_minor bigint)` and `acc_unreconciled_bank(p_as_of date) returns table(item_count bigint, amount_minor bigint)`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0030_cashflow_dashboard.sql
-- ============================================================================
-- Read-only aggregations for the Cash Flow Statement (direct method) and the
-- dashboard. No writes. Runs as invoker (RLS applies).
--
-- Cash = accounts of type 'bank'. Cash-flow category totals come from the
-- NON-bank lines of posted entries that touch a bank account in the window,
-- summed as (credit - debit) in base currency (positive = cash in). Because
-- each entry is balanced, the category totals sum to the bank movement, so the
-- statement ties out to the change in cash balances.
-- ============================================================================

create or replace function acc_cash_flow(p_from date, p_to date)
returns table (category text, amount_minor bigint)
language sql stable as $$
  with bank_entries as (
    select distinct l.journal_entry_id
      from acc_journal_line l
      join acc_account a       on a.id = l.account_id
      join acc_journal_entry e on e.id = l.journal_entry_id
     where a.account_type = 'bank'
       and e.status = 'posted'
       and e.entry_date between p_from and p_to
  )
  select
    case
      when a.account_type = 'fixed_asset'            then 'operating'  -- placeholder, replaced below
      else 'operating'
    end,
    0::bigint
  where false
  union all
  select
    case
      when a.account_type = 'fixed_asset'          then 'investing'
      when a.account_type in ('equity','credit_card') then 'financing'
      else 'operating'
    end as category,
    coalesce(sum(case when l.credit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
    from acc_journal_line l
    join acc_account a on a.id = l.account_id
   where l.journal_entry_id in (select journal_entry_id from bank_entries)
     and a.account_type <> 'bank'
   group by 1;
$$;

-- Bank GL lines (posted) not reconciled by any completed statement reconciliation,
-- as of a date. Returns the count and the net signed base amount.
create or replace function acc_unreconciled_bank(p_as_of date)
returns table (item_count bigint, amount_minor bigint)
language sql stable as $$
  select
    count(*)::bigint,
    coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
    from acc_journal_line l
    join acc_account a       on a.id = l.account_id
    join acc_journal_entry e on e.id = l.journal_entry_id
   where a.account_type = 'bank'
     and e.status = 'posted'
     and e.entry_date <= p_as_of
     and not exists (
       select 1 from acc_reconciliation_line rl
       join acc_statement_reconciliation r on r.id = rl.reconciliation_id
       where rl.journal_line_id = l.id and r.status = 'completed'
     );
$$;
```

Note: the first `select ... where false` union branch is unnecessary — REMOVE it; the function body is simply the single grouped select. Final form:

```sql
create or replace function acc_cash_flow(p_from date, p_to date)
returns table (category text, amount_minor bigint)
language sql stable as $$
  with bank_entries as (
    select distinct l.journal_entry_id
      from acc_journal_line l
      join acc_account a       on a.id = l.account_id
      join acc_journal_entry e on e.id = l.journal_entry_id
     where a.account_type = 'bank'
       and e.status = 'posted'
       and e.entry_date between p_from and p_to
  )
  select
    case
      when a.account_type = 'fixed_asset'             then 'investing'
      when a.account_type in ('equity','credit_card') then 'financing'
      else 'operating'
    end as category,
    coalesce(sum(case when l.credit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
    from acc_journal_line l
    join acc_account a on a.id = l.account_id
   where l.journal_entry_id in (select journal_entry_id from bank_entries)
     and a.account_type <> 'bank'
   group by 1;
$$;
```

Use ONLY the final form above for `acc_cash_flow` (plus `acc_unreconciled_bank`). Do not include the `where false` scaffold.

- [ ] **Step 2: Sanity-check the SQL parses**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('supabase/migrations/0030_cashflow_dashboard.sql','utf8');for(const f of ['acc_cash_flow','acc_unreconciled_bank'])if(!s.includes('function '+f)){console.error('missing '+f);process.exit(1)}if(/where false/.test(s)){console.error('remove the where-false scaffold');process.exit(1)}console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0030_cashflow_dashboard.sql
git commit -m "feat: cash-flow + unreconciled-bank read RPCs"
```

Note: apply 0030 via `scripts/migrate.mjs` before the Task 6 live E2E.

---

## Task 2: Domain — cash-flow classification + assembly

**Files:**
- Create: `lib/domain/cashflow.ts`
- Modify: `lib/domain/schemas.ts`
- Test: `tests/unit/cashflow.test.ts`

**Interfaces:**
- Consumes: `AccountType` from `lib/domain/accounts`.
- Produces:
  - `CashFlowCategory = "operating" | "investing" | "financing"`
  - `cashFlowCategoryOf(t: AccountType): CashFlowCategory`
  - `assembleCashFlow(categories: { category: CashFlowCategory; amountMinor: number }[], openingMinor: number, closingMinor: number): { operating: number; investing: number; financing: number; netChange: number; openingMinor: number; closingMinor: number; tiesOut: boolean }`
  - `cashFlowRangeSchema` → `CashFlowRangeInput`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/cashflow.test.ts
import { describe, it, expect } from "vitest";
import { cashFlowCategoryOf, assembleCashFlow } from "@/lib/domain/cashflow";

describe("cashFlowCategoryOf", () => {
  it("classifies by account type", () => {
    expect(cashFlowCategoryOf("fixed_asset")).toBe("investing");
    expect(cashFlowCategoryOf("equity")).toBe("financing");
    expect(cashFlowCategoryOf("credit_card")).toBe("financing");
    for (const t of ["income", "other_income", "expense", "cost_of_goods_sold", "other_expense", "accounts_receivable", "accounts_payable", "current_asset", "current_liability"] as const) {
      expect(cashFlowCategoryOf(t)).toBe("operating");
    }
  });
});

describe("assembleCashFlow", () => {
  it("sums categories and ties out when totals match the cash change", () => {
    const r = assembleCashFlow(
      [{ category: "operating", amountMinor: 300_00 }, { category: "investing", amountMinor: -100_00 }, { category: "financing", amountMinor: 50_00 }],
      1000_00, // opening
      1250_00, // closing => netChange 250_00 == 300-100+50
    );
    expect(r.operating).toBe(300_00);
    expect(r.investing).toBe(-100_00);
    expect(r.financing).toBe(50_00);
    expect(r.netChange).toBe(250_00);
    expect(r.tiesOut).toBe(true);
  });
  it("flags a mismatch", () => {
    const r = assembleCashFlow([{ category: "operating", amountMinor: 100_00 }], 0, 90_00);
    expect(r.netChange).toBe(90_00);
    expect(r.tiesOut).toBe(false); // operating 100 != netChange 90
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- cashflow`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// lib/domain/cashflow.ts
/**
 * Pure cash-flow classification + assembly for the direct-method statement.
 * Cash = 'bank' accounts. Category totals come from the non-bank lines of
 * bank-touching entries; they must sum to the change in cash (the tie-out).
 */
import type { AccountType } from "./accounts";

export type CashFlowCategory = "operating" | "investing" | "financing";

export function cashFlowCategoryOf(t: AccountType): CashFlowCategory {
  if (t === "fixed_asset") return "investing";
  if (t === "equity" || t === "credit_card") return "financing";
  return "operating";
}

export interface CashFlowAssembled {
  operating: number;
  investing: number;
  financing: number;
  netChange: number;
  openingMinor: number;
  closingMinor: number;
  tiesOut: boolean;
}

export function assembleCashFlow(
  categories: { category: CashFlowCategory; amountMinor: number }[],
  openingMinor: number,
  closingMinor: number,
): CashFlowAssembled {
  const sum = (c: CashFlowCategory) => categories.filter((x) => x.category === c).reduce((s, x) => s + x.amountMinor, 0);
  const operating = sum("operating");
  const investing = sum("investing");
  const financing = sum("financing");
  const netChange = closingMinor - openingMinor;
  return {
    operating, investing, financing, netChange, openingMinor, closingMinor,
    tiesOut: operating + investing + financing === netChange,
  };
}
```

Append to `lib/domain/schemas.ts`:

```typescript
// --- Cash flow ---
export const cashFlowRangeSchema = z.object({
  from: z.string().min(1, "From date is required"),
  to: z.string().min(1, "To date is required"),
});
export type CashFlowRangeInput = z.infer<typeof cashFlowRangeSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- cashflow`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/cashflow.ts lib/domain/schemas.ts tests/unit/cashflow.test.ts
git commit -m "feat: cash-flow category mapping + statement assembly + schema"
```

---

## Task 3: Services — cashflow + dashboard

**Files:**
- Create: `lib/services/cashflow.ts`, `lib/services/dashboard.ts`

**Interfaces:**
- Consumes: `acc_cash_flow`, `acc_unreconciled_bank` (Task 1); `getLedgerBalances` (`lib/services/reports`); `getArAgeing`, `getApAgeing` (`lib/services/ageing`); `assembleCashFlow`, `cashFlowCategoryOf` (Task 2); `naturalBalanceOf`/account types.
- Produces:
  - `getCashFlow(sb, from, to): Promise<CashFlowReport>` where `CashFlowReport = CashFlowAssembled`.
  - `getDashboardMetrics(sb): Promise<DashboardMetrics>` with `{ cashMinor, overdueArMinor, overdueApMinor, unreconciledCount, unreconciledMinor, openPastPeriods, mtdNetIncomeMinor }`.
  - `class CashFlowError extends Error`, `class DashboardError extends Error`.

- [ ] **Step 1: cashflow service**

```typescript
// lib/services/cashflow.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleCashFlow, type CashFlowAssembled, type CashFlowCategory } from "@/lib/domain/cashflow";
import { getLedgerBalances } from "./reports";

export class CashFlowError extends Error {}
export type CashFlowReport = CashFlowAssembled;

/** Net cash (bank accounts) as of a date, base minor. bank is debit-normal. */
async function cashAsOf(sb: SupabaseClient, asOf: string): Promise<number> {
  const rows = await getLedgerBalances(sb, null, asOf);
  return rows.filter((r) => r.accountType === "bank").reduce((s, r) => s + (r.debitBase - r.creditBase), 0);
}

function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export async function getCashFlow(sb: SupabaseClient, from: string, to: string): Promise<CashFlowReport> {
  const { data, error } = await sb.rpc("acc_cash_flow", { p_from: from, p_to: to });
  if (error) throw new CashFlowError(error.message);
  const categories = (data ?? []).map((r: Record<string, unknown>) => ({
    category: r.category as CashFlowCategory,
    amountMinor: Number(r.amount_minor),
  }));
  const [opening, closing] = await Promise.all([cashAsOf(sb, dayBefore(from)), cashAsOf(sb, to)]);
  return assembleCashFlow(categories, opening, closing);
}
```

- [ ] **Step 2: dashboard service**

```typescript
// lib/services/dashboard.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLedgerBalances } from "./reports";
import { getArAgeing, getApAgeing } from "./ageing";
import { buildProfitAndLoss } from "@/lib/domain/reports";

export class DashboardError extends Error {}

export interface DashboardMetrics {
  cashMinor: number;
  overdueArMinor: number;
  overdueApMinor: number;
  unreconciledCount: number;
  unreconciledMinor: number;
  openPastPeriods: number;
  mtdNetIncomeMinor: number;
}

function today(): string { return new Date().toISOString().slice(0, 10); }
function monthStart(): string { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); }

export async function getDashboardMetrics(sb: SupabaseClient): Promise<DashboardMetrics> {
  const asOf = today();
  const [bal, ar, ap, unrecon, periods, mtdRows] = await Promise.all([
    getLedgerBalances(sb, null, asOf),
    getArAgeing(sb, asOf),
    getApAgeing(sb, asOf),
    sb.rpc("acc_unreconciled_bank", { p_as_of: asOf }),
    sb.from("acc_accounting_period").select("id", { count: "exact", head: true }).eq("status", "open").lt("period_end", asOf),
    getLedgerBalances(sb, monthStart(), asOf),
  ]);
  if (unrecon.error) throw new DashboardError(unrecon.error.message);
  if (periods.error) throw new DashboardError(periods.error.message);

  const cashMinor = bal.filter((r) => r.accountType === "bank").reduce((s, r) => s + (r.debitBase - r.creditBase), 0);
  // Overdue = total minus the "current" bucket (current = not yet overdue).
  const overdue = (rep: { buckets: Record<string, number> }) =>
    Object.entries(rep.buckets).filter(([k]) => k !== "current").reduce((s, [, v]) => s + v, 0);
  const u = (unrecon.data ?? [])[0] as { item_count: number; amount_minor: number } | undefined;
  const pnl = buildProfitAndLoss(mtdRows);

  return {
    cashMinor,
    overdueArMinor: overdue(ar),
    overdueApMinor: overdue(ap),
    unreconciledCount: Number(u?.item_count ?? 0),
    unreconciledMinor: Number(u?.amount_minor ?? 0),
    openPastPeriods: periods.count ?? 0,
    mtdNetIncomeMinor: pnl.netIncome,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If `getArAgeing`/`getApAgeing` return type field names differ, align to the actual `AgeingReport` shape from `lib/services/ageing.ts` — it exposes `buckets: Record<string, number>`.)

- [ ] **Step 4: Commit**

```bash
git add lib/services/cashflow.ts lib/services/dashboard.ts
git commit -m "feat: cash-flow + dashboard-metrics services"
```

---

## Task 4: Server actions

**Files:**
- Create: `app/(app)/reports/cash-flow/actions.ts`

**Interfaces:**
- Consumes: `getCashFlow` (Task 3); `cashFlowRangeSchema` (Task 2).
- Produces `cashFlowAction(raw: unknown): Promise<ActionResult<CashFlowReport>>`. (The dashboard page is a server component that calls `getDashboardMetrics` directly — no action needed for it.)

- [ ] **Step 1: Write the action**

```typescript
// app/(app)/reports/cash-flow/actions.ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { cashFlowRangeSchema } from "@/lib/domain/schemas";
import { getCashFlow, CashFlowError, type CashFlowReport } from "@/lib/services/cashflow";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

export async function cashFlowAction(raw: unknown): Promise<ActionResult<CashFlowReport>> {
  const parsed = cashFlowRangeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getCashFlow(sb, parsed.data.from, parsed.data.to) };
  } catch (e) {
    return { ok: false, error: e instanceof CashFlowError || e instanceof Error ? e.message : "An unexpected error occurred" };
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add "app/(app)/reports/cash-flow/actions.ts"
git commit -m "feat: cash-flow server action"
```

---

## Task 5: UI — Cash Flow report + Dashboard rebuild + nav

**Files:**
- Create: `app/(app)/reports/cash-flow/page.tsx`, `app/(app)/reports/cash-flow/CashFlowClient.tsx`
- Modify: `app/(app)/dashboard/page.tsx`, `app/(app)/dashboard/DashboardClient.tsx`
- Modify: `components/AppShell.tsx` (optional Cash Flow nav entry)

Read `app/(app)/reports/ar-ageing/ArAgeingClient.tsx` (Task 13 of the AR/AP module) and the current `dashboard/DashboardClient.tsx` for AntD conventions (`App.useApp()`, `Statistic`, `fromMinor`).

- [ ] **Step 1: Cash Flow page + client**

```tsx
// app/(app)/reports/cash-flow/page.tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import CashFlowClient from "./CashFlowClient";

export const dynamic = "force-dynamic";

export default async function CashFlowPage() {
  const sb = await createSupabaseServerClient();
  const base = (await listCurrencies(sb)).find((c) => c.is_base);
  return (
    <div>
      <PageHeader title="Cash Flow Statement" description="Direct method — cash movement by activity, reconciled to the change in cash." />
      <CashFlowClient baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2} />
    </div>
  );
}
```

```tsx
// app/(app)/reports/cash-flow/CashFlowClient.tsx
"use client";
import { useState } from "react";
import { App, Alert, Button, DatePicker, Space, Table, Typography } from "antd";
import { fromMinor } from "@/lib/domain/money";
import { cashFlowAction } from "./actions";
import type { CashFlowReport } from "@/lib/services/cashflow";

export default function CashFlowClient({ baseCurrency, baseDecimals }: { baseCurrency: string; baseDecimals: number }) {
  const { message } = App.useApp();
  const [range, setRange] = useState<[import("dayjs").Dayjs, import("dayjs").Dayjs] | null>(null);
  const [rep, setRep] = useState<CashFlowReport | null>(null);
  const [loading, setLoading] = useState(false);
  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  const run = async () => {
    if (!range) { message.warning("Pick a date range"); return; }
    setLoading(true);
    const r = await cashFlowAction({ from: range[0].format("YYYY-MM-DD"), to: range[1].format("YYYY-MM-DD") });
    setLoading(false);
    if (r.ok && r.data) setRep(r.data); else message.error(r.error ?? "Failed");
  };

  const rows = rep
    ? [
        { key: "operating", label: "Operating activities", amount: rep.operating },
        { key: "investing", label: "Investing activities", amount: rep.investing },
        { key: "financing", label: "Financing activities", amount: rep.financing },
        { key: "net", label: "Net change in cash", amount: rep.netChange },
      ]
    : [];

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space>
        <DatePicker.RangePicker value={range} onChange={(v) => setRange(v as [import("dayjs").Dayjs, import("dayjs").Dayjs])} />
        <Button type="primary" loading={loading} onClick={run}>Run</Button>
      </Space>
      {rep && (
        <>
          <Typography.Text type="secondary">Base currency {baseCurrency} · Accrual basis</Typography.Text>
          <Table rowKey="key" pagination={false} dataSource={rows}
            columns={[
              { title: "Activity", dataIndex: "label", render: (t, r) => r.key === "net" ? <b>{t}</b> : t },
              { title: "Amount", align: "right", render: (_, r) => r.key === "net" ? <b>{fmt(r.amount)}</b> : fmt(r.amount) },
            ]} />
          <Alert
            type={rep.tiesOut ? "success" : "warning"}
            message={`Opening ${fmt(rep.openingMinor)} + Net ${fmt(rep.netChange)} = Closing ${fmt(rep.closingMinor)} ${baseCurrency}` + (rep.tiesOut ? " ✓ reconciled" : " — does not reconcile, investigate")} />
        </>
      )}
    </Space>
  );
}
```

- [ ] **Step 2: Rebuild the dashboard**

```tsx
// app/(app)/dashboard/page.tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { getDashboardMetrics } from "@/lib/services/dashboard";
import { listCurrencies } from "@/lib/services/reference";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const sb = await createSupabaseServerClient();
  const [metrics, currencies] = await Promise.all([getDashboardMetrics(sb), listCurrencies(sb)]);
  const base = currencies.find((c) => c.is_base);
  return <DashboardClient metrics={metrics} baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2} />;
}
```

```tsx
// app/(app)/dashboard/DashboardClient.tsx
"use client";
import Link from "next/link";
import { Card, Col, Row, Statistic } from "antd";
import PageHeader from "@/components/PageHeader";
import { fromMinor } from "@/lib/domain/money";
import type { DashboardMetrics } from "@/lib/services/dashboard";

export default function DashboardClient({ metrics, baseCurrency, baseDecimals }: { metrics: DashboardMetrics; baseCurrency: string; baseDecimals: number }) {
  const fmt = (m: number) => `${fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals })} ${baseCurrency}`;
  const cards: { title: string; value: string; href: string; hint?: string }[] = [
    { title: "Cash position", value: fmt(metrics.cashMinor), href: "/reports/cash-flow" },
    { title: "Overdue receivables", value: fmt(metrics.overdueArMinor), href: "/reports/ar-ageing" },
    { title: "Overdue payables", value: fmt(metrics.overdueApMinor), href: "/reports/ap-ageing" },
    { title: "Unreconciled bank items", value: `${metrics.unreconciledCount} · ${fmt(metrics.unreconciledMinor)}`, href: "/banking/reconcile" },
    { title: "Open periods past end date", value: String(metrics.openPastPeriods), href: "/settings/periods" },
    { title: "Net income (this month)", value: fmt(metrics.mtdNetIncomeMinor), href: "/reports" },
  ];
  return (
    <div>
      <PageHeader title="Dashboard" description="Actionable exceptions across receivables, payables, cash, and close." />
      <Row gutter={[16, 16]}>
        {cards.map((c) => (
          <Col xs={24} sm={12} md={8} key={c.title}>
            <Link href={c.href}>
              <Card hoverable><Statistic title={c.title} value={c.value} /></Card>
            </Link>
          </Col>
        ))}
      </Row>
    </div>
  );
}
```

- [ ] **Step 3: Nav (Cash Flow)**

In `components/AppShell.tsx`, the reports live under `/reports/*`; Cash Flow is reachable at `/reports/cash-flow`. Add a top-level nav entry only if the file lists individual report links; otherwise leave it (Dashboard already links to it). If adding, reuse an already-imported icon (e.g. `BarChartOutlined`):

```tsx
  { key: "/reports/cash-flow", icon: <BarChartOutlined />, label: "Cash Flow" },
```

(Only add if it compiles with an already-imported icon; do not add a new import.)

- [ ] **Step 4: Build + lint + typecheck**

Run: `npm run build && npm run lint && npm run typecheck`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/reports/cash-flow" "app/(app)/dashboard" components/AppShell.tsx
git commit -m "feat: Cash Flow report page + actionable dashboard"
```

---

## Task 6: E2E verify + full verification

**Files:**
- Create: `scripts/verify-cashflow.mjs`

**Interfaces:** consumes applied migration 0030; seeded admin login; accounts bank `1010`, income `4000`, and an equity account (`3000` Owner Equity) + a fixed-asset account (find one, e.g. by `account_type='fixed_asset'`; if none exists, create one via `acc_account` insert as admin).

- [ ] **Step 1: Write the verify script**

Follow the structure of `scripts/verify-journal.mjs` (admin login, `pg.Client`, `check()` helper, void-before-delete self-cleanup). Steps:
1. Record opening cash: `select acc_ledger_balances`-equivalent for bank, or compute via the RPCs. Simpler: capture bank balance before, run the flows, capture after.
2. Post three manual journals via `acc_post_manual_journal` in a chosen open month (e.g. 2026-05):
   - Sales receipt: DR bank `1010` 300_00 / CR income `4000` 300_00 → Operating +300.
   - Fixed-asset purchase: DR fixed_asset 100_00 / CR bank 100_00 → Investing −100.
   - Owner contribution: DR bank 50_00 / CR equity `3000` 50_00 → Financing +50.
   - A bank-to-bank transfer (needs a 2nd bank account; if only one bank account, skip this sub-check or create a 2nd `bank`-type account): DR bank2 25_00 / CR bank1 25_00 → contributes 0 to all categories.
3. Call `acc_cash_flow(from, to)` for the month → assert operating=300_00, investing=−100_00, financing=50_00.
4. Compute opening/closing bank balance (sum bank `debit−credit` before `from` and through `to`) → assert `operating+investing+financing == closing − opening` (net change 250_00, plus the transfer nets 0).
5. `acc_unreconciled_bank(to)` → returns a positive count/amount (these new bank lines are unreconciled) — assert count ≥ the number of bank lines posted.

To find/create a fixed-asset account: `select id from acc_account where account_type='fixed_asset' and is_posting_account and status='active' limit 1`; if none, insert one (`account_code='1500', name='Equipment', account_type='fixed_asset'`).

Cleanup (transaction, void-before-delete): `update acc_journal_entry set status='void'`; `delete from acc_journal_line`; `delete from acc_journal_entry`; delete any account/2nd-bank-account created by the test; reset sequences.

- [ ] **Step 2: Apply migration, then run**

Apply 0030: `node --env-file=.env.local scripts/migrate.mjs`.
Run: `node --env-file=.env.local scripts/verify-cashflow.mjs`
Expected: all checks `PASS`, clean cleanup. If the RPC is missing, apply the migration and re-run; do not claim a pass otherwise.

- [ ] **Step 3: Full project verification (mandatory, paste real output)**

Run: `npm run build && npm test && npm run typecheck && npm run lint`
Expected: build succeeds; all unit tests pass (existing + new cashflow tests); typecheck + lint clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-cashflow.mjs
git commit -m "test: end-to-end verify for cash flow statement"
```

---

## Self-Review

**Spec coverage:**
- US-FR-100 (Cash Flow Statement, reconciles to the same ledger) → Tasks 1,2,3,4,5,6 (direct method; tie-out to cash-balance change).
- US-FR-103 (actionable dashboard: overdue receivables, due payables, unreconciled items, close exceptions) → Tasks 3,5 (cards for overdue AR/AP, unreconciled bank items, open-past-end periods, plus cash position + MTD net income). Pending-approvals and failed-imports cards intentionally omitted (Modules C/K not built) — noted.
- Manual ch.08 dashboard exceptions → same as above.
- Deferred (indirect method, cash-basis P&L, saved/scheduled reports) → out of scope per spec §1.

**Placeholder scan:** Task 1 shows a scaffolded draft then the FINAL form with an explicit "use only the final form / remove the where-false scaffold" instruction and a sanity check that fails if `where false` remains — the implementer transcribes the final block. Task 6's verify script is described step-by-step with exact postings/asserts (mirrors the established verify-*.mjs). All other tasks contain complete code. No "TBD".

**Type consistency:** `CashFlowReport` = `CashFlowAssembled` used in Tasks 3, 4, 5. `cashFlowCategoryOf`/`assembleCashFlow` signatures match between Tasks 2 and 3. `DashboardMetrics` shape matches between Tasks 3 and 5. RPC names/params (`acc_cash_flow`, `acc_unreconciled_bank`) match between Tasks 1 and 3. `getArAgeing`/`getApAgeing` return an `AgeingReport` with `buckets: Record<string,number>` (from the AR/AP module) — the `overdue()` helper sums all non-`current` buckets; Task 3 Step 3 flags aligning to the real shape.

**Tie-out note:** the statement's category totals come from non-bank lines of bank-touching entries, and opening/closing come from `getLedgerBalances` over bank accounts — both derive from the same posted ledger, so `operating+investing+financing == closing−opening` holds by double-entry; the UI surfaces `tiesOut` and never hides a mismatch.
