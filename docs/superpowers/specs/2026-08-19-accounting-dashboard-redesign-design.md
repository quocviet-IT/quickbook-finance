# OneBook Accounting Dashboard Redesign

- Date: 2026-08-19
- Status: Design direction and implementation guide
- Initial scope: `/accounting` for accountants
- Related scope: `/dashboard` and the shared dashboard foundation

## 1. Document purpose

This document is the single implementation reference for Product, Design,
Backend, Frontend, and QA teams improving the OneBook dashboards in controlled
phases. It defines the target experience, technical boundaries, implementation
sequence, acceptance criteria, and post-release effectiveness measures.

This is not a request to rebuild the dashboard from scratch. The implementation
must reuse the current data, routing, design tokens, components, and accounting
rules. Teams should split or change only the areas required to achieve the
defined user outcomes.

## 2. Design decision

The redesigned accounting dashboard will be an **Accounting Operations
Cockpit**, not a collection of summary reports.

Within ten seconds of opening the dashboard, an accountant must be able to
answer:

1. Is the current accounting period safe to continue processing or close?
2. Which item requires attention first?
3. What financial amount or accounting control is affected?
4. Who owns the work, and when is it due?
5. Which workflow should the accountant open to resolve it?
6. Did the underlying condition actually improve after the action?

The selected direction is **action-first and control-first**:

- Required work and accounting controls appear before charts.
- Every insight must lead to evidence and a specific action.
- Historical charts are secondary analysis tools.
- Initial insights use deterministic, auditable rules rather than AI-generated
  accounting conclusions.
- `/accounting` receives an accountant-specific composition instead of being
  constrained by the generic work-area dashboard layout.

## 3. Scope and boundaries

### 3.1 In scope

- Redesign the information architecture of `/accounting`.
- Upgrade the attention queue into a prioritised work queue with a lifecycle.
- Surface accounting control health and period-close progress.
- Add evidence-backed insights with impact and recommended actions.
- Design complete loading, empty, partial-error, unavailable, and stale-data
  states.
- Split oversized dashboard modules by responsibility.
- Reduce client-side work, isolate section failures, and make runtime quality a
  regression gate.
- Measure operational effectiveness rather than dashboard page views.
- After `/accounting` meets its success criteria, reuse proven primitives across
  Sales, Purchases, Banking, and Inventory.

### 3.2 Out of scope

- Replacing Next.js, React, Ant Design, Supabase, or the existing application
  stack.
- Changing current posting, reconciliation, approval, or period-control rules.
- Changing the product-wide language as part of this project.
- Building a chatbot or allowing generative AI to determine accounting status.
- Redesigning every work-area dashboard at the same time.
- Adding charts only to make the page appear more complete.
- Assigning legal or operational responsibility to a user when no configured
  ownership rule exists.

## 4. Verified current state

### 4.1 Management dashboard at `/dashboard`

Primary files:

- `app/(app)/dashboard/page.tsx`
- `app/(app)/dashboard/DashboardClient.tsx`
- `lib/services/dashboard.ts`
- `components/dashboard/WorkQueueCard.tsx`
- `components/charts/FinancialCharts.tsx`

The page already provides a strong data foundation:

- Executive overview: cash position, revenue, net income, gross margin, working
  capital, and inventory value.
- Performance trends over 3, 6, or 12 months.
- A work queue containing overdue invoices, bills due, unreconciled
  transactions, and pending approvals.
- A cash-flow bridge, operating pulse, AR/AP ageing, and inventory exposure.
- Financial diagnostics and an accounting activity timeline.

The limitation is that most sections have nearly equal visual priority. Users
must review several blocks before identifying the work that requires action.
`DashboardClient.tsx` is currently approximately 672 lines, while
`lib/services/dashboard.ts` is approximately 564 lines.
`getDashboardAnalytics()` waits for many data sources within one `Promise.all`,
so one failed source can make the entire dashboard unavailable. The 12-month
performance view also causes repeated ledger reads.

### 4.2 Work-area dashboard at `/accounting`

Primary files:

- `components/work-areas/WorkAreaOverview.tsx`
- `components/work-areas/WorkAreaOverview.module.css`
- `lib/domain/work-area-overview.ts`
- `lib/services/work-area-overviews.ts`

