# Accounting cockpit — Phase 6: expand to the other work areas

**Date:** 2026-08-22
**Spec:** `docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md` § Phase 6
**Follows:** Phase 5 (performance and gates), release 1.58

---

## The gate this phase is supposed to pass, and does not

The first acceptance criterion is *"A pattern expands only after `/accounting`
improves its behavioural metrics."* There is no pilot group and no behavioural
measurement — no task-completion times, no before-and-after on how long a close
takes, nothing. That criterion **cannot be met and is being waived, knowingly.**

What exists instead is structural evidence, and it is worth stating plainly so
nobody later mistakes it for the thing the spec asked for:

- `/accounting` renders eight rows of work above the fold at 1280×800 where the
  old page showed a chart heading first (Phase 0 baseline vs Phase 1).
- A section that fails costs only itself (`degraded.test.ts`).
- A page load costs 25 database reads where it cost 61 (Phase 5).

That is evidence the rebuilt page is *better built*. It is not evidence an
accountant finishes work faster, which is what the criterion asks. Whoever picks
this up should still run the measurement; expanding first is a decision made
without it.

## What is actually wrong with the four other screens

They are one component and one service, four times over:

| | |
|---|---|
| `components/work-areas/WorkAreaOverview.tsx` | 567 lines, renders all four areas |
| `lib/services/work-area-overviews.ts` | **1,275 lines**, four near-identical getters |
| `WorkAreaOverview.module.css` | 822 lines |
| Tests covering any of it | **none** — only the pure date helpers are tested |

Each getter fills the same eighteen-field `WorkAreaOverviewData`: four metrics, a
trend, two breakdowns, three stages, some exceptions, activities, four links, one
control. **The shape came first and each area was fitted into it.** That is why
Banking has "stages" and Inventory has a "trend" — not because anybody asked what
those screens are for.

The spec names the last problem itself: *"The redesign does not recreate a
service module over 1,000 lines."* One already exists.

## The rule that shapes this phase

> Retain proven primitives. **Do not copy the Accounting composition into other
> work areas.** Design each area around its own primary job.

So: extract what is genuinely general, and let each area compose it around its
own question. A primitive earns its place by being *about work*, not about
accounting.

**Shared** — nothing here knows what a ledger is:

- `SectionEnvelope` and the three data states, including that "unavailable" is
  never rendered as zero
- freshness, and the note that says when a figure was computed
- a work item: severity, age, owner, due date, lifecycle, and the ordering rule
- the *shape* of a control — pass condition, status, evidence, evaluated-at
- the *shape* of an insight — a named rule, its evidence, one action
- the work policy: materiality and the SLAs

**Not shared** — these stay with accounting and would be nonsense elsewhere:

- the seven accounting controls (`control-status.ts`)
- the eight insight rules (`insight-rules.ts`)
- the close checklist (`close-checklist.ts`)
- every accounting queue-item builder

Two names change on the way out. `blocksClose` becomes `blocking`, because
Banking blocks a reconciliation and Sales blocks nothing; accounting keeps its
own word at its own layer. `QueueSourceKind` stops being a fixed union and
becomes an area-owned string, because a shared type that lists
`overdue-invoice | bill-due | …` is the accounting composition wearing a
general name.

**A test enforces the boundary**: no file under `lib/domain/work-surface/` or
`components/work-surface/` may import from an area module, and none may name an
area's vocabulary. Otherwise "shared" quietly becomes "accounting's, reused".

## Each area's primary job

Taken from the spec, one question per screen. The screen answers that question
first and everything else is subordinate to it.

| Area | The question it answers | What that means on screen |
|---|---|---|
| **Banking** | *What is unmatched, and is the account reconciled?* | Unmatched lines by age, oldest first; how far each account is reconciled through; what blocks the next reconciliation |
| **Sales** | *What money is owed, and what is being done about it?* | Overdue receivables by party and age; who owns the chase; what has already been promised |
| **Purchases** | *What must be paid, what has arrived, and what does not add up?* | Bills due by date; receipts not billed and bills not received; three-way match exceptions |
| **Inventory** | *Can we sell it, and does the stock tie to the ledger?* | Availability and negative stock first; valuation tied to the control account |

Notice none of them is "four metric cards and a twelve-month chart", which is
what all four currently are.

## Sequence

Each step lands on its own, with the four gates green, so a problem is bisectable
to one area rather than to a 3,000-line rewrite.

**6a — Extract the primitives.** `lib/domain/work-surface/`,
`lib/services/work-surface/`, `components/work-surface/`. Accounting re-points at
them. **No behaviour change**, proven by the existing 2,137 tests plus the
boundary test above.

**6b — Banking.** The first area, and the one that proves the pattern: it has the
most concrete job and real data behind it.

