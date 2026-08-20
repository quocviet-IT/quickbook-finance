# Accounting Cockpit — Phase 0 baseline and data gaps

- Date: 2026-08-20
- Design record: `docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md`
- Plan: `docs/superpowers/plans/2026-08-20-accounting-cockpit-phase1.md`
- Measured at commit `285478d`, against the built server and live Aurora books

This is the evidence Phase 1 is judged against. It exists so "better" can be
argued from numbers rather than impressions.

## 1. Bundle baseline

`npm run quality:bundle`, gzip bytes, from `.quality-results/summary.json`:

| Route / bundle | This measurement | Spec §4.4 (2026-08-19) | Drift |
|---|---:|---:|---:|
| `/accounting` | 660,303 | 653,365 | +6,938 |
| `/dashboard` | 665,919 | 658,843 | +7,076 |
| Shared bundle | 903,156 | 890,581 | +12,575 |
| Total | 1,979,245 | 1,968,808 | +10,437 |

The drift is a day of unrelated shipping (releases 1.44–1.48), not measurement
noise. **660,303 is the figure Phase 1 is held to.**

Budget (`scripts/quality/config.mjs`): the stricter of 10% or 20KB gzip. For
`/accounting` that is 20,480 bytes, so the Phase 1 ceiling is **680,783 gzip
bytes**. Findings at baseline: 0.

## 2. Load and layout baseline

Signed in as an administrator on the Aurora books, `/accounting` on the built
server:

| Viewport | Load (networkidle) | Horizontal overflow |
|---|---:|---|
| 1440×900 | 8,680 ms (cold start) | none |
| 1280×800 | 4,618 ms | none |
| 768×1024 | 3,783 ms | none |
| 390×844 | 3,297 ms | none |

The first figure includes the server's cold compile; 3.3–4.6 s is the warm
picture, and it is dominated by `getAccountingOverview` waiting on a single
`Promise.all` that includes `getDashboardAnalytics` and a 12-month journal
read.

### What a reader actually sees above the fold

**1280×800 — the viewport the spec's acceptance criterion names:**

> One Book · Accounting overview · *(description)* · Key metrics · **Ledger
> performance** · *(chart description)* · Attention queue · 2 active

The chart heading arrives **before** the queue, the queue is a narrow right
rail showing two items, and no accounting control appears at all — the trial
balance sits far below. This is spec §5.1 in one screenshot.

**390×844:** only "Key metrics" is above the fold. A mobile reader sees no
work and no control without scrolling.

The four metric cards at the top are `Posting accounts 32`, `Journal volume
this month $3,516.42`, `Open periods 12 (7 past their close date)`, `Pending
approvals 0`. Two of the four cannot be acted on; the one that matters — seven
periods past their close date — carries the same visual weight as the count of
active accounts.

Screenshots: `before-accounting-{1440x900,1280x800,768x1024,390x844}.png`,
captured to the working scratchpad. They are not committed — one of the books
measured is a real customer's.

## 3. Data-gap record (spec Phase 0, item 4)

Every value the target design asks for, and where it comes from. **A gap is
recorded, not invented** — the design document requires exactly this.

| Value the design wants | Source today | Status |
|---|---|---|
| Trial balance tie-out | `buildTrialBalance(getLedgerBalances(sb, null, asOf))` | **Available** |
| AR / AP / Inventory → GL | `acc_control_reconciliation(p_as_of)` → `control_key` in `ar`, `ap`, `inventory`, `grni`, `sales_tax`, `undeposited`, via `getControlReconciliation` (0073) | **Available** |
| Bank reconciliation state | `acc_statement_reconciliation` (0025): `status`, `statement_ending_date`, `completed_at` | **Available** |
| Unmatched bank activity | `acc_bank_transaction` where `status = 'unmatched'` | **Available** |
| Pending controlled actions | `acc_approval_request` where `status = 'pending'` | **Available** |
| Accounting-period status | `acc_accounting_period` per fiscal year: `status`, `period_end` | **Available** |
| Recurring failures / due | `listRecurringRuns`, `listRecurringTemplates` | **Available** |
| Overdue invoices / bills due | `getDashboardWorkQueue(sb, asOf)` — already a standalone service | **Available** |
| **Close due date** (distinct from period end) | Nothing. `acc_accounting_period.period_end` is the end of the period, not a target date to close it by | **GAP** — Phase 4 |
| **SLA per work kind** | Nothing | **GAP** — Phase 3 |
| **Materiality threshold** | Nothing | **GAP** — Phase 3 |
| **Owner of a work item** | Nothing. `acc_app_user` holds roles, not assignment | **GAP** — Phase 2 |
| **Work lifecycle** (acknowledged / in progress / dismissed) | Nothing | **GAP** — Phase 2 |

Consequences for Phase 1, taken deliberately:

1. Queue ordering runs **close-blocking control → severity → age → amount**.
   The SLA and materiality tiers the spec places between severity and age are
   absent until they can be configured; `orderQueue` is written so they slot in
   without moving the tiers around them.
2. The header shows the period and its end date labelled as the period end —
   never as a close deadline the system does not hold.
3. Every queue item is derived from source state on each read. Nothing is
   persisted, so nothing can go stale against the ledger, and no migration is
   needed before Phase 2.

## 4. Acceptance criteria for Phase 1, restated as measurements

| Criterion (spec Phase 1) | How it will be proved |
|---|---|
| At 1280×800: period status, three priority items, and critical controls without scrolling | Playwright reads bounding boxes; each must have `bottom ≤ 800` |
| Every queue item opens its workflow in one click | Each row's action `href` resolves to the named screen |
| A secondary service failure does not blank the page | A deliberately throwing section; queue and controls still render |
| Keyboard order: status → queue → controls → secondary | Tab-order capture in reading order |
| Route gzip within budget | `npm run quality:bundle` ≤ 680,783 for `/accounting` |