`WorkAreaOverview` currently serves Sales, Purchases, Banking, Inventory, and
Accounting with this shared sequence:

> Metrics → Trend → Attention queue → Breakdowns → Workflow → Recent activity →
> Control → Links

The Accounting service already supplies useful data:

- Ledger performance.
- Journal source mix.
- Period-close progress.
- Trial balance.
- Periods past their close date.
- Pending approvals.
- Recurring transaction exceptions.

The shared model provides consistency but forces Accounting into a generic
composition. `WorkAreaOverview.tsx` is approximately 567 lines, and
`lib/services/work-area-overviews.ts` is approximately 1,588 lines with all five
work-area services in the same module.

### 4.3 Current queue model

`lib/domain/work-queue.ts` provides a useful starting point:

- Work-item kind.
- `critical | high | normal` priority.
- Event date, amount, destination, and timing label.
- Priority rules for overdue invoices, bills due, unmatched bank transactions,
  and pending approvals.

The queue does not yet contain an owner, business due date, acknowledged or
in-progress state, SLA, priority explanation, resolution outcome, or change
history. It is therefore an alert list rather than a work orchestration tool.

### 4.4 Technical baseline

Snapshot from `.quality-results/summary.json` when this document was prepared:

| Metric | Gzip baseline |
|---|---:|
| `/accounting` | 653,365 bytes |
| `/dashboard` | 658,843 bytes |
| Shared bundle | 890,581 bytes |
| Total bundle | 1,968,808 bytes |

These figures are regression baselines, not acceptable final targets. The
shared bundle is the largest contributor to route cost. Splitting dashboard
components will improve maintainability and rendering boundaries, but it may
not reduce total transferred bytes without shared-bundle work.

## 5. Problems to solve

### 5.1 The information order does not match accounting work

Trends and metrics appear before the queue and accounting controls. The current
dashboard answers “what happened?” better than “what should I do next?”

### 5.2 KPIs have no target or materiality context

An increase or decrease is not inherently good or bad. Cash may decrease because
bills were paid on time; revenue may increase while collections deteriorate.
Status colours must be based on a control, target, SLA, or configured materiality
threshold rather than only on the sign of a percentage change.

### 5.3 Insights lack interpretation and accountability

Current figures do not consistently expose:

- The driver or largest contributing group.
- Financial impact.
- Exception age.
- Owner and due date.
- Recommended action.
- Status before and after an action.

### 5.4 The shared dashboard composition is too generic

Sales, Purchases, Banking, Inventory, and Accounting share the same visual
sequence. Shared primitives should remain, but each work area needs its own
composition. Accounting requires controls and close workflow; Sales requires
collection workflow; Banking requires matching and reconciliation. Their
information hierarchy must not be identical solely because they share a
component.

### 5.5 Resilience and performance are insufficient

- The analytics bundle loads as one operation.
- Sections do not fail independently.
- Multi-month trends cause repeated ledger reads.
- Dashboard and work-area component/service modules are large and difficult to
  review or test independently.
- Runtime quality is not yet a stable blocking regression gate.

### 5.6 Operational improvement is not measured

There is no complete measurement loop from seeing an insight, opening its source,
performing an action, and confirming that the control returned to a healthy
state. OneBook therefore cannot prove that the dashboard reduces close time or
backlog age.

## 6. Target information architecture

### 6.1 Two working modes

The dashboard will provide two modes on the same URL:

1. **Daily operations** — the default mode, focused on reconciliation,
   approvals, documents, and daily exceptions.
2. **Period close** — focused on the close checklist, blockers, ownership, and
   control readiness.

Users may switch modes manually. The system may recommend Period close when the
close deadline is approaching or a period is overdue, but it must not switch
automatically and remove the user's current context. Persist the most recently
selected mode per user.

### 6.2 Desktop layout

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Accounting operations      [Daily | Period close]  As of / Currency│
│ Current period · close due date · freshness · overall status        │
├───────────────────────────────────────────┬─────────────────────────┤
│ Priority work queue (8 columns)           │ Control health (4 cols) │
│ P0/P1/P2 · impact · age · owner · due     │ TB · Bank · AR/AP · GL  │
│ filter · sort · next action               │ Close deadline/blocker  │
├───────────────────────────────────────────┼─────────────────────────┤
│ What changed and why                      │ Close progress           │
│ Insight · evidence · top contributors     │ Checklist · owner · SLA  │
├───────────────────────────────────────────┴─────────────────────────┤
│ Secondary analysis: trends / journal mix / activity (collapsed)     │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.3 Required content order