**6c — Sales.** **6d — Purchases.** **6e — Inventory**, and with the last one,
`WorkAreaOverview.tsx`, `WorkAreaOverview.module.css` and
`work-area-overviews.ts` are deleted rather than left as a fifth way to draw a
screen.

## What each area must produce to be done

- Its own primary question, answered above the fold.
- Its own work queue, derived from its own sources, ordered by the shared rule.
- Its own small set of controls — not seven, whatever that area actually has.
- Success measures named in the plan, so "better" is arguable from figures.
- Unit tests over its rules, since the screens being replaced have none.
- `/accounting`'s bundle ceiling is per-route; each new route gets its own entry
  in `budgets.json` so this phase cannot quietly add weight everywhere.

---

# What was built

| Criterion | Result | |
|---|---|:--:|
| A pattern expands only after `/accounting` improves its behavioural metrics | **no pilot group, no measurement — waived knowingly** | ❌ |
| Every work area has its own primary job and success measures | four questions, four sets of checks | ✅ |
| Shared primitives contain no query or business rule specific to one area | enforced by `work-surface-boundary.test.ts` | ✅ |
| The redesign does not recreate a service module over 1,000 lines | largest new file is 300 lines; the 1,275-line one is deleted | ✅ |

**Net: 2,602 lines added, 2,993 removed.** What went: `WorkAreaOverview.tsx`
(567), its stylesheet (962), the skeleton (35), `work-area-overviews.ts` (1,275).

## The four questions, and what each screen does about them

| Area | Question | Checks | The row that matters |
|---|---|---|---|
| Banking | What is unmatched, and how far is each account reconciled? | unmatched activity · feed health · statements reconciled | oldest unmatched line, with the account and the wait |
| Sales | Who owes money, and what is being done about it? | overdue receivables · unapplied receipts · unissued invoices | a named customer, an invoice number, days late |
| Purchases | What must be paid, what arrived, what does not add up? | bills due · received-not-billed · unapplied payments | a receipt nobody has been invoiced for |
| Inventory | Can we sell it, and does it tie to the ledger? | valuation tie-out · negative stock · depreciation due | **the variance — the one row nobody may dismiss** |

## The design decision that separates this from the last attempt

Three of the four surfaces build **no control-failure queue rows**. Their checks
summarise work the queue already itemises — unmatched activity *is* the unmatched
lines — so a control row would put the same work on screen twice. The consequence
follows honestly: nothing on those three blocks, so everything can be dismissed
with a reason, and dismissing a row hides it while the check goes on counting.

Inventory is the exception and proves the rule. A valuation variance has no
smaller representation than itself, so it becomes a row, and it blocks. Which is
the accounting surface's pattern, arrived at from the same argument rather than
copied.

`SurfaceScreen` exists because Banking, Sales and Purchases genuinely converged
on two sections — **opted into, not fitted into**, which is the exact failure of
the component this deletes. Accounting does not use it and should not: it has an
explanation panel, a close mode and a trend section.

## One defect closed on the way through

Generalising the row menu exposed that `acc_set_work_item_state` took its
"is this blocking" flag **from the browser**. The refusal to dismiss a blocking
item was therefore answered by the person being refused.

Nothing could be posted through it — dismissing changes no figure, and
`acc_close_period` re-derives its own gate and never read the flag — but the
guard existed to stop a blocking exception being swept out of sight, and one the
sweeper supplies does not stop that. Each surface now hands in a resolver, it is
called only on dismissal so ordinary actions cost nothing, and a resolver that
throws leaves the item treated as blocking: **a failed read must not become
permission.**

## Measured

| Route | total gzip | owned gzip |
|---|---:|---:|
| `/accounting` | 665,157 | 13,996 |
| `/banking/overview` | 663,111 | 11,950 |
| `/sales` | 663,108 | 11,947 |
| `/purchases` | 663,113 | 11,952 |
| `/inventory` | 663,168 | 12,007 |

The four surfaces sit within 60 bytes of each other on owned JavaScript, which is
what genuinely sharing parts looks like. All routes total 2,022,225 against a
2,100,000 ceiling; every route has its own budget entry.

2,183 tests, smoke 59 of 59, lint at its 11-warning baseline. Verified live on
Aurora: Sales lists six overdue invoices from 34 to 122 days; Purchases reports
three bills overdue at 15,820.00 and a PO line received-not-billed at 800.00
ordered 67 days ago; Inventory ties out and shows eight assets with depreciation
due since 2024; Banking shows 11 unmatched lines, oldest 230 days.

## Still owed

The behavioural measurement. Everything above says the screens are *better
built*; none of it says an accountant finishes faster. Whoever picks this up
should run it — the structure to compare against is now in place, which it was
not before.
