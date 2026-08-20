# What-If Financial Analysis + Frozen Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An analysis workspace where a user overlays balanced hypothetical adjustments on real P&L and Balance Sheet data — never touching the ledger — and can freeze the result as a write-once snapshot report.

**Architecture:** Adjustments are signed account deltas validated to balance (debits = credits), applied in memory to the same `LedgerBalance[]` rows the existing reports read. Because `buildBalanceSheet` derives "Current earnings" from those same rows, a balanced adjustment flows P&L → equity automatically and the sheet stays balanced by construction. Freezing recomputes the snapshot **server-side** from (period, adjustments) and stores it as jsonb through a security-definer RPC; there is no insert/update policy on the table, and nothing anywhere calls `acc_post_entry`.

**Tech Stack:** Next.js 16 App Router, antd 6, Supabase (Postgres RLS + RPC), Zod, Vitest.

## Requester's own words (feedback, 2026-08)

> "we can use data and do a financial analysis. meaning it will not be saved on the data which is used as data for the report … for example even three in p&l margins, we can see if the adjustment makes sense or works bottom and sheets … actually we can save it as a report, as a frozen report, as a capture report but it does not save to the data because it's just an analysis data."

## Global Constraints

- Money is minor units end-to-end; convert to decimal only at the UI edge.
- **Never write to `acc_journal_*` from this feature.** No path here may call `acc_post_entry`. A verify script proves it (Task 5).
- Never trust client-sent totals — the frozen snapshot is recomputed server-side.
- All UI copy is US English.
- Every new migration must reach every company: run `node scripts/migrate.mjs` (loops the register) then `npm run verify:company-provisioning`.
- Server Components must not read antd sub-components (`Typography.Title`, …) — page.tsx stays a thin server wrapper.
- Ship gate: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, then `scripts/smoke-pages.mjs` against `npm start`. Never trim test output.
- Add a Release entry to `lib/domain/changelog.ts` (next version at ship time; app was at 1.42 when this plan was written).
- Commits: no Claude attribution; push only to `quocviet-IT` remote.

## Decisions taken (flag to the user if changing)

1. **v1 scope is P&L + Balance Sheet.** Cash flow later — the accounting equation ties P&L to BS automatically; cash flow needs activity classification that adjustments don't carry.
2. **An adjustment is a balanced set of signed account deltas** (positive = debit, negative = credit), the minimal unit that keeps the sheet balanced. Multi-line allowed, like a journal entry.
3. **Frozen reports are write-once.** No edit; archive like saved reports. "Editing" = load a frozen report's adjustments back into the workspace and freeze a new one.
4. **Permissions:** any signed-in member may run the workspace and read frozen reports (`acc_current_role() is not null`, same as every report); freezing and archiving require staff (`acc_is_staff()` in the RPC, `canWrite()` in the action) — same honest pair used elsewhere.
5. **Route** `/reports/analysis`, one screen holding workspace + frozen list; a card in `report-catalog.ts` (group `accounting`).

## File Structure

| File | Responsibility |
|---|---|
| `lib/domain/financial-analysis.ts` (create) | Pure logic: adjustment types, validation, applying deltas to `LedgerBalance[]`, composing the what-if result, frozen-snapshot Zod schema |
| `tests/unit/financial-analysis.test.ts` (create) | TDD home for all of the above |
| `supabase/migrations/0115_financial_analysis.sql` (create) | `acc_financial_analysis` table, RLS, freeze + archive RPCs |
| `lib/db/types.ts` (modify) | `FinancialAnalysisRow`, `FinancialAnalysisStatus` |
| `lib/services/financial-analysis.ts` (create) | Freeze/list/get/archive against Supabase |
| `scripts/verify-financial-analysis.mjs` (create) | Proves the RPC stores a row and the journal is untouched (rollback pattern) |
| `package.json` (modify) | `verify:financial-analysis` script line |
| `app/(app)/reports/analysis/actions.ts` (create) | Guarded server actions: load data, freeze, archive |
| `app/(app)/reports/analysis/page.tsx` (create) | Thin server wrapper |
| `app/(app)/reports/analysis/AnalysisClient.tsx` (create) | Workspace UI: period picker, adjustment editor, freeze modal, frozen list |
| `app/(app)/reports/analysis/AnalysisReportTables.tsx` (create) | Presentational Actual / Adjustment / Adjusted tables — reused by the live workspace and the frozen viewer |
| `lib/domain/report-catalog.ts` (modify) | Card for the reports hub |
| `lib/domain/changelog.ts` (modify) | Release entry |

---

### Task 1: Adjustment types and validation

**Files:**
- Create: `lib/domain/financial-analysis.ts`
- Test: `tests/unit/financial-analysis.test.ts`

**Interfaces:**
- Consumes: `AccountType` from `@/lib/db/types`.
- Produces: `AdjustmentLine { accountId: string; deltaMinor: number }`, `AnalysisAdjustment { key: string; label: string; lines: AdjustmentLine[] }`, `validateAdjustment(adj: AnalysisAdjustment): string | null` (English message, or null when valid).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/financial-analysis.test.ts
import { describe, expect, it } from "vitest";
import { validateAdjustment } from "@/lib/domain/financial-analysis";

const balanced = {
  key: "a1",
  label: "Recognize December revenue",
  lines: [
    { accountId: "acc-ar", deltaMinor: 100_000 },
    { accountId: "acc-sales", deltaMinor: -100_000 },
  ],
};