1. Context and period status.
2. Priority work queue.
3. Control health.
4. Insights and drivers.
5. Period-close progress.
6. Secondary trends, breakdowns, and activity.

At a 1,280×800 viewport, users must see period status, at least three priority
items, and the most important controls without scrolling.

### 6.4 Current-to-target mapping

| Current element | Treatment | Target location |
|---|---|---|
| Accounting metrics | Reduce to 4–5 control KPIs | Status strip and control rail |
| Trend chart | Keep with lower prominence | Secondary analysis |
| Attention queue | Upgrade to a priority work queue | Main content area |
| Journal source mix | Keep | Secondary analysis |
| Period-close progress | Upgrade to a checklist | Right rail / Close mode |
| Trial-balance control | Keep and increase priority | Control health |
| Recent activity | Keep and collapse by default | End of page |
| Work-area links | Convert to contextual shortcuts | Related queue/control items |
| Main dashboard work queue | Share primitives, not composition | Compact form on `/dashboard` |
| Inventory exposure on main dashboard | Reduce for accountants | Inventory dashboard |

## 7. Component specifications

### 7.1 Context header

The header must show:

- Page title and active mode.
- `asOf`, accounting basis, currency, and time zone.
- Current accounting period and target close date.
- Most recent data refresh time.
- A stale-data warning when the source-specific freshness threshold is exceeded.

Do not use multiple large cards for metadata. Use one compact status strip with
a clear visual hierarchy.

### 7.2 Priority work queue

Each item must contain at least:

- `severity`: `critical | high | medium | low`.
- `sourceKind` and `sourceId` for traceability.
- A concise title and explanation.
- `amountMinor` when a financial amount is affected.
- `ageDays`.
- A visible reason for its priority.
- An owner or an `Unassigned` label.
- A due date or SLA-derived due date.
- Work lifecycle status.
- One primary action leading to the correct business workflow.
- The time at which the source data was confirmed.

Recommended lifecycle:

```text
new → acknowledged → in_progress → resolved
  └──────────────────────────────→ dismissed_with_reason
```

An item becomes `resolved` only when the source condition is no longer an
exception. A user may mark an item as in progress but cannot claim that it is
resolved while the accounting control remains unhealthy.
`dismissed_with_reason` must store a reason and audit actor.

Default queue ordering:

1. Control failures that can block period close.
2. Severity.
3. SLA breach.
4. Configured materiality.
5. Age, descending.
6. Amount, descending.

Do not hard-code one materiality threshold for every company. If a company has
not configured materiality, prioritise by controls, SLA, and age; display the
amount as supporting information only.

### 7.3 Control health

Minimum accounting controls:

- Trial balance.
- Bank reconciliation.
- AR subledger to GL.
- AP subledger to GL.
- Inventory subledger to GL when inventory is enabled.
- Pending controlled actions.
- Accounting-period status.

Each control must have:

- `healthy | attention | blocked | unavailable` status.
- Difference amount when applicable.
- Last evaluation time.
- Source evidence.
- Review destination.
- A concise description of the pass/fail condition.

Colour must never be the only status signal. Every status requires an icon,
label, and explanation.

### 7.4 “What changed and why”

Initial insights must be deterministic and traceable. Each insight follows this
contract:

```ts
interface AccountingInsight {
  id: string;
  ruleKey: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  summary: string;
  amountMinor?: number;
  changePercent?: number;
  ageDays?: number;
  evidence: Array<{
    label: string;
    value: string | number;
    href?: string;
  }>;
  recommendedAction: {
    label: string;
    href: string;
  };
  generatedAsOf: string;
  dataState: "fresh" | "stale" | "partial";
}
```

The first rule set should include only conditions that current data can prove:

- Trial balance is out of balance.
- A period remains open after its close date.
- A controlled action is waiting beyond its SLA.
- A bank transaction remains unreconciled beyond the configured age.
- Overdue AR or AP increased against the comparison period.
- A recurring run failed.
- A subledger does not reconcile to the GL.

