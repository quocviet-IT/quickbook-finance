# Accounting cockpit — Phase 4: period close mode

**Date:** 2026-08-21
**Spec:** `docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md` § Phase 4
**Precedes:** Phase 5 (performance and measurement), Phase 6 (expansion)

---

## The one thing this phase must get right

The seven controls on the daily panel are evaluated **as of today**. Close
readiness is a question about **the last day of a period**. They are not the
same question, and answering the second with the first would be wrong in both
directions:

- Receivables can tie today and have been out on 31 March, because somebody
  posted a correcting entry in April.
- Receivables can be out today and have tied perfectly on 31 March, because
  April's invoices have not been paid yet.

So every step of the close checklist is re-evaluated at the **period end date**,
never reused from the daily strip. `acc_period_close_blockers` already works
this way — it loops `acc_control_reconciliation(period_end)` — and the checklist
derives from the same function, so the screen and the gate cannot disagree.

## What is not built

**No step can be ticked.** There is no mutation for step state, no "mark
complete", no override. A step is complete because the books say so — the trial
balance balances at that date, the statement was reconciled through it, the
draft was posted. Spec Task 6 states this as a prohibition; here it is a
structural fact, because the storage to do otherwise does not exist. The
verification proves it behaviourally: post a draft into the period and the step
flips on its own; remove it and it flips back.

---

## Task 1 — The checklist as pure rules

`lib/domain/accounting-dashboard/close-checklist.ts`

```ts
export type CloseStepStatus = "complete" | "outstanding" | "not-applicable" | "unavailable";
export interface CloseStep {
  key: string;
  title: string;
  status: CloseStepStatus;
  /** What being complete means, so the reader need not guess. */
  passCondition: string;
  /** The figures this status was reached from. */
  evidence: string;
  blocksClose: boolean;
  href: string;
  /** The work item this step corresponds to, when one exists. */
  workKey: string | null;
}
```

Steps, all evaluated at `period_end`:

| Step | Complete when | Not applicable when | Blocks |
|---|---|---|---|
| Trial balance | posted debits = credits through period end | never | yes |
| One per control account | subledger ties to control at period end | no subledger **and** the control account is zero | yes |
| Drafts in the period | no draft invoice or bill dated inside the period | never | no |
| Bank reconciled | a completed reconciliation ends on or after period end | the company has no bank account | no |
| Approvals decided | nothing requested on or before period end still pending | never | no |

The applicability rule for a control account is copied from the gate, not
invented: `acc_period_close_blockers` treats a missing subledger as
`variance = control_minor`, so a non-zero control account with no subledger is a
blocker there and must be outstanding here too.

**Progress reconciles, by construction:**

```ts
export function closeProgress(steps: readonly CloseStep[]): CloseProgress
// { complete, outstanding, notApplicable, unavailable, applicable }
// invariant, asserted in a test: complete + outstanding === applicable
```

`unavailable` is counted and reported on its own. A step nobody could check is
not progress and is not a failure, and a bar reading "5 of 7" while one step
never ran is a lie of exactly the kind Phase 1 was built to stop.

## Task 2 — When close mode is recommended

Two triggers, and only one of them needs a number:

- **A period is open past the last day it covers.** Objective, needs no policy,
  fires always.
- **The current period ends within `closeWindowDays`.** Needs a number nobody
  has chosen yet — so it is a work policy field, null by default, and while it
  is null this trigger stays asleep and the screen says which setting it waits
  on. Same rule as Phase 3: no invented thresholds.

Migration **0120** adds `close_window_days` to `acc_work_policy` and widens
`acc_current_work_policy` and `acc_save_work_policy`. The four-argument save is
dropped so an out-of-date caller fails loudly rather than silently discarding
the new field — the rule migration 0074 set for `acc_close_period`.

## Task 3 — Days to close, measured not asserted

`acc_period_event` has carried close and reopen events since 0028. Days to close
is the distance from `period_end` to the close event, per closed period. Nothing
new is stored: this is a measurement of history that already exists.

Shown as the last few closed periods with their day counts and the median, so
"we are slower than usual this month" is a figure rather than a feeling.

## Task 4 — The mode itself

`?mode=close` on `/accounting`, server-read, linkable.

- **Daily** pays nothing for this: the recommendation banner needs only the
  periods already in the context and the policy already fetched. No extra query.
- **Close** fetches the checklist for the target period — the oldest period open
  past its end, or the current one.

The close panel carries the checklist, the blocker headline from
`acc_period_close_blockers`, the owner of each blocking step (joined from the
Phase 2 work item state by `workKey`), the days-to-close history, and the close
and reopen actions.

Owners are why the ten-second acceptance criterion is reachable: the largest
blocker is first because blocking steps sort above non-blocking, and the person
holding it is on the same row.

## Task 5 — Closing and reopening from here

Reuses `closePeriod` / `reopenPeriod`, which call the RPCs that already enforce
admin-only, require a reason, and refuse a close over a variance without a
written explanation. Nothing about the gate is reimplemented on this screen; it
is called from one more place.

## Verification

`scripts/verify-close-readiness.mjs`, one rolled-back transaction:

1. A period with a clean ledger reports every applicable step complete, and the
   progress figures reconcile.
2. **A draft invoice dated inside the period makes the drafts step outstanding,
   and removing it makes the step complete again** — the proof that no step is
   stored.
3. A control account put out at the period end blocks the close, and
   `acc_period_close_blockers` names it.
4. The same books tie *today* while failing *at the period end* — the correction
   this phase exists for.
5. A non-admin cannot close a period.
6. `close_window_days` survives a round trip, and null stays null.

Plus the four gates, `smoke-pages.mjs` on the built server, and the bundle
ceiling for `/accounting` — the close panel is dynamically imported, since daily
mode never renders it.
