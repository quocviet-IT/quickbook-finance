# Accounting Operations Cockpit — Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/accounting` as an accountant-specific composition — period status, priority work queue, and control health above the fold; trends demoted to secondary analysis; every section failing independently — per the design record `docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md`, Phases 0 and 1 only.

**Architecture:** Accounting data moves out of the five-area `lib/services/work-area-overviews.ts` into section-scoped services under `lib/services/accounting-dashboard/`, each returning `{ data, generatedAt, dataState }` and fetched with `Promise.allSettled` so a failed trend cannot blank the queue. Pure ordering and status rules live in `lib/domain/accounting-dashboard/`. The page composes new `components/accounting-dashboard/` sections; `WorkAreaOverview` remains untouched for the other four areas.

**Tech Stack:** Next.js 16, React 19, antd 6, Supabase, Vitest, Playwright verification scripts, existing quality:bundle gate.

## Global Constraints

- Spec §3.2: no new chart/state libraries, no AI-derived status, no posting-rule changes, `/dashboard` untouched in this phase's PRs.
- Spec Phase 1 exclusions: **no** owner assignment, task lifecycle persistence, materiality config, or close checklist — those are Phases 2–4.
- Spec §7.3: a control that cannot be calculated shows `unavailable`, never `healthy`. Never render "0 issues" from a failed query.
- Spec §8.3: colour is never the only signal — every status carries icon + label.
- Money in minor units end-to-end; tabular figures; right-aligned amounts.
- All UI copy US English; changelog Release entry on ship; four gates + smoke + `npm run quality:bundle` before commit; no Claude attribution; push `quocviet-IT` only.
- `/accounting` route gzip must stay within the quality budget (10% or 20KB gzip, whichever the quality script applies as stricter) against the Phase 0 baseline.

## Decisions taken (flag to the user if changing)

1. **Mode toggle (Daily | Period close) is deferred to Phase 4.** Phase 1 ships the Daily composition; the header shows the period and close state without a mode switch. (Spec Phase 1 work list omits modes; the close checklist that gives Close mode its content is Phase 4.)
2. **Close due date and SLA are unconfigured today** — no table holds them. Per spec Phase 0.4 and §7.2 we do not invent values: the header shows the period's `period_end` labelled as such, and queue ordering uses controls → severity → age → amount, skipping the SLA and materiality tiers until Phase 3 adds their configuration.
3. **Control health v1 covers what current data proves:** trial balance, AR→GL, AP→GL, Inventory→GL (via `acc_control_reconciliation`), bank reconciliation recency, accounting-period status, pending approvals. Each with status/difference/evaluated-at/destination.
4. **The priority queue reuses** `getDashboardAnalytics`'s work-queue inputs (overdue invoices, bills due, unmatched bank, pending approvals) **plus** the accounting exceptions (TB out of balance, overdue periods, failed recurring runs) — merged and ordered by one pure function.

---

### Task 0: Phase 0 baseline and data-gap record

**Files:**
- Create: `docs/research/2026-08-20-accounting-cockpit-phase0-baseline.md`
- Screenshots (not committed; kept in the scratchpad and summarised in the doc)

- [ ] **Step 1: Bundle + route baseline.** Run `npm run quality:bundle`; copy `/accounting`, `/dashboard`, shared, and total gzip figures from `.quality-results/summary.json` into the baseline doc, beside the spec §4.4 figures.
- [ ] **Step 2: Visual + latency baseline.** Against the built server, Playwright-capture `/accounting` at 1440×900, 1280×800, 768×1024, 390×844; record server response time per viewport load and the section order visible above the fold at 1280×800.
- [ ] **Step 3: Data-gap list.** Record in the doc, each with its source or "NOT CONFIGURED — do not invent":
  - close due date → `acc_accounting_period.period_end` only (no separate target date) — GAP for a distinct close deadline
  - SLA per work kind → none — GAP (Phase 3)
  - materiality → none — GAP (Phase 3)
  - owner → none — GAP (Phase 2)
  - control tie-outs → `acc_control_reconciliation` (exists, 0073)
  - bank reconciliation state → `acc_reconciliation` sessions (0025–0027)
- [ ] **Step 4: Commit** the baseline doc: `docs(accounting-dashboard): phase 0 baseline and data gaps`.

*(Spec Phase 0 items 3 and 5 — observing accountants and approving wireframes — are the user's; the spec §6.2 layout is treated as the approved wireframe by the user's approval of this plan.)*

---

### Task 1: Domain — types and deterministic priority ordering

**Files:**
- Create: `lib/domain/accounting-dashboard/types.ts`
- Create: `lib/domain/accounting-dashboard/priority.ts`
- Test: `tests/unit/accounting-dashboard/priority.test.ts`

**Interfaces (produced):**