An insight must not claim causation when the data proves only contribution or
correlation. Acceptable: “Three customers represent 72% of the overdue balance.”
Unacceptable without further evidence: “Three customers caused the cash-flow
problem.”

### 7.5 Period-close checklist

Standard checklist:

1. Record all required documents.
2. Reconcile bank accounts.
3. Validate AR and AP.
4. Validate inventory and fixed assets when applicable.
5. Post adjusting journals.
6. Review the trial balance.
7. Complete approvals.
8. Close the period.

Each step requires status, owner, due date, blocker, completion evidence, and a
workflow link. Completion must derive from existing business state whenever
possible; a manual checkbox must not replace an actual accounting control.

### 7.6 Secondary analysis

Keep existing charts when they support investigation:

- Ledger performance.
- Journal source mix.
- Period-close progress over time.
- Activity timeline.

Display only one primary trend by default. Allow users to expand into a
breakdown or data table. Charts must retain an equivalent table representation
for keyboard and screen-reader users, following the existing
`WorkAreaOverview` pattern.

## 8. Interface standards

### 8.1 Layout

- Maximum desktop container width: 1,440px.
- Twelve-column grid; work queue uses eight columns and control rail uses four.
- Spacing scale: 4/8/12/16/24/32px.
- Do not force every panel to equal height.
- Use cards only when a semantic grouping requires a boundary; avoid nested
  cards.
- Collapse to an eight-column layout on tablet and one column on mobile.
- Mobile order: status → critical queue → controls → close → insights →
  secondary analysis.

### 8.2 Typography and numbers

- Continue using the typography system established in the P1 UI foundation; do
  not add a dashboard-only font.
- Use sentence case for headings.
- Use tabular figures for amounts, percentages, and counts.
- Right-align amounts in lists and tables.
- Always expose currency context; never combine currencies into one total.
- A negative amount does not automatically represent an error. Reserve error
  colour for a failed control or business exception.

### 8.3 Colour and status

- Use existing tokens from `lib/design/tokens` and the Ant Design theme.
- Use neutral colour for normal data.
- Use warning for attention that does not block a workflow.
- Use danger only for control failure, severe overdue exposure, or a blocker.
- Use success only when a control has passed or a workflow has completed.
- Every state includes a label and icon; colour cannot be the only signal.
- Display no more than two primary chart series at once; render supporting series
  in neutral tones.

### 8.4 Interaction

- Each panel has no more than one primary action.
- Selecting a KPI opens the correctly filtered list.
- Persist shareable or restorable filters in the URL.
- Provide visible focus and a logical tab order.
- Do not use a modal for long drill-down content; use a route or URL-backed side
  panel.
- Avoid animated numbers. Limit 150–250ms transitions to open/close, hover, and
  loading-complete states.

## 9. Loading, empty, error, and data-quality states

### 9.1 Loading

- Render the header and status shell first.
- Give every section a skeleton matching its final content shape.
- Do not make the queue wait for the 12-month trend.
- Do not cover the entire page with one spinner.

### 9.2 Empty state

Distinguish between:

- **Healthy empty:** no exceptions exist; show the evaluation time and the
  controls that passed.
- **No data:** a required source is not available; explain what configuration or
  data is missing and provide the relevant destination.

Never display “0 issues” when a query failed or returned incomplete data.

### 9.3 Partial error

- Give every section an independent error boundary and retry action.
- If the trend fails, the queue and controls must remain usable.
- If a control cannot be calculated, display `unavailable`, never `healthy`.
- Logs may contain a safe company identifier, section key, request ID, and error
  class. They must not contain sensitive financial details.

### 9.4 Stale data

Every aggregate exposes `generatedAt` or `asOf`. Mark data as stale after the
source-specific refresh threshold. Stale data may remain visible but cannot be
used to confirm that a control has passed.

## 10. Target technical architecture

### 10.1 Principles

- Keep Next.js 16, React 19, Ant Design 6, Supabase, TypeScript, and Vitest.
- The server fetches and normalises data; client components manage only mode,
  filters, and user interaction.
- Keep domain rules outside JSX.
- Split queries by section so they can be cached, tested, and failed
  independently.