describe("validateAdjustment", () => {
  it("accepts a balanced two-line adjustment", () => {
    expect(validateAdjustment(balanced)).toBeNull();
  });

  it("rejects an unbalanced adjustment, naming both sides", () => {
    const msg = validateAdjustment({
      ...balanced,
      lines: [
        { accountId: "acc-ar", deltaMinor: 100_000 },
        { accountId: "acc-sales", deltaMinor: -90_000 },
      ],
    });
    expect(msg).toMatch(/debits .*1,000\.00.* credits .*900\.00/);
  });

  it("rejects fewer than two lines — one leg cannot balance", () => {
    expect(validateAdjustment({ ...balanced, lines: [balanced.lines[0]] })).toMatch(
      /at least two lines/i,
    );
  });

  it("rejects a zero or non-integer delta", () => {
    expect(
      validateAdjustment({
        ...balanced,
        lines: [
          { accountId: "acc-ar", deltaMinor: 0 },
          { accountId: "acc-sales", deltaMinor: 0 },
        ],
      }),
    ).toMatch(/zero/i);
    expect(
      validateAdjustment({
        ...balanced,
        lines: [
          { accountId: "acc-ar", deltaMinor: 100.5 },
          { accountId: "acc-sales", deltaMinor: -100.5 },
        ],
      }),
    ).toMatch(/whole minor units/i);
  });

  it("rejects a blank label — a frozen report must say what was assumed", () => {
    expect(validateAdjustment({ ...balanced, label: "  " })).toMatch(/label/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/financial-analysis.test.ts`
Expected: FAIL — module `@/lib/domain/financial-analysis` not found.

- [ ] **Step 3: Implement**

```ts
// lib/domain/financial-analysis.ts
/**
 * What-if financial analysis: hypothetical, balanced adjustments laid over
 * real ledger balances. Nothing in this module writes anywhere — the entire
 * point of the feature is that the analysis "does not save to the data"
 * (the requester's words). The one persistent artifact is a frozen snapshot,
 * and even that is a photograph of a rendering, never a journal entry.
 */

export interface AdjustmentLine {
  accountId: string;
  /** Signed, minor units: positive adds to the debit side, negative to credit. */
  deltaMinor: number;
}

export interface AnalysisAdjustment {
  /** Client-generated key, unique within one workspace session. */
  key: string;
  label: string;
  lines: AdjustmentLine[];
}

function money(minor: number): string {
  return (Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

/** Null when the adjustment could be a real journal entry; a reason otherwise. */
export function validateAdjustment(adj: AnalysisAdjustment): string | null {
  if (adj.label.trim().length === 0) {
    return "Give the adjustment a label — a frozen report must say what was assumed.";
  }
  if (adj.lines.length < 2) {
    return "An adjustment needs at least two lines; one leg cannot balance.";
  }
  for (const line of adj.lines) {
    if (!Number.isInteger(line.deltaMinor)) {
      return "Amounts must be whole minor units.";
    }
    if (line.deltaMinor === 0) {
      return "A line of zero changes nothing — remove it or give it an amount.";
    }
  }
  const debits = adj.lines.reduce((s, l) => s + Math.max(l.deltaMinor, 0), 0);
  const credits = adj.lines.reduce((s, l) => s - Math.min(l.deltaMinor, 0), 0);
  if (debits !== credits) {
    return `Adjustment does not balance: debits ${money(debits)} vs credits ${money(credits)}.`;
  }
  return null;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/financial-analysis.test.ts` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/financial-analysis.ts ctyhp-accounting/tests/unit/financial-analysis.test.ts
git commit -m "feat(analysis): adjustment shape and the rule that it must balance"
```

---

### Task 2: Applying adjustments and composing the what-if

**Files:**
- Modify: `lib/domain/financial-analysis.ts`
- Test: `tests/unit/financial-analysis.test.ts`

**Interfaces:**
- Consumes: `LedgerBalance`, `ProfitAndLoss`, `BalanceSheet`, `buildProfitAndLoss`, `buildBalanceSheet` from `@/lib/domain/reports`; `AccountType` from `@/lib/db/types`.
- Produces:
  - `AdjustableAccount { accountId: string; accountCode: string; name: string; accountType: AccountType }`
  - `applyAdjustments(rows: LedgerBalance[], adjustments: AnalysisAdjustment[], accounts: AdjustableAccount[]): LedgerBalance[]` — pure; never mutates `rows`; throws on an accountId absent from `accounts`.
  - `WhatIfAnalysis { pnl: { actual: ProfitAndLoss; adjusted: ProfitAndLoss }; balanceSheet: { actual: BalanceSheet; adjusted: BalanceSheet } }`
  - `buildWhatIfAnalysis(pnlRows: LedgerBalance[], bsRows: LedgerBalance[], adjustments: AnalysisAdjustment[], accounts: AdjustableAccount[]): WhatIfAnalysis`

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/unit/financial-analysis.test.ts
import {
  applyAdjustments,
  buildWhatIfAnalysis,
} from "@/lib/domain/financial-analysis";
import type { LedgerBalance } from "@/lib/domain/reports";

const ACCOUNTS = [
  { accountId: "acc-ar", accountCode: "1100", name: "Accounts Receivable", accountType: "accounts_receivable" as const },
  { accountId: "acc-sales", accountCode: "4000", name: "Sales", accountType: "income" as const },
  { accountId: "acc-rent", accountCode: "6100", name: "Rent", accountType: "expense" as const },
];

const PNL_ROWS: LedgerBalance[] = [
  { accountId: "acc-sales", accountCode: "4000", name: "Sales", accountType: "income", debitBase: 0, creditBase: 500_000 },
];
const BS_ROWS: LedgerBalance[] = [
  ...PNL_ROWS,
  { accountId: "acc-ar", accountCode: "1100", name: "Accounts Receivable", accountType: "accounts_receivable", debitBase: 500_000, creditBase: 0 },
];

const REVENUE_UP = {
  key: "a1",
  label: "Recognize December revenue",
  lines: [
    { accountId: "acc-ar", deltaMinor: 100_000 },
    { accountId: "acc-sales", deltaMinor: -100_000 },
  ],
};

describe("applyAdjustments", () => {
  it("adds a positive delta to debits and a negative one to credits", () => {
    const out = applyAdjustments(BS_ROWS, [REVENUE_UP], ACCOUNTS);
    expect(out.find((r) => r.accountId === "acc-ar")).toMatchObject({ debitBase: 600_000 });
    expect(out.find((r) => r.accountId === "acc-sales")).toMatchObject({ creditBase: 600_000 });
  });

  it("never mutates the actual rows — actual and adjusted must coexist", () => {
    applyAdjustments(BS_ROWS, [REVENUE_UP], ACCOUNTS);
    expect(BS_ROWS.find((r) => r.accountId === "acc-ar")?.debitBase).toBe(500_000);
  });

  it("synthesizes a row for an account with no activity in the period", () => {
    const rentUp = {
      key: "a2",
      label: "Assume market rent",
      lines: [
        { accountId: "acc-rent", deltaMinor: 50_000 },
        { accountId: "acc-ar", deltaMinor: -50_000 },
      ],
    };
    const out = applyAdjustments(BS_ROWS, [rentUp], ACCOUNTS);
    expect(out.find((r) => r.accountId === "acc-rent")).toMatchObject({
      accountCode: "6100",
      accountType: "expense",
      debitBase: 50_000,
    });
  });

  it("throws on an account the chart does not know", () => {
    const ghost = { ...REVENUE_UP, lines: [{ accountId: "nope", deltaMinor: 1 }, { accountId: "acc-ar", deltaMinor: -1 }] };
    expect(() => applyAdjustments(BS_ROWS, [ghost], ACCOUNTS)).toThrow(/unknown account/i);
  });
});

describe("buildWhatIfAnalysis", () => {
  it("flows a revenue adjustment from the P&L to a still-balanced sheet", () => {
    const out = buildWhatIfAnalysis(PNL_ROWS, BS_ROWS, [REVENUE_UP], ACCOUNTS);
    expect(out.pnl.actual.netIncome).toBe(500_000);
    expect(out.pnl.adjusted.netIncome).toBe(600_000);
    expect(out.balanceSheet.adjusted.totalAssets).toBe(600_000);
    expect(out.balanceSheet.adjusted.totalEquity).toBe(600_000);
    expect(out.balanceSheet.actual.balanced).toBe(true);
    expect(out.balanceSheet.adjusted.balanced).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/financial-analysis.test.ts` → FAIL (`applyAdjustments` not exported).

- [ ] **Step 3: Implement**

```ts
// append to lib/domain/financial-analysis.ts
import type {
  BalanceSheet,
  LedgerBalance,
  ProfitAndLoss,
} from "@/lib/domain/reports";
import { buildBalanceSheet, buildProfitAndLoss } from "@/lib/domain/reports";
import type { AccountType } from "@/lib/db/types";

export interface AdjustableAccount {
  accountId: string;
  accountCode: string;
  name: string;
  accountType: AccountType;
}

/**
 * Lay the adjustments over the balances, returning new rows.
 *
 * An account can carry an adjustment while having no activity in the period —
 * assuming rent for a company that has never paid rent is a normal what-if —
 * so missing rows are synthesized from the chart at zero. An account the
 * chart itself does not know is a caller bug, not a scenario, and throws.
 */
export function applyAdjustments(
  rows: LedgerBalance[],
  adjustments: AnalysisAdjustment[],
  accounts: AdjustableAccount[],
): LedgerBalance[] {
  const byId = new Map(rows.map((r) => [r.accountId, { ...r }]));
  const chart = new Map(accounts.map((a) => [a.accountId, a]));
  for (const adj of adjustments) {
    for (const line of adj.lines) {
      let row = byId.get(line.accountId);
      if (!row) {
        const account = chart.get(line.accountId);
        if (!account) throw new Error(`Unknown account in adjustment: ${line.accountId}`);
        row = {
          accountId: account.accountId,
          accountCode: account.accountCode,
          name: account.name,
          accountType: account.accountType,
          debitBase: 0,
          creditBase: 0,
        };
        byId.set(line.accountId, row);
      }
      if (line.deltaMinor > 0) row.debitBase += line.deltaMinor;
      else row.creditBase += -line.deltaMinor;
    }
  }
  return [...byId.values()];
}

export interface WhatIfAnalysis {
  pnl: { actual: ProfitAndLoss; adjusted: ProfitAndLoss };
  balanceSheet: { actual: BalanceSheet; adjusted: BalanceSheet };
}

/**
 * The same adjustments hit both row sets: a what-if entry is dated inside the
 * period, so it moves the period's P&L and the as-of sheet together. Because
 * buildBalanceSheet derives Current earnings from its own rows, a balanced
 * adjustment keeps the adjusted sheet balanced with no extra bookkeeping here.
 */
export function buildWhatIfAnalysis(
  pnlRows: LedgerBalance[],
  bsRows: LedgerBalance[],
  adjustments: AnalysisAdjustment[],
  accounts: AdjustableAccount[],
): WhatIfAnalysis {
  return {
    pnl: {
      actual: buildProfitAndLoss(pnlRows),
      adjusted: buildProfitAndLoss(applyAdjustments(pnlRows, adjustments, accounts)),
    },
    balanceSheet: {
      actual: buildBalanceSheet(bsRows),
      adjusted: buildBalanceSheet(applyAdjustments(bsRows, adjustments, accounts)),
    },
  };
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/financial-analysis.test.ts` → PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/financial-analysis.ts ctyhp-accounting/tests/unit/financial-analysis.test.ts
git commit -m "feat(analysis): adjustments flow from the P&L to a still-balanced sheet"
```

---

### Task 3: Frozen-snapshot input schema

**Files:**
- Modify: `lib/domain/financial-analysis.ts`
- Test: `tests/unit/financial-analysis.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces: `freezeAnalysisSchema` (Zod), `FreezeAnalysisInput` — what the client is allowed to send: title, notes, period, adjustments. **The snapshot itself is not client input**; the server recomputes it (CLAUDE.md: never trust client-sent totals).

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/unit/financial-analysis.test.ts
import { freezeAnalysisSchema } from "@/lib/domain/financial-analysis";

describe("freezeAnalysisSchema", () => {
  const good = {
    title: "FY2026 margin scenario",
    notes: null,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    adjustments: [REVENUE_UP],
  };

  it("accepts a complete freeze request", () => {
    expect(freezeAnalysisSchema.safeParse(good).success).toBe(true);
  });

  it("refuses an empty adjustment list — a frozen actual is just a report", () => {
    expect(freezeAnalysisSchema.safeParse({ ...good, adjustments: [] }).success).toBe(false);
  });

  it("refuses a period that ends before it starts", () => {
    expect(
      freezeAnalysisSchema.safeParse({ ...good, periodStart: "2026-12-31", periodEnd: "2026-01-01" }).success,
    ).toBe(false);
  });

  it("refuses an adjustment that does not balance", () => {
    const bad = { ...REVENUE_UP, lines: [{ accountId: "a", deltaMinor: 5 }, { accountId: "b", deltaMinor: -4 }] };
    expect(freezeAnalysisSchema.safeParse({ ...good, adjustments: [bad] }).success).toBe(false);
  });

  it("caps the adjustment count at 50", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ ...REVENUE_UP, key: `k${i}` }));
    expect(freezeAnalysisSchema.safeParse({ ...good, adjustments: many }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (`freezeAnalysisSchema` not exported).

- [ ] **Step 3: Implement**

```ts
// append to lib/domain/financial-analysis.ts
import { z } from "zod";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const adjustmentLineSchema = z.object({
  accountId: z.string().uuid(),
  deltaMinor: z.number().int().refine((n) => n !== 0, "A line of zero changes nothing."),
});

const adjustmentSchema = z
  .object({
    key: z.string().min(1).max(64),
    label: z.string().trim().min(1, "Give the adjustment a label.").max(200),
    lines: z.array(adjustmentLineSchema).min(2).max(30),
  })
  .refine((adj) => validateAdjustment(adj) === null, {
    message: "Adjustment does not balance.",
  });

export const freezeAnalysisSchema = z
  .object({
    title: z.string().trim().min(1, "Give the analysis a title.").max(120),
    notes: z.string().trim().max(2000).nullable(),
    periodStart: z.string().regex(ISO_DATE),
    periodEnd: z.string().regex(ISO_DATE),
    adjustments: z.array(adjustmentSchema).min(1, "Freeze at least one adjustment.").max(50),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: "The period cannot end before it starts.",
  });

export type FreezeAnalysisInput = z.infer<typeof freezeAnalysisSchema>;
```

Note: `adjustmentLineSchema` uses `z.string().uuid()` — the test fixtures in Tasks 1–2 use ids like `"acc-ar"`, which never pass through this schema; the schema tests must use real UUID strings (e.g. `"7d3f2b1a-0000-4000-8000-000000000001"`). Adjust the `REVENUE_UP` reference in the schema tests to a UUID-bearing copy:

```ts
const UUID_A = "7d3f2b1a-0000-4000-8000-000000000001";
const UUID_B = "7d3f2b1a-0000-4000-8000-000000000002";
const REVENUE_UP_UUID = {
  key: "a1",
  label: "Recognize December revenue",
  lines: [
    { accountId: UUID_A, deltaMinor: 100_000 },
    { accountId: UUID_B, deltaMinor: -100_000 },
  ],
};
// use REVENUE_UP_UUID (not REVENUE_UP) inside the freezeAnalysisSchema describe block
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/financial-analysis.test.ts` → PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/financial-analysis.ts ctyhp-accounting/tests/unit/financial-analysis.test.ts
git commit -m "feat(analysis): the freeze request schema recomputes nothing it can reject"
```

---

### Task 4: Migration 0115 — the frozen-analysis table and its two RPCs

**Files:**
- Create: `supabase/migrations/0115_financial_analysis.sql`
- Modify: `lib/db/types.ts` (append row types)

**Interfaces:**
- Produces: table `acc_financial_analysis`; RPC `acc_freeze_financial_analysis(p_title, p_notes, p_period_start, p_period_end, p_adjustments jsonb, p_snapshot jsonb) returns uuid`; RPC `acc_archive_financial_analysis(p_id uuid, p_reason text) returns void`; TS types `FinancialAnalysisStatus`, `FinancialAnalysisRow`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0115_financial_analysis.sql
-- ============================================================================
-- 0115  A frozen what-if analysis
--
-- Asked for in feedback, 2026-08: "we can use data and do a financial
-- analysis … we can save it as a frozen report … but it does not save to the
-- data because it's just an analysis data."
--
-- A row here is a photograph: the adjustments someone assumed and the report
-- those assumptions produced, computed by the application at the moment of
-- freezing. Nothing in this migration calls acc_post_entry, writes a journal
-- line, or touches a document — and scripts/verify-financial-analysis.mjs
-- asserts that rather than trusting this comment.
-- ============================================================================

set search_path = public;

create table if not exists acc_financial_analysis (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(btrim(title)) > 0),
  notes          text,
  period_start   date not null,
  period_end     date not null,
  adjustments    jsonb not null,
  snapshot       jsonb not null,
  status         text not null default 'active' check (status in ('active', 'archived')),
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  archived_by    uuid references auth.users (id),
  archived_at    timestamptz,
  archive_reason text,
  check (period_end >= period_start),
  -- A snapshot is a rendering, not a data lake. These caps keep a runaway
  -- client from storing megabytes per click.
  check (pg_column_size(adjustments) <= 65536),
  check (pg_column_size(snapshot) <= 262144)
);

create index if not exists acc_financial_analysis_listing_idx
  on acc_financial_analysis (status, created_at desc);

alter table acc_financial_analysis enable row level security;

drop policy if exists acc_financial_analysis_sel on acc_financial_analysis;
create policy acc_financial_analysis_sel on acc_financial_analysis
  for select using (acc_current_role() is not null);

-- No insert, update or delete policy exists: an application session can only
-- write this table through the two functions below.
revoke all on table acc_financial_analysis from public, anon;
grant select on table acc_financial_analysis to authenticated;
grant all    on table acc_financial_analysis to service_role;

create or replace function acc_freeze_financial_analysis(
  p_title        text,
  p_notes        text,
  p_period_start date,
  p_period_end   date,
  p_adjustments  jsonb,
  p_snapshot     jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to freeze an analysis';
  end if;
  if jsonb_typeof(p_adjustments) <> 'array' or jsonb_array_length(p_adjustments) = 0 then
    raise exception 'A frozen analysis must carry at least one adjustment';
  end if;

  insert into acc_financial_analysis (
    title, notes, period_start, period_end, adjustments, snapshot, created_by
  ) values (
    p_title, p_notes, p_period_start, p_period_end, p_adjustments, p_snapshot, auth.uid()
  ) returning id into v_id;

  return v_id;
end $$;

create or replace function acc_archive_financial_analysis(
  p_id     uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to archive an analysis';
  end if;

  update acc_financial_analysis
     set status = 'archived',
         archived_by = auth.uid(),
         archived_at = now(),
         archive_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_id and status = 'active';

  if not found then
    raise exception 'Analysis not found or already archived';
  end if;
end $$;

revoke all on function acc_freeze_financial_analysis(text, text, date, date, jsonb, jsonb) from public, anon;
grant execute on function acc_freeze_financial_analysis(text, text, date, date, jsonb, jsonb) to authenticated, service_role;
revoke all on function acc_archive_financial_analysis(uuid, text) from public, anon;
grant execute on function acc_archive_financial_analysis(uuid, text) to authenticated, service_role;
```

- [ ] **Step 2: Append the row types**

```ts
// append to lib/db/types.ts
export type FinancialAnalysisStatus = "active" | "archived";

export interface FinancialAnalysisRow {
  id: string;
  title: string;
  notes: string | null;
  period_start: string;
  period_end: string;
  adjustments: unknown; // AnalysisAdjustment[] as stored jsonb — parse, never trust
  snapshot: unknown; // WhatIfAnalysis as stored jsonb
  status: FinancialAnalysisStatus;
  created_by: string | null;
  created_at: string;
  archived_by: string | null;
  archived_at: string | null;
  archive_reason: string | null;
}
```

- [ ] **Step 3: Apply to every company and self-check**

Run: `node scripts/migrate.mjs` (loops the register — applies 0115 to public and every company schema).
Expected: each schema reports 0115 applied.
Run: `npm run verify:company-provisioning`
Expected: PASS — no orphaned functions, template matches public.

- [ ] **Step 4: Typecheck** — `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/supabase/migrations/0115_financial_analysis.sql ctyhp-accounting/lib/db/types.ts
git commit -m "feat(analysis): a frozen analysis is a photograph, never a posting (0115)"
```

---

### Task 5: Prove the freeze writes no ledger row

**Files:**
- Create: `scripts/verify-financial-analysis.mjs`
- Modify: `package.json` (scripts block)

**Interfaces:**
- Consumes: the `request.jwt.claims` transaction-rollback harness pattern from `scripts/verify-saved-reports.mjs` (copy its connection + auth setup verbatim; it authenticates as a real staff user inside a transaction it rolls back).
- Produces: `npm run verify:financial-analysis`.

- [ ] **Step 1: Write the script.** Follow `scripts/verify-saved-reports.mjs` structure exactly (pooler connection, `set local role authenticated`, `set local request.jwt.claims`). Scenarios, all inside one rolled-back transaction:

```js
// scripts/verify-financial-analysis.mjs — skeleton of the scenario section;
// copy the connection/auth harness from scripts/verify-saved-reports.mjs.
const before = await q(`select count(*)::int as n from acc_journal_entry`);

// 1. A staff user freezes an analysis and gets an id back.
const frozen = await q(
  `select acc_freeze_financial_analysis(
     'FY2026 margin scenario', null, '2026-01-01', '2026-12-31',
     '[{"key":"a1","label":"Revenue up","lines":[
        {"accountId":"00000000-0000-4000-8000-000000000001","deltaMinor":100000},
        {"accountId":"00000000-0000-4000-8000-000000000002","deltaMinor":-100000}]}]'::jsonb,
     '{"pnl":{},"balanceSheet":{}}'::jsonb
   ) as id`,
);
assert(frozen.rows[0].id, "freeze returned an id");

// 2. THE POINT: the journal is exactly as it was.
const after = await q(`select count(*)::int as n from acc_journal_entry`);
assert(after.rows[0].n === before.rows[0].n, "freeze wrote no journal entry");

// 3. The row is readable and active.
const row = await q(`select status from acc_financial_analysis where id = $1`, [frozen.rows[0].id]);
assert(row.rows[0].status === "active", "frozen row is active");

// 4. A direct INSERT from an application session is refused (no policy).
await expectError(
  `insert into acc_financial_analysis (title, period_start, period_end, adjustments, snapshot)
   values ('smuggled', '2026-01-01', '2026-01-31', '[]'::jsonb, '{}'::jsonb)`,
  /row-level security/i,
);

// 5. A viewer-role user cannot freeze.
await asRole("viewer", async () => {
  await expectError(`select acc_freeze_financial_analysis('x', null, '2026-01-01', '2026-01-31', '[{"k":1}]'::jsonb, '{}'::jsonb)`, /Not authorized/);
});

// 6. Archive works once and only once.
await q(`select acc_archive_financial_analysis($1, 'test')`, [frozen.rows[0].id]);
await expectError(`select acc_archive_financial_analysis('${frozen.rows[0].id}', 'again')`, /already archived/);
```

- [ ] **Step 2: Register the script**

```json
"verify:financial-analysis": "node --env-file=.env.local scripts/verify-financial-analysis.mjs",
```

- [ ] **Step 3: Run it** — `npm run verify:financial-analysis` → all scenarios PASS, transaction rolled back (no residue).

- [ ] **Step 4: Commit**

```bash
git add ctyhp-accounting/scripts/verify-financial-analysis.mjs ctyhp-accounting/package.json
git commit -m "test(analysis): prove the freeze RPC never touches the journal"
```

---

### Task 6: Service and server actions

**Files:**
- Create: `lib/services/financial-analysis.ts`
- Create: `app/(app)/reports/analysis/actions.ts`

**Interfaces:**
- Consumes: `getLedgerBalances(sb, from, to)` from `@/lib/services/reports`; `freezeAnalysisSchema`, `buildWhatIfAnalysis`, `AdjustableAccount`, `FreezeAnalysisInput` from the domain; `canWrite` from `@/lib/domain/roles`; `getUserRole` from `@/lib/auth`; `resolveActiveCompany`, `createSupabaseServerClient` per every other actions file.
- Produces (service): `freezeFinancialAnalysis(sb, input: FreezeAnalysisInput, snapshot: WhatIfAnalysis): Promise<string>`, `listFinancialAnalyses(sb, includeArchived: boolean): Promise<FinancialAnalysisRow[]>`, `archiveFinancialAnalysis(sb, id: string, reason: string | null): Promise<void>`, `FinancialAnalysisError`.
- Produces (actions): `getAnalysisDataAction(from: string, to: string)` → `{ pnlRows, bsRows, accounts }`; `freezeAnalysisAction(input: FreezeAnalysisInput)` → `{ ok, error?, data?: { id } }`; `archiveAnalysisAction(id, reason)`.

- [ ] **Step 1: Service**

```ts
// lib/services/financial-analysis.ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinancialAnalysisRow } from "@/lib/db/types";
import type { FreezeAnalysisInput, WhatIfAnalysis } from "@/lib/domain/financial-analysis";

export class FinancialAnalysisError extends Error {}

const LIST_COLUMNS =
  "id,title,notes,period_start,period_end,adjustments,snapshot,status," +
  "created_by,created_at,archived_by,archived_at,archive_reason";

export async function freezeFinancialAnalysis(
  sb: SupabaseClient,
  input: FreezeAnalysisInput,
  snapshot: WhatIfAnalysis,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_freeze_financial_analysis", {
    p_title: input.title,
    p_notes: input.notes,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_adjustments: input.adjustments,
    p_snapshot: snapshot,
  });
  if (error) throw new FinancialAnalysisError(error.message);
  return data as string;
}

export async function listFinancialAnalyses(
  sb: SupabaseClient,
  includeArchived: boolean,
): Promise<FinancialAnalysisRow[]> {
  let query = sb
    .from("acc_financial_analysis")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false });
  if (!includeArchived) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) throw new FinancialAnalysisError(error.message);
  return (data ?? []) as unknown as FinancialAnalysisRow[];
}

export async function archiveFinancialAnalysis(
  sb: SupabaseClient,
  id: string,
  reason: string | null,
): Promise<void> {
  const { error } = await sb.rpc("acc_archive_financial_analysis", {
    p_id: id,
    p_reason: reason,
  });
  if (error) throw new FinancialAnalysisError(error.message);
}
```

- [ ] **Step 2: Actions**

```ts
// app/(app)/reports/analysis/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { getUserRole } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { AccountRow } from "@/lib/db/types";
import {
  buildWhatIfAnalysis,
  freezeAnalysisSchema,
  type AdjustableAccount,
  type FreezeAnalysisInput,
} from "@/lib/domain/financial-analysis";
import type { LedgerBalance } from "@/lib/domain/reports";
import { canWrite } from "@/lib/domain/roles";
import {
  archiveFinancialAnalysis,
  FinancialAnalysisError,
  freezeFinancialAnalysis,
} from "@/lib/services/financial-analysis";
import { getLedgerBalances } from "@/lib/services/reports";

export interface AnalysisActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function msg(error: unknown): string {
  if (error instanceof FinancialAnalysisError || error instanceof Error) return error.message;
  return "An unexpected error occurred";
}

async function loadAccounts(sb: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data, error } = await sb
    .from("acc_account")
    .select("id,account_code,name,account_type")
    .eq("is_active", true)
    .order("account_code");
  if (error) throw new FinancialAnalysisError(error.message);
  return (data ?? []).map(
    (a): AdjustableAccount => ({
      accountId: a.id,
      accountCode: a.account_code,
      name: a.name,
      accountType: a.account_type as AccountRow["account_type"],
    }),
  );
}

export async function getAnalysisDataAction(
  from: string,
  to: string,
): Promise<AnalysisActionResult<{ pnlRows: LedgerBalance[]; bsRows: LedgerBalance[]; accounts: AdjustableAccount[] }>> {
  try {
    const sb = await createSupabaseServerClient();
    const [pnlRows, bsRows, accounts] = await Promise.all([
      getLedgerBalances(sb, from, to),
      getLedgerBalances(sb, null, to),
      loadAccounts(sb),
    ]);
    return { ok: true, data: { pnlRows, bsRows, accounts } };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function freezeAnalysisAction(
  input: FreezeAnalysisInput,
): Promise<AnalysisActionResult<{ id: string }>> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to freeze an analysis" };
  const parsed = freezeAnalysisSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That analysis cannot be frozen" };
  }
  try {
    const sb = await createSupabaseServerClient();
    // The snapshot is recomputed here, from the ledger this session is allowed
    // to read — never accepted from the client (CLAUDE.md: never trust
    // client-sent totals).
    const [pnlRows, bsRows, accounts] = await Promise.all([
      getLedgerBalances(sb, parsed.data.periodStart, parsed.data.periodEnd),
      getLedgerBalances(sb, null, parsed.data.periodEnd),
      loadAccounts(sb),
    ]);
    const snapshot = buildWhatIfAnalysis(pnlRows, bsRows, parsed.data.adjustments, accounts);
    const id = await freezeFinancialAnalysis(sb, parsed.data, snapshot);
    revalidatePath("/reports/analysis");
    return { ok: true, data: { id } };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function archiveAnalysisAction(
  id: string,
  reason: string | null,
): Promise<AnalysisActionResult> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to archive an analysis" };
  try {
    const sb = await createSupabaseServerClient();
    await archiveFinancialAnalysis(sb, id, reason);
    revalidatePath("/reports/analysis");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}
```

- [ ] **Step 3: Typecheck** — `npm run typecheck` → clean. (Check the actual signature of `getLedgerBalances` in `lib/services/reports.ts` first; `getStatementOfEquityAction` calls it as `getLedgerBalances(sb, null, date)`, so `from: string | null` is expected — confirm before assuming.)

- [ ] **Step 4: Commit**

```bash
git add ctyhp-accounting/lib/services/financial-analysis.ts "ctyhp-accounting/app/(app)/reports/analysis/actions.ts"
git commit -m "feat(analysis): freeze recomputes the snapshot server-side"
```

---

### Task 7: The workspace screen

**Files:**
- Create: `app/(app)/reports/analysis/page.tsx`
- Create: `app/(app)/reports/analysis/AnalysisClient.tsx`
- Create: `app/(app)/reports/analysis/AnalysisReportTables.tsx`

**Interfaces:**
- Consumes: everything Task 6 produced; `buildWhatIfAnalysis`, `validateAdjustment`, `AnalysisAdjustment`, `AdjustableAccount` from the domain; `PageHeader`, `ReportEntityBadge`, `FilterBar`, `DataTable` components; `fromMinor` from `@/lib/domain/money`.
- Produces: route `/reports/analysis`.

- [ ] **Step 1: Thin server page** (mirror `reports/saved/page.tsx`):

```tsx
// app/(app)/reports/analysis/page.tsx
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { getUserRole } from "@/lib/auth";
import { resolveActiveCompany } from "@/lib/db/company";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite } from "@/lib/domain/roles";
import { listFinancialAnalyses } from "@/lib/services/financial-analysis";
import AnalysisClient from "./AnalysisClient";

export const dynamic = "force-dynamic";

export default async function FinancialAnalysisPage() {
  const sb = await createSupabaseServerClient();
  const [entity, role, frozen] = await Promise.all([
    resolveActiveCompany(),
    getUserRole(),
    listFinancialAnalyses(sb, true),
  ]);
  return (
    <div>
      <PageHeader
        meta={
          <ReportEntityBadge
            companyName={entity.active?.dbaName || entity.active?.legalName || "No company selected"}
            isSample={entity.active?.isSample ?? false}
          />
        }
        title="What-If Analysis"
        description="Lay hypothetical adjustments over real numbers and see where they land. Nothing here posts to the books — freeze a scenario to keep it."
      />
      <AnalysisClient canFreeze={canWrite(role)} frozenReports={frozen} />
    </div>
  );
}
```

- [ ] **Step 2: Presentational tables.** `AnalysisReportTables.tsx` is a `"use client"` component receiving `{ analysis: WhatIfAnalysis, decimals: number }` and rendering two cards ("Profit & Loss", "Balance Sheet"). For each `ReportSection` in the actual, render rows keyed by `accountId ?? name` with four columns: Account | Actual | Adjustment | Adjusted, where Adjustment = adjusted amount − actual amount for the same key (0 when the account is only on one side; a row that exists only in adjusted still renders, with Actual 0). Section totals and `netIncome` / `totalAssets` / `totalLiabilities` / `totalEquity` rows in bold. Under the Balance Sheet card show two status lines: `Actual balanced ✓/✗` and `Adjusted balanced ✓/✗` (they must both always be ✓; showing them is the trust device). At the top of the component a permanent banner: `<Alert type="warning" showIcon message="What-if analysis — not the books" description="These figures include hypothetical adjustments and never post to the ledger." />`. Amounts render with `fromMinor(v, decimals).toLocaleString("en-US", { minimumFractionDigits: decimals })` and negative adjustments in parentheses per the app's report style — check how `ReportsClient.tsx` formats comparative amounts and copy that helper.

- [ ] **Step 3: Workspace client.** `AnalysisClient.tsx` state and flow:
  - `range: [Dayjs, Dayjs]` (default: start of year → today), `Run` button calls `getAnalysisDataAction`, stores `{ pnlRows, bsRows, accounts }`.
  - `adjustments: AnalysisAdjustment[]` in `useState`. "Add adjustment" opens a Modal: label input + a Form.List of lines, each line = account `Select` (options from `accounts`, label `${account_code} — ${name}`), side `Select` (Debit/Credit), amount `InputNumber` (converted with `toMinor(amount, decimals)`, sign from side). On OK run `validateAdjustment` and show its message via `message.error` instead of saving. Each saved adjustment renders as a `Card` row with label, a line summary, Edit and Remove buttons. Show a live "Adjustments balance ✓" tag.
  - `const analysis = useMemo(() => data && buildWhatIfAnalysis(data.pnlRows, data.bsRows, adjustments, data.accounts), [data, adjustments])` → `<AnalysisReportTables analysis={analysis} />`. (Client-side compose is display-only; the frozen snapshot is still recomputed server-side.)
  - Freeze button (visible when `canFreeze` and `adjustments.length > 0`): Modal with title + notes → `freezeAnalysisAction({ title, notes, periodStart: range[0].format("YYYY-MM-DD"), periodEnd: range[1].format("YYYY-MM-DD"), adjustments })` → success message → `router.refresh()`.
  - Frozen list section (`DataTable<FinancialAnalysisRow>`): Title, Period, Created, Status tag, Actions = View (opens a Drawer rendering the **stored** snapshot via the same `AnalysisReportTables`, plus the stored adjustments list and notes), "Load assumptions" (copies the stored adjustments into the workspace state), Archive (staff only, confirm modal with reason input). Parse `row.snapshot`/`row.adjustments` defensively — `unknown` in, validate shape, show an error card on mismatch rather than crashing.
  - Decimals: base currency decimals must come from the server page (add a `baseDecimals` prop; fetch in page.tsx the same way `ReportsClient`'s page does — check `app/(app)/reports/page.tsx` for the exact source and copy it).

- [ ] **Step 4: Build and smoke the one route**

```
npm run build
npm start
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000 --only=reports/analysis
```
Expected: 1 of 1 pages rendered. (The smoke script auto-discovers static routes — no list to update.)

- [ ] **Step 5: Live verification with Playwright** (pattern: the session-cookie scripts used throughout this repo): open `/reports/analysis`, Run with the current year, add the two-line revenue adjustment from the tests against two real accounts, assert the Adjusted net income moved by exactly the delta and both "balanced ✓" lines show, freeze it, assert it appears in the frozen list, open the viewer, assert the stored numbers match what was on screen. Screenshot for the record.

- [ ] **Step 6: Commit**

```bash
git add "ctyhp-accounting/app/(app)/reports/analysis/"
git commit -m "feat(analysis): the workspace — actual, adjustments, adjusted, frozen"
```

---

### Task 8: Catalog card, changelog, full gates, ship

**Files:**
- Modify: `lib/domain/report-catalog.ts`
- Modify: `lib/domain/changelog.ts`

- [ ] **Step 1: Catalog card** (after the `saved-reports` entry, same group):

```ts
{
  id: "what-if-analysis",
  title: "What-If Analysis",
  description:
    "Lay hypothetical adjustments over real numbers and freeze the result as a report. Analysis never posts to the books.",
  href: "/reports/analysis",
  group: "accounting",
},
```

Run `npx vitest run tests/unit/report-catalog.test.ts tests/unit/navigation.test.ts` (if either exists) — a catalog entry may be asserted against routes; fix whichever side the test says is wrong. Also run `npx vitest run tests/unit/screen-context.test.ts` if present — if it requires a `GUIDE_FLOWS` entry for every route, add a minimal guide flow for `/reports/analysis` describing the screen in one paragraph.

- [ ] **Step 2: Changelog Release** (next version number at ship time) — headline: "Try an adjustment without touching the books, and freeze what you saw."; one `added` change describing the workspace + frozen reports, route `/reports/analysis`.

- [ ] **Step 3: Full gates, in this order, output untrimmed**

```
npm test                 # expect: all pass (1,944 + the ~15 new = ~1,959)
npm run typecheck
npm run lint             # expect: 0 errors (11 baseline warnings)
npm run build
npm start
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000   # expect 58 of 58
npm run verify:financial-analysis
node scripts/verify-stylesheet-colours.mjs HEAD   # light theme unchanged
```

- [ ] **Step 4: Commit + push, wait for CI**

```bash
git add ctyhp-accounting/lib/domain/report-catalog.ts ctyhp-accounting/lib/domain/changelog.ts
git commit -m "feat(analysis): catalog card and release notes"
git push origin main
# poll GitHub Actions until the head SHA reports completed/success
```

---

## Self-Review (run after writing, before executing)

1. **Spec coverage:** boss's asks — overlay analysis on real data ✔ (Tasks 2, 7); "does not save to the data" ✔ (Task 4 no-write policies, Task 5 proof); "save as frozen/capture report" ✔ (Tasks 4–7); margins flow "bottom and sheets" ✔ (Task 2 BS test).
2. **Type consistency:** `AnalysisAdjustment.key/label/lines`, `deltaMinor`, `FreezeAnalysisInput.periodStart/periodEnd`, RPC params `p_*` — names match across Tasks 1–7.
3. **Known checks to run during execution, not assumptions:** exact `getLedgerBalances` signature (Task 6 Step 3), decimals source for the client (Task 7 Step 3), existence of screen-context/catalog tests (Task 8 Step 1).
