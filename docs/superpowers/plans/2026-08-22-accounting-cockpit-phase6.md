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