- Share primitives; compose them according to each work area's business needs.
- Do not add a charting or state-management dependency when current primitives
  can meet the requirement.

### 10.2 Target file structure

This structure is the recommended implementation boundary. File names may be
adjusted slightly to follow established conventions, but responsibilities must
not be merged back into one oversized module.

```text
app/(app)/accounting/
  page.tsx
  loading.tsx
  error.tsx

components/accounting-dashboard/
  AccountingDashboard.tsx
  AccountingContextHeader.tsx
  AccountingStatusStrip.tsx
  PriorityWorkQueue.tsx
  ControlHealthPanel.tsx
  AccountingInsightList.tsx
  PeriodCloseChecklist.tsx
  SecondaryAnalysis.tsx
  accounting-dashboard.module.css

components/dashboard/
  WorkQueueItem.tsx              # Shared presentation primitive; no business rule
  DataState.tsx                  # Shared loading/empty/error/stale primitive

lib/domain/accounting-dashboard/
  types.ts
  priority.ts
  insight-rules.ts
  close-status.ts

lib/services/accounting-dashboard/
  index.ts
  context.ts
  work-queue.ts
  controls.ts
  insights.ts
  close-progress.ts
  secondary-analysis.ts

tests/unit/accounting-dashboard/
  priority.test.ts
  insight-rules.test.ts
  close-status.test.ts
  data-state.test.ts

tests/integration/accounting-dashboard/
  accounting-dashboard-data.test.ts
  accounting-dashboard-isolation.test.ts
```

### 10.3 Relationship to current code

- Move `getAccountingOverview()` out of
  `lib/services/work-area-overviews.ts` section by section. Do not maintain a
  long-lived duplicate implementation.
- Accounting-specific domain types must not continue expanding
  `lib/domain/work-area-overview.ts`.
- `WorkAreaOverview` remains in place for work areas that have not migrated.
- Separate reusable presentation primitives from the business rules currently
  represented by `WorkQueueCard` and `lib/domain/work-queue.ts`.
- Do not remove `/dashboard` behaviour in the same pull request that introduces
  the new `/accounting` composition.
- Apply the proven section-isolation pattern to `getDashboardAnalytics()` only
  after `/accounting` is stable.

### 10.4 Data flow

```text
Supabase / ledger RPC / existing services
                  │
                  ▼
Section query adapters keyed by company + asOf + permission scope
                  │
                  ▼
Pure domain rules: priority, control status, insight, close progress
                  │
                  ▼
Server-rendered section model with generatedAt + dataState
                  │
                  ▼
Small client components for mode, filters, acknowledgement, and navigation
                  │
                  ▼
Audit + product events + source revalidation after business action
```

### 10.5 Caching and invalidation

- Start with request-level memoisation to remove duplicate queries.
- Add shared caching only when the cache key includes company, `asOf`, accounting
  basis, and permission scope.
- Posting, approval, reconciliation, period close/reopen, and import operations
  must invalidate their affected sections.
- Never cache a `healthy` control result beyond its freshness window.
- Client cache must not become the source of truth for accounting status.

### 10.6 Trend optimisation

Monthly performance must not request the ledger separately for every month. The
target is one RPC or aggregate query that returns all required monthly buckets
in one call. Its result must reconcile to the current ledger and have unit and
integration coverage for missing months, year boundaries, and an incomplete
current month.

## 11. Implementation roadmap

Each phase requires a separate pull request, an independent testable outcome,
and a safe rollout mechanism. Do not begin a subsequent phase until the current
phase meets its mandatory acceptance criteria.

### Phase 0 — Baseline and design validation

**Goal:** Establish evidence before changing behaviour and validate the real
accounting workflow.

**Work:**

1. Capture `/accounting` and `/dashboard` baselines at 1,440×900, 1,280×800,
   768×1024, and 390×844.
2. Record query count, server response time, LCP, interaction latency, route gzip,
   and section failures against stable seed data.
3. Observe at least three tasks: resolving an unmatched bank transaction,
   approving a journal, and reviewing an overdue open period.
4. Confirm existing definitions for SLA, close deadline, materiality, and owner.
   When a configuration does not exist, record the gap and do not invent a value.