```ts
// types.ts
export type SectionDataState = "fresh" | "stale" | "unavailable";

export interface SectionEnvelope<T> {
  data: T | null;                // null when unavailable
  generatedAt: string;           // ISO timestamp
  dataState: SectionDataState;
  /** Safe, user-facing reason when unavailable. */
  unavailableReason?: string;
}

export type ControlKey =
  | "trial-balance" | "bank-reconciliation" | "ar-to-gl" | "ap-to-gl"
  | "inventory-to-gl" | "period-status" | "pending-approvals";

export type ControlStatus = "healthy" | "attention" | "blocked" | "unavailable";

export interface AccountingControl {
  key: ControlKey;
  title: string;
  status: ControlStatus;
  /** What passing means, in one sentence. */
  passCondition: string;
  detail: string;
  differenceMinor?: number;
  evaluatedAt: string;
  href: string;
  /** True when this control failing should block period close. */
  blocksClose: boolean;
}

export type QueueSeverity = "critical" | "high" | "medium" | "low";

export interface PriorityQueueItem {
  key: string;
  sourceKind:
    | "control-failure" | "overdue-invoice" | "bill-due" | "unmatched-bank"
    | "pending-approval" | "overdue-period" | "recurring-failure";
  sourceId: string | null;
  title: string;
  reason: string;               // visible "why this priority"
  severity: QueueSeverity;
  amountMinor?: number;
  ageDays: number;
  href: string;                 // the one primary action
  actionLabel: string;
  confirmedAt: string;          // when the source data was read
  blocksClose: boolean;
}
```

```ts
// priority.ts — the spec §7.2 default order, minus the SLA and materiality
// tiers that have no configuration yet (recorded as gaps in Task 0):
//   1. close-blocking control failures  2. severity  3. age desc  4. amount desc
export function orderQueue(items: PriorityQueueItem[]): PriorityQueueItem[]
export const SEVERITY_RANK: Record<QueueSeverity, number>; // critical:0 … low:3
```

- [ ] **Step 1: Failing tests** — concrete fixtures:

```ts
import { describe, expect, it } from "vitest";
import { orderQueue } from "@/lib/domain/accounting-dashboard/priority";

const base = {
  sourceId: null, title: "", reason: "", href: "/x", actionLabel: "Open",
  confirmedAt: "2026-08-20T00:00:00Z", blocksClose: false,
};

describe("orderQueue", () => {
  it("puts a close-blocking control failure first, whatever its age", () => {
    const out = orderQueue([
      { ...base, key: "old", sourceKind: "overdue-invoice", severity: "critical", ageDays: 90, amountMinor: 1 },
      { ...base, key: "tb", sourceKind: "control-failure", severity: "high", ageDays: 0, blocksClose: true },
    ]);
    expect(out.map((i) => i.key)).toEqual(["tb", "old"]);
  });

  it("orders by severity, then age descending, then amount descending", () => {
    const out = orderQueue([
      { ...base, key: "a", sourceKind: "bill-due", severity: "high", ageDays: 3, amountMinor: 100 },
      { ...base, key: "b", sourceKind: "bill-due", severity: "critical", ageDays: 1, amountMinor: 5 },
      { ...base, key: "c", sourceKind: "bill-due", severity: "high", ageDays: 9, amountMinor: 1 },
      { ...base, key: "d", sourceKind: "bill-due", severity: "high", ageDays: 9, amountMinor: 700 },
    ]);
    expect(out.map((i) => i.key)).toEqual(["b", "d", "c", "a"]);
  });

  it("is stable for identical rank — the same input twice gives the same output", () => {
    const items = [
      { ...base, key: "x", sourceKind: "bill-due" as const, severity: "high" as const, ageDays: 2 },
      { ...base, key: "y", sourceKind: "bill-due" as const, severity: "high" as const, ageDays: 2 },
    ];
    expect(orderQueue(items).map((i) => i.key)).toEqual(orderQueue(items).map((i) => i.key));
  });

  it("never mutates its input", () => {
    const items = [
      { ...base, key: "x", sourceKind: "bill-due" as const, severity: "low" as const, ageDays: 1 },
      { ...base, key: "y", sourceKind: "bill-due" as const, severity: "critical" as const, ageDays: 1 },
    ];
    orderQueue(items);
    expect(items[0].key).toBe("x");
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/unit/accounting-dashboard/priority.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `types.ts` exactly as above and `priority.ts`:

```ts
import type { PriorityQueueItem, QueueSeverity } from "./types";

export const SEVERITY_RANK: Record<QueueSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

/** Spec §7.2 default order. SLA and materiality tiers join in Phase 3,
 *  when a company can actually configure them. */
