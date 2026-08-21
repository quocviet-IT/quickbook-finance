# Accounting Cockpit Phase 2 — Work Queue Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/accounting`'s priority queue from a list of alerts into work people own — assigned, acknowledged, worked, or dismissed with a reason — without ever copying an accounting figure out of the ledger.

**Architecture:** Queue items stay **derived** from source state on every read, exactly as Phase 1 built them. Phase 2 adds one table of *user-created state* keyed by the item's own deterministic key, joined on at compose time. Nothing about a document, a balance or a control is duplicated: if the exception goes away the item goes away, and its state row is retired rather than left to haunt a future occurrence of the same key.

**Tech Stack:** Next.js 16, React 19, antd 6, Supabase (Postgres RLS + RPC), Zod, Vitest.

## What Phase 1 already gives us

`PriorityQueueItem.key` is deterministic and stable for as long as the exception exists:

| Source | Key |
|---|---|
| Control failure | `control:trial-balance`, `control:ar-to-gl`, … |
| Overdue invoice / bill due / unmatched bank / approval | `overdue_invoice:<uuid>`, `due_bill:<uuid>`, … (the dashboard queue's own id) |
| Period left open | `period:<uuid>` |
| Recurring run failed | `recurring:<uuid>` |

That key is the join. No new identifier is invented.

## Global Constraints

- Spec §3.2 and Phase 2 exclusions: no materiality or SLA *configuration* (that is Phase 3 — Phase 2 carries the `dueDate` field and nothing that computes one from a policy nobody has set).
- **Never copy an accounting amount into the state table.** The item still reads its money from the ledger on every load; a stored copy would be a second source of truth that silently goes stale.
- Assigning or changing work requires staff (`acc_is_staff()` in the RPC, `canWrite()` in the action). A viewer may read the queue and change nothing.
- Dismissal requires a reason. A control that blocks the close cannot be dismissed at all.
- Concurrency: an update must fail rather than overwrite a change it did not see.
- Every migration reaches every company (`scripts/migrate.mjs`), then `npm run verify:company-provisioning`.
- Ship gate: `npm test`, typecheck, lint, build, `smoke-pages.mjs`, `quality:bundle` within the Phase 0 ceiling (680,783 gzip for `/accounting`), changelog Release entry.
- Commits: no Claude attribution; push only to `quocviet-IT`.

## Decisions taken (flag to the user if changing)

1. **State is retired, not deleted, when its item disappears.** The load path marks any active state row whose key is absent from the derived queue as `resolved`. Without this, dismissing a trial-balance failure would silently hide the *next* one, because the key is the same both times.
2. **Dismissal hides the item until the exception clears.** A dismissed item drops out of the default view and returns only if it recurs after being retired. It stays visible under the `Dismissed` filter so nothing is hidden without a way to look.
3. **No auto-assignment.** The spec forbids assigning responsibility where no ownership rule exists (§3.2). Items start `Unassigned` and a person picks them up.
4. **Due date is entered, never inferred.** Phase 3 adds SLA policy; until then a due date is something a person set, and the column says so.
5. **Optimistic concurrency on `updated_at`.** The client sends the `updatedAt` it rendered; the RPC refuses if the row has moved since.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0118_work_item_state.sql` (create) | `acc_work_item_state` table, RLS, `acc_set_work_item_state` and `acc_retire_work_items` RPCs |
| `lib/domain/accounting-dashboard/lifecycle.ts` (create) | Pure: lifecycle states, legal transitions, what a filter means, what may be dismissed |
| `tests/unit/accounting-dashboard/lifecycle.test.ts` (create) | TDD home for the above |
| `lib/domain/accounting-dashboard/types.ts` (modify) | `WorkItemState`, and the lifecycle fields on `PriorityQueueItem` |
| `lib/services/accounting-dashboard/work-item-state.ts` (create) | Read state, write state, retire absent keys |
| `lib/services/accounting-dashboard/compose.ts` (modify) | Join state onto the derived queue; retire what has gone |
| `app/(app)/accounting/actions.ts` (create) | Guarded server actions: acknowledge, start, assign, set due date, dismiss |
| `components/accounting-dashboard/PriorityWorkQueue.tsx` (modify) | Owner and status on the row, the七 filters, the action menu |
| `components/accounting-dashboard/WorkItemActions.tsx` (create) | The per-row menu and its dialogs |
| `lib/domain/changelog.ts` (modify) | Release entry |

---

### Task 1: Lifecycle rules, pure

**Files:**
- Create: `lib/domain/accounting-dashboard/lifecycle.ts`
- Test: `tests/unit/accounting-dashboard/lifecycle.test.ts`

**Interfaces produced:**

```ts
export type WorkLifecycle = "new" | "acknowledged" | "in_progress" | "dismissed" | "resolved";

export interface WorkItemState {
  key: string;
  lifecycle: WorkLifecycle;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;      // ISO date, entered by a person
  dismissReason: string | null;
  updatedAt: string;           // the concurrency token
  updatedBy: string | null;
}

/** Null when the move is legal; the reason it is not, otherwise. */
export function transitionProblem(
  from: WorkLifecycle,
  to: WorkLifecycle,
  item: { blocksClose: boolean },
  reason: string | null,
): string | null;

export type QueueFilter =
  | "all" | "mine" | "unassigned" | "overdue" | "critical"
  | "reconciliation" | "approvals" | "period_close" | "dismissed";

export function matchesFilter(
  item: PriorityQueueItem,
  filter: QueueFilter,
  viewerId: string | null,
  today: string,
): boolean;
```

- [ ] **Step 1: Write the failing tests.** Cover, with concrete inputs:
  - `new → acknowledged`, `acknowledged → in_progress`, `in_progress → dismissed` all legal
  - `dismissed` with an empty reason → "Say why…"
  - dismissing an item with `blocksClose: true` → refused, naming the control
  - `resolved` cannot be set by a person at all (only the source clearing does that) → refused
  - `matchesFilter`: `mine` matches only the viewer's ownerId; `unassigned` only a null owner; `overdue` only a dueDate strictly before today (due today is not late — the same rule `isOverdueDocument` already settles); `critical` by severity; `reconciliation` / `approvals` / `period_close` by sourceKind; `dismissed` shows only dismissed and every other filter hides them
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit `feat(accounting-dashboard): what a work item may become, and who sees it`.

---

### Task 2: Migration 0118 — the state table

**Files:**
- Create: `supabase/migrations/0118_work_item_state.sql`
- Modify: `lib/db/types.ts` (`WorkItemStateRow`)

Table:

```sql
create table if not exists acc_work_item_state (
  work_key       text primary key check (length(btrim(work_key)) > 0),
  lifecycle      text not null default 'new'
                 check (lifecycle in ('new','acknowledged','in_progress','dismissed','resolved')),
  owner_id       uuid references auth.users (id),
  due_date       date,
  dismiss_reason text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users (id),
  resolved_at    timestamptz,
  check (lifecycle <> 'dismissed' or length(btrim(coalesce(dismiss_reason, ''))) > 0)
);
```

No amount, no document id, no control figure — the check that this table holds *only* user-created state is that a reader can see there is nothing accounting-shaped in it.

RPCs:
- `acc_set_work_item_state(p_key, p_lifecycle, p_owner_id, p_due_date, p_reason, p_expected_updated_at)` — staff only; refuses when the row has moved since `p_expected_updated_at`; writes `acc_audit_log`.
- `acc_retire_work_items(p_live_keys text[])` — marks `resolved` every active row whose key is not in the live set. Staff only; returns the count.

- [ ] **Step 1:** write it. **Step 2:** `node scripts/migrate.mjs`, then `npm run verify:company-provisioning`. **Step 3:** typecheck. **Step 4:** commit.

---

### Task 3: Service — read, write, retire

**Files:**
- Create: `lib/services/accounting-dashboard/work-item-state.ts`
- Modify: `lib/services/accounting-dashboard/compose.ts`, `index.ts`

- `listWorkItemState(sb)` → `Map<string, WorkItemState>` with owner names resolved through `acc_actor_directory` (the same reason the import register resolves them: a uuid tells a reader nothing).
- `setWorkItemState(sb, input)` → the new state, or throws with the RPC's message.
- `retireWorkItems(sb, liveKeys)` → count.
- `composeAccountingDashboard` joins state onto each derived item and calls `retireWorkItems` with the keys it just produced — the "revalidate" the spec asks for, done at the one moment the live set is known.

- [ ] **Step 1:** implement. **Step 2:** extend `tests/unit/accounting-dashboard/section-isolation.test.ts` — a failing state read must not take the queue down (it costs the lifecycle columns, not the work). **Step 3:** gates. **Step 4:** commit.

---

### Task 4: Actions and UI

**Files:**
- Create: `app/(app)/accounting/actions.ts`, `components/accounting-dashboard/WorkItemActions.tsx`
- Modify: `PriorityWorkQueue.tsx`

- Actions: `acknowledgeWorkItemAction`, `startWorkItemAction`, `assignWorkItemAction`, `setWorkItemDueDateAction`, `dismissWorkItemAction` — each guarded by `canWrite`, each passing the `updatedAt` the client rendered.
- Row gains: a status tag (`new` renders as nothing — it is the absence of a decision), the owner's name or `Unassigned`, the due date when set.
- The nine filters from Task 1, in the Segmented control. `Mine` needs the viewer's id — passed from the page.
- One `⋯` menu per row: Acknowledge · Start · Assign to… · Set due date… · Dismiss…, each item hidden when the transition is illegal.
- Bundle: the menu is the one new antd surface. If `quality:bundle` moves outside the ceiling, the row menu renders through the `Dropdown` already on the page rather than anything new.

- [ ] **Step 1:** build. **Step 2:** typecheck, lint, build. **Step 3:** live-verify at 1280×800: assign an item, reload, the owner persists; dismiss without a reason is refused; a blocks-close item offers no Dismiss. **Step 4:** `quality:bundle`. **Step 5:** commit.

---

### Task 5: Prove the guards, then ship

**Files:**
- Create: `scripts/verify-work-item-state.mjs`
- Modify: `package.json`, `lib/domain/changelog.ts`

Inside one rolled-back transaction, as real users:
1. A staff user sets a state; the row and the audit entry both appear.
2. A **viewer** is refused by the RPC — the acceptance criterion the spec names.
3. A second write carrying a stale `p_expected_updated_at` is refused (concurrency).
4. Dismissing with a blank reason is refused; dismissing a close-blocking key is refused.
5. `acc_retire_work_items` resolves a row whose key is absent and leaves a live one alone.
6. The state table holds no accounting figure — asserted by column list, so a later edit that adds one fails this check.

- [ ] **Step 1:** write and run it. **Step 2:** full gates + smoke + `quality:bundle`. **Step 3:** changelog. **Step 4:** commit, push, wait for CI.

---

## Self-Review

1. **Spec coverage:** domain fields ✔ T1/T2; persisted state without amounts ✔ T2; audit ✔ T2; the seven filters (plus `all` and `dismissed`) ✔ T1/T4; revalidate-and-resolve ✔ T3; deep links — the row action already carries `href` with its queue context from Phase 1, and the filter is added to it in T4.
2. **Acceptance criteria:** concurrency ✔ T2/T5.3; actor and timestamp on every change ✔ T2; auto-resolve ✔ T3/T5.5; dismissal needs a reason and blockers cannot be dismissed ✔ T1/T2/T5.4; permission proof ✔ T5.2.
3. **To check during execution, not assume:** whether `acc_audit_log` accepts a text record id or needs a uuid (the state key is text — stamp the audit row with a generated uuid and put the key in `after_json`, as the import register does).