5. Approve desktop/mobile wireframes and the English interface copy used by the
   current product.

**Output:** A quantitative baseline, approved wireframes, and a data-gap list
that maps each value to a source. Supporting artefacts may live in tickets or
pull requests; this document remains the design source of truth.

**Acceptance criteria:**

- Quantitative loading, bundle, and task-completion baselines exist.
- Every KPI and control in the wireframe has an identified data source.
- No metric remains if it does not support a user decision.

### Phase 1 — Quick win: reorder existing information

**Goal:** Make the dashboard operationally useful without requiring a new
workflow schema.

**Work:**

1. Introduce an accountant-specific composition for `/accounting`.
2. Move period/trial-balance controls and the attention queue to the top.
3. Reduce primary metrics to no more than five actionable values.
4. Move trends, journal source mix, and activity into secondary analysis.
5. Add the context header, freshness labels, and correct empty/error states.
6. Split data fetching by section so a failed trend cannot remove the queue or
   controls.
7. Preserve existing drill-down destinations and permission checks.

**Not included in this phase:** owner assignment, persisted task lifecycle,
generative AI, inferred materiality, or a manual close checklist.

**Acceptance criteria:**

- At 1,280×800, users see period status, three priority items, and critical
  controls without scrolling.
- Every queue item opens its correct workflow in no more than one click.
- A secondary service failure does not blank the page.
- Keyboard navigation moves through mode, queue, controls, and secondary analysis
  in reading order.
- `/accounting` route gzip does not exceed the current quality budget: 10% or
  20KB gzip, whichever threshold the quality script applies as the stricter
  limit.

### Phase 2 — Work queue lifecycle

**Goal:** Turn the alert list into a work orchestration tool.

**Work:**

1. Extend the domain model with severity, reason, owner, due date, SLA, and
   lifecycle.
2. Persist user-created state such as acknowledgement, in-progress state, and
   dismissal reason without copying accounting source amounts.
3. Audit changes to owner, state, due date, and dismissal.
4. Add `My work`, `Unassigned`, `Overdue`, `Critical`, `Reconciliation`,
   `Approval`, and `Period close` filters.
5. Revalidate an item after its business action; resolve it automatically only
   when the source exception disappears.
6. Add deep links that preserve filter and return context.

**Acceptance criteria:**

- Concurrent updates do not silently overwrite another user's state.
- Every lifecycle change records actor and timestamp.
- An item disappears or becomes resolved after the underlying business issue is
  fixed and revalidated.
- Dismissal requires a reason. Close-blocking controls cannot be dismissed when
  policy prohibits it.
- Permission tests prove that unauthorised users cannot assign or alter work.

### Phase 3 — Insights and materiality

**Goal:** Explain what changed, why it matters, and where the impact is
concentrated.

**Work:**

1. Build a pure rule engine with versioned `ruleKey` values and test fixtures.
2. Add audited company-level materiality and SLA configuration. Clearly expose
   the unconfigured state.
3. Add top-contributor breakdowns for overdue AR/AP and ledger movements.
4. Give every insight evidence, freshness, and a filtered drill-down link.
5. Add acknowledgement measurement to determine whether insights lead to
   action.
6. Keep generative AI out of control status and accounting decisions.

**Acceptance criteria:**

- Identical input produces identical insight and priority output.
- Every rule has positive, negative, boundary, and missing-data tests.
- No insight claims a cause beyond its evidence.
- Every insight exposes a source timestamp and valid action.
- Materiality changes are audited and update results after invalidation.

### Phase 4 — Period-close mode

**Goal:** Use the dashboard to coordinate period close and identify blockers.

**Work:**

1. Implement the close checklist using actual control state.
2. Calculate progress from steps applicable to the company; non-applicable steps
   must not count as failures.
3. Display blockers, owners, due dates, and completion evidence.
4. Recommend Close mode when the deadline approaches or a period is overdue.
5. Add progress history and days-to-close measurement.
6. Do not allow the UI to mark a step complete in place of actual posting,
   reconciliation, or approval.

**Acceptance criteria:**

- Overall progress reconciles to the status of each included step.
- Trial-balance or reconciliation blockers affect close readiness.
- Close/reopen actions update the dashboard and audit trail with correct
  permissions.