export function orderQueue(items: PriorityQueueItem[]): PriorityQueueItem[] {
  return [...items].sort(
    (a, b) =>
      Number(b.blocksClose && b.sourceKind === "control-failure") -
        Number(a.blocksClose && a.sourceKind === "control-failure") ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.ageDays - a.ageDays ||
      (b.amountMinor ?? 0) - (a.amountMinor ?? 0),
  );
}
```

- [ ] **Step 4:** tests PASS. **Step 5: Commit** `feat(accounting-dashboard): deterministic queue ordering`.

---

### Task 2: Domain — control status rules

**Files:**
- Create: `lib/domain/accounting-dashboard/control-status.ts`
- Test: `tests/unit/accounting-dashboard/control-status.test.ts`

**Interfaces:** pure builders the service will call — each takes plain inputs and returns an `AccountingControl`; no Supabase types anywhere in this file:

```ts
export function trialBalanceControl(input: { balanced: boolean; differenceMinor: number; evaluatedAt: string }): AccountingControl
export function subledgerControl(key: "ar-to-gl" | "ap-to-gl" | "inventory-to-gl", input: { differenceMinor: number | null; evaluatedAt: string }): AccountingControl  // null difference → unavailable
export function periodStatusControl(input: { openCount: number; overdueCount: number; evaluatedAt: string }): AccountingControl
export function approvalsControl(input: { pendingCount: number; oldestAgeDays: number | null; evaluatedAt: string }): AccountingControl
export function bankReconciliationControl(input: { lastCompletedOn: string | null; unmatchedCount: number; evaluatedAt: string }): AccountingControl
export function unavailableControl(key: ControlKey, reason: string, evaluatedAt: string): AccountingControl
```

- [ ] **Step 1: Failing tests** — the load-bearing cases with exact expectations:
  - trial balance balanced → `healthy`, `blocksClose: true` always, difference 0
  - trial balance off by 5_00 → `blocked` (a TB failure blocks close, spec §7.2 rule 1) with `differenceMinor: 500`
  - subledger difference 0 → `healthy`; difference 12_34 → `attention`; difference `null` → `unavailable` and detail says it could not be evaluated (never healthy — spec §9.3)
  - periods: overdueCount 0 → `healthy`; overdueCount 2 → `attention`
  - approvals: pending 0 → `healthy`; pending 3 → `attention`
  - bank: `lastCompletedOn: null` with unmatched 4 → `attention`, detail names both facts
  - `unavailableControl` → status `unavailable`, `unavailableReason` carried into detail
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (each builder ~10 lines, statuses per the table above, every `detail` a full sentence naming the figure). **Step 4:** PASS. **Step 5: Commit** `feat(accounting-dashboard): control status is a rule, not a colour`.

---

### Task 3: Section services — accounting data leaves the five-area module

**Files:**
- Create: `lib/services/accounting-dashboard/context.ts` — period list for the fiscal year, current period, overdue-open count, `asOf`/currency (reuses `getWorkAreaOverviewContext`'s sources)
- Create: `lib/services/accounting-dashboard/controls.ts` — calls `acc_control_reconciliation` (AR/AP/Inventory rows), `buildTrialBalance(getLedgerBalances(sb, null, asOf))`, period + approvals counts, latest `acc_reconciliation` session; maps through Task 2 builders
- Create: `lib/services/accounting-dashboard/work-queue.ts` — merges `getDashboardAnalytics` queue inputs + accounting exceptions into `PriorityQueueItem[]`, ordered by `orderQueue`
- Create: `lib/services/accounting-dashboard/secondary-analysis.ts` — trend, journal source mix, recent activity (moved verbatim from `getAccountingOverview`)
- Create: `lib/services/accounting-dashboard/index.ts` — `getAccountingDashboard(sb)`: runs the four sections with `Promise.allSettled`, wraps each in `SectionEnvelope`, a rejected section becomes `dataState: "unavailable"` with a safe reason — **the page never throws because one section did**
- Modify: `lib/services/work-area-overviews.ts` — delete `getAccountingOverview` (spec §10.3: no long-lived duplicate)
- Modify: `app/(app)/accounting/page.tsx` — call the new index (Task 4 renders it)

Checks during implementation (facts, not assumptions): exact `acc_control_reconciliation` result columns; `acc_reconciliation` table/session shape; whether `getDashboardAnalytics` exposes its queue inputs separately or only composed (if only composed, take the four source reads it uses — `lib/services/dashboard.ts` — without touching `/dashboard`).

- [ ] **Step 1:** write the four section modules + index. Every section returns `SectionEnvelope<T>` stamped `generatedAt: new Date().toISOString()`.
- [ ] **Step 2:** delete `getAccountingOverview` from `work-area-overviews.ts`; `npm run typecheck` names every caller left behind — fix each (expected: only `app/(app)/accounting/page.tsx`).
- [ ] **Step 3: Integration-style unit test** `tests/unit/accounting-dashboard/section-isolation.test.ts`: `getAccountingDashboard` with a stubbed section that throws → that envelope is `unavailable` with the safe reason, the other three are `fresh`. (Pass sections as an injectable map so the test needs no Supabase.)
- [ ] **Step 4:** gates: tests + typecheck. **Step 5: Commit** `refactor(accounting-dashboard): section services that fail alone`.

---

### Task 4: The cockpit UI

**Files:**
- Create: `components/accounting-dashboard/AccountingDashboard.tsx` (composition), `AccountingStatusStrip.tsx`, `PriorityWorkQueue.tsx`, `ControlHealthPanel.tsx`, `SecondaryAnalysis.tsx`, `DataStateNote.tsx`, `accounting-dashboard.module.css`
- Modify: `app/(app)/accounting/page.tsx`, add `app/(app)/accounting/loading.tsx`

**Layout (spec §6.2/§8.1):** 12-col grid, max 1440px; queue 8 cols, control rail 4; one-column at mobile with order status → queue → controls → secondary. Content order (§6.3): status strip → queue → controls → secondary (collapsed `Collapse` for trend/journal mix/activity).

Key contracts:
- `AccountingStatusStrip`: one compact strip (not cards): current period label + status tag, period end date, `asOf` + basis + currency, per-section freshness dot; stale/unavailable sections named with icon + label.
- `PriorityWorkQueue`: `ReportTable`-free — a `DataTable` of `PriorityQueueItem` showing severity tag (icon+label), title, reason (secondary text), right-aligned amount, age, one primary action `Button size="small"` linking `href`. Empty state distinguishes **healthy-empty** ("Every control passed as of {time}") from **unavailable** (retry hint) via the envelope — never "0 issues" on a failed query (§9.2).
- `ControlHealthPanel`: one row per control — icon+label status, pass condition, difference (right-aligned, tabular), evaluated time, link. `blocked` rows carry the danger token, `attention` warning, `unavailable` neutral with an explicit "could not be evaluated".
- `DataStateNote`: the shared stale/unavailable/renderer used by every section (spec's `DataState` primitive, named to avoid clashing with existing types).
- At 1280×800: status strip + ≥3 queue rows + the control rail visible without scrolling — verified in Task 5.

- [ ] **Step 1:** build components; page fetches `getAccountingDashboard` and hands envelopes down; `loading.tsx` renders the strip + two skeleton columns (no full-page spinner — §9.1).
- [ ] **Step 2:** typecheck + lint + build; fix the RSC/antd trap by keeping `page.tsx` a thin server wrapper.
- [ ] **Step 3: Commit** `feat(accounting-dashboard): the cockpit composition`.

---

### Task 5: Live verification, budget, accessibility

- [ ] **Step 1:** build + `npm start`; Playwright at 1280×800 asserts: (a) the first `.accounting-status-strip` bounding box + ≥3 `.priority-queue` rows + `.control-health` panel all have `bottom ≤ 800`; (b) every queue row's action navigates to its `href` (check first three); (c) tab order hits mode-less strip → queue → controls → secondary. Screenshots at the four spec viewports for the record.
- [ ] **Step 2: Failure isolation live:** temporarily point the secondary-analysis section at a throwing stub (env flag or test-only injection), rebuild, confirm the queue and controls still render and the section shows its unavailable card; remove the stub.
- [ ] **Step 3:** `npm run quality:bundle` — `/accounting` gzip within budget vs Task 0 baseline; record both figures.
- [ ] **Step 4:** full gates: `npm test`, typecheck, lint, build, smoke (58 pages), `verify-stylesheet-colours`.
- [ ] **Step 5:** changelog Release (next number at ship time): headline "The accounting dashboard puts your work first."; commit `feat(accounting-dashboard): ship phase 1` and push; wait for CI.

---

## Self-Review

1. **Spec coverage (Phase 1 list):** accountant composition ✔ (T4); controls+queue on top ✔ (T4); ≤5 KPIs ✔ (status strip carries period/TB/approvals/freshness only); trends demoted ✔ (SecondaryAnalysis collapsed); context header + freshness + empty/error states ✔ (T4 + envelopes); section-split fetching ✔ (T3); drill-downs preserved ✔ (hrefs carried through queue/controls).
2. **Phase 1 exclusions honoured:** no owner, no lifecycle writes, no materiality, no checklist, no mode persistence.
3. **Type consistency:** `SectionEnvelope`, `AccountingControl`, `PriorityQueueItem`, `orderQueue` names match across Tasks 1–4.
4. **Facts to check during execution, not assumed:** `acc_control_reconciliation` columns, `acc_reconciliation` session shape, dashboard queue input exposure (T3), quality-budget thresholds the script enforces (T5).