- In usability testing, an accountant can identify the largest blocker and its
  owner within ten seconds.

### Phase 5 — Performance, resilience, and quality gates

**Goal:** Make the dashboard fast, priority-loaded, and protected from silent
regressions.

**Work:**

1. Replace per-month ledger reads with one aggregate query or RPC.
2. Memoise repeated queries within the request; add shared caching only under
   the rules in Section 10.5.
3. Lazy-load secondary analysis that is unnecessary for the first view.
4. Reduce client-component boundaries. Perform stable formatting and transforms
   on the server or in pure domain functions.
5. Measure dashboard-owned chunks separately from the shared bundle.
6. Run runtime quality checks in a stable CI environment and block regressions
   beyond the approved budget.
7. Add synthetic checks for partial failures, stale data, and permission denial.

**Acceptance criteria:**

- Monthly performance uses no more than one aggregate call for the selected
  window.
- Queue and controls render without waiting for secondary trends.
- A section timeout does not remove healthy sections.
- Dashboard-owned client JavaScript is at least 25% smaller than the Phase 0
  baseline.
- Total route gzip does not increase. Create a separate shared-bundle roadmap if
  the shared bundle remains dominant.
- In the standard measurement environment, P75 reaches LCP ≤ 2.5 seconds,
  interaction ≤ 200ms, and response ≤ 1,000ms. If environmental dependencies
  prevent the absolute target in this release, each metric must improve by at
  least 20% against Phase 0.
- The runtime gate runs repeatably and blocks an intentionally introduced test
  regression.

### Phase 6 — Measure outcomes and expand to other dashboards

**Goal:** Reuse only patterns that have demonstrated operational value.

**Work:**

1. Compare before-and-after results for the accountant pilot group.
2. Retain proven primitives: status strip, work item, control state, data state,
   and insight evidence.
3. Do not copy the Accounting composition into other work areas.
4. Design each area around its own primary job:
   - Banking: unmatched activity and reconciliation.
   - Sales: collection and overdue AR.
   - Purchases: payments due, receiving, and AP exceptions.
   - Inventory: availability, negative stock, and subledger tie-out.
5. After each work area migrates, reduce or remove the generic composition in
   `WorkAreaOverview`.

**Acceptance criteria:**

- A pattern expands only after `/accounting` improves its behavioural metrics.
- Every work area has its own primary job and success measures.
- Shared primitives contain no query or business rule specific to one area.
- The redesign does not recreate a service module over 1,000 lines.

## 12. Testing strategy

### 12.1 Unit tests

Required coverage:

- Priority ordering and tie-breakers.
- Severity boundaries.
- SLA overdue calculation across time-zone and date boundaries.
- Configured and unconfigured materiality.
- Positive, negative, boundary, and missing-data insight cases.
- `healthy`, `attention`, `blocked`, and `unavailable` controls.
- Close progress with applicable and non-applicable steps.
- Currency decimals and signed-amount semantics.

### 12.2 Integration tests

Required proof:

- Data remains within the correct company and permission scope.
- Queue items link to the correct source record.
- Posting, reconciliation, and approval actions trigger revalidation.
- A partial query failure does not remove other sections.
- Monthly aggregates reconcile to ledger ground truth.
- Concurrent lifecycle updates have explicit conflict behaviour.

### 12.3 UI and accessibility tests

Validate at 1,440px, 1,280px, 768px, and 390px:

- No horizontal overflow.
- Above-the-fold hierarchy matches Section 6.3.
- Logical keyboard order and visible focus.
- Screen-reader names for amounts, statuses, and actions.
- Colour is not the only state signal.
- Every chart has an equivalent data table.
- Skeletons do not cause material layout shifts.
- Healthy-empty, no-data, stale, unavailable, and partial-error states are
  distinct.

### 12.4 Regression gates

Every dashboard pull request must run:

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run quality:bundle
```

`npm run quality:runtime` becomes mandatory after Phase 5 provides a stable
measurement environment. Before then, teams must still record and compare the
runtime result, but noisy infrastructure must not create an unreliable release
gate.

## 13. Product-effectiveness measurement

The dashboard succeeds only when it improves accounting work. Page views and
time on page are not primary success metrics.

### 13.1 Behavioural metrics

- Time to first actionable click.
- Queue-item-to-correct-workflow rate.
- Insight-to-evidence/drill-down rate.
- Task acknowledgement, start, and resolution rates.
- Return-to-dashboard rate after an action to confirm control health.

### 13.2 Accounting operations metrics

- Exceptions resolved per day.
- Median and P90 age of unmatched bank transactions.
- Median and P90 age of pending approvals.
- Percentage of work completed within SLA.
- Days to close.
- Reconciliations completed on time.
- Reduction in overdue AR value after action.
- Control failures carried into the next period.

### 13.3 Minimum event set

Events must not contain document descriptions or sensitive financial data. Use
only safe identifiers, work type, severity, location, and timing properties:

```text
accounting_dashboard_viewed
accounting_mode_changed
accounting_queue_filtered
accounting_task_opened
accounting_task_acknowledged
accounting_task_resolved
accounting_insight_opened
accounting_control_reviewed
accounting_close_step_opened
```

## 14. Rollout and rollback

1. Enable the redesign behind a company or internal-user feature flag.
2. Run old and new dashboards in parallel during evaluation without writing the
   same business state twice.
3. Pilot with accountants representing both daily operations and month-end
   close.
4. Collect measurements through at least one working cycle that includes a
   period close.
5. Expand by cohort only when permission, accounting data, bundle, and runtime
   show no regression.
6. Remove the old dashboard only after deep links, audit, metrics, and the
   support playbook are ready.

Rollback must disable the new composition without rolling back business-data
migrations. If Phase 2 introduces task-lifecycle persistence, its migration must
remain backward-compatible with the old dashboard.

## 15. Risks and controls

| Risk | Control |
|---|---|
| Green/red colour gives the wrong business meaning | Derive status from controls, targets, and SLA rather than amount direction |
| The queue becomes too large | Group by source, use deterministic priority, filter, and limit the first view |
| A user marks work complete while the source is still wrong | Source revalidation determines resolution |
| Cached data crosses company or permission boundaries | Use complete company/asOf/basis/permission keys and isolation tests |
| One query breaks the whole page | Use section boundaries, partial states, and independent retry |
| Service modules continue to grow | Split by domain and section; give each file one responsibility |
| Insights become unsupported narrative | Require versioned rules and evidence; keep AI out of the initial decision path |
| The interface looks better but work does not improve | Compare task time, SLA, backlog age, and days to close |
| Bundle size does not fall after component splitting | Measure dashboard-owned and shared chunks separately |
| Scope expands to the whole application | Require Accounting acceptance before migrating another area |

## 16. Programme Definition of Done

- `/accounting` operates as the Accounting Operations Cockpit defined in
  Section 2.
- Users see control health and priority work before secondary analysis.
- Every insight contains evidence, freshness, and an action.
- Every task has a traceable lifecycle, and resolution matches source state.
- Period-close mode reflects real controls and identifies blockers.
- Loading, healthy-empty, no-data, stale, unavailable, and error states are not
  conflated.
- Automated tests cover permissions and multi-company isolation.
- Type checking, unit/integration tests, lint, build, bundle, and runtime gates
  pass in the standard environment.
- Route bundle size does not increase, and dashboard-owned JavaScript reaches
  the reduction target.
- Time to action, backlog age, SLA attainment, or close time improves against
  the baseline established in Phase 0.
- Operations and support documentation explains priority, control state, stale
  data, and dismissal reasons.

## 17. Recommended pull-request sequence

1. `refactor(accounting-dashboard): introduce accountant-specific composition`
2. `feat(accounting-dashboard): surface priority work and control health`
3. `feat(accounting-dashboard): add task lifecycle and audit`
4. `feat(accounting-dashboard): add deterministic accounting insights`
5. `feat(accounting-dashboard): add period close mode`
6. `perf(accounting-dashboard): isolate sections and aggregate trends`
7. `quality(accounting-dashboard): enforce runtime regression gate`
8. `feat(work-area-dashboard): migrate proven primitives by business area`

Each pull request must remain small enough for reviewers to validate accounting
correctness, permissions, user experience, and performance independently. Do not
combine schema changes, a full-page layout redesign, the insight engine, and
performance refactoring in one pull request.
