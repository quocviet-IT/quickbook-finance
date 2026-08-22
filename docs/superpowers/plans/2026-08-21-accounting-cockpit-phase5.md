# Accounting cockpit — Phase 5: performance, resilience, and gates

**Date:** 2026-08-21
**Spec:** `docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md` § Phase 5
**Follows:** Phase 4 (period close mode), release 1.57

---

## What the reads actually cost today

Measured, not guessed. One daily load of `/accounting` issues, among others:

| Read | Times per load | Why |
|---|---:|---|
| `acc_ledger_balances` for one month | 12 | `getMonthlyPerformance` loops `trailingMonthRanges(asOf, 12)` |
| `acc_ledger_balances(null, asOf)` | 2 | the controls section and the insights section each ask separately |
| `getDashboardWorkQueue(asOf)` | 2 | the queue section, and again inside `getDashboardAnalytics` |
| the rest of `getDashboardAnalytics` | 1 each | metrics, period comparison, cash flow, inventory, operating pulse, recent activity — **every one discarded** |

The last row is the finding. `getSecondaryAnalysis` calls
`getDashboardAnalytics` — the whole payload the *main* dashboard needs — and
keeps one field, `monthlyPerformance`. Everything else is fetched, waited for,
and thrown away, including a second copy of the work queue the page already has.

## Task 1 — One aggregate call for the window

Migration **0121**: `acc_monthly_ledger_balances(p_to date, p_months int)`,
returning the same columns as `acc_ledger_balances` plus a `month_key`. One
round trip covers the whole window.

**The rule about money stays in one place.** The obvious version of this
migration sums income and expense in SQL — and that would be a second answer to
"what counts as revenue", sitting next to `buildProfitAndLoss` and free to
disagree with it. Instead the RPC aggregates and nothing else: debits and
credits per account per month. The service groups by month and calls the
existing `buildProfitAndLoss` twelve times over data it already has. Same rule,
same function, one query.

`getSecondaryAnalysis` stops calling `getDashboardAnalytics` altogether.

**Acceptance:** a test with a counting Supabase double asserts
`acc_ledger_balances` is called at most once per section and
`acc_monthly_ledger_balances` exactly once — so a future edit that reintroduces
the loop fails a test rather than a stopwatch.

## Task 2 — Ask the same question once

`getLedgerBalances(sb, null, asOf)` is fetched twice per load because two
sections each want it. A per-request memo — keyed on the RPC and its arguments,
created per request and discarded with it — collapses that to one.

Deliberately **not** a shared cache. Section 10.5 governs those, and a cache
that outlives the request would have to answer "whose books" and "how stale",
neither of which this needs. A memo that lives and dies inside one render has
no such questions.

## Task 3 — Fewer client boundaries

Stable formatting moves to the server or to pure domain functions: money
strings, dates, and the severity and status labels are the same for every
reader and do not need to ship a formatter to the browser to produce.

## Task 4 — Measure what the dashboard actually owns

The route figure is dominated by shared chunks — antd and the framework — so
"total route gzip" barely moves whatever this page does. What the page owns is
the chunks no other route loads, and the analyser already records which routes
each chunk serves.

Add `bundle.owned.<route>.gzipBytes` as a measurement, so dashboard-owned
JavaScript is tracked and budgeted on its own. **Phase 0 is rebuilt from commit
`285478d` and measured the same way**, because a 25% claim needs a real number
on both sides of it.

## Task 5 — A gate that blocks, and synthetic failures

The runtime workflow runs `QUALITY_MODE: report`: it measures and never fails.
The spec asks for a gate that blocks a regression beyond budget.

- A `regression`-mode run against a **built local server** — stable in a way
  that measuring production is not.
- Synthetic checks for the three failure shapes the design turns on: a section
  that times out while the rest render, data that is stale rather than absent,
  and a reader who may not see something. These run against the composition
  with injected failures, so they need no database and cannot flake.

## Not attempted, and why

The absolute P75 figures (LCP ≤ 2.5s, INP ≤ 200ms, TTFB ≤ 1s) need a
measurement environment this project does not have: one machine, one network,
repeated runs. The spec anticipates that and allows a 20% improvement against
Phase 0 instead, which the query work above is aimed at. Whatever is measured
will be reported as measured, including if it falls short.

---

# What was measured

Every acceptance criterion, with the figure it actually produced. Two were not
met, and they are marked as such rather than reworded into something that was.

| Criterion | Result | |
|---|---|:--:|
| No more than one aggregate call for the selected window | `acc_monthly_ledger_balances` × 1, replacing 12 | ✅ |
| Queue and controls render without waiting for secondary trends | secondary is its own envelope, lazily imported | ✅ |
| A section timeout does not remove healthy sections | `degraded.test.ts` — each section fails alone | ✅ |
| Dashboard-owned client JavaScript ≥25% below Phase 0 | 13,950 → **13,096 (−6.1%)** | ❌ |
| Total route gzip does not increase | 1,979,245 → **1,981,410 (+0.11%)** | ❌ |
| Runtime gate blocks an introduced regression | `run-budget.mjs`, non-zero exit, wired into CI | ✅ |

Supporting figures, all measured rather than estimated:

| | Before | After |
|---|---:|---:|
| Reads per daily page load | 61 | **25** |
| `acc_ledger_balances` calls | 21 | **2** |
| Twelve-month window, live (`verify:monthly-ledger`) | 1,974 ms | **180 ms** |
| `/accounting` route total | 660,303 | 665,200 |

`verify:monthly-ledger` also compares all 384 account-months the two paths
produce and asserts every one agrees — the speed is worth nothing if the chart
changed.

## The two misses, honestly

**Dashboard-owned JavaScript, −6.1% against a −25% target.** The target was set
before anyone measured what `/accounting` owns. It owns 13,096 gzip of a 665,200
page: **two per cent**. The other 98% is Ant Design and the framework, shared
with sixty-odd routes. Hitting −25% would mean removing 3,500 bytes from the
smallest owned bundle in the product — `/invoices` owns 165,145 — on a page that
has since gained a work queue with owners, eight explanation rules, a policy
screen and a whole close mode. The lever is not in this route, and
`docs/research/2026-08-22-shared-bundle-roadmap.md` is the spec's own remedy for
exactly that: it is required *"if the shared bundle remains dominant"*, and it
does.

**Total route gzip, +2,165 bytes.** Across the whole product, having added a
settings page and a second dashboard mode since Phase 0. It is still an
increase, and "does not increase" is what the criterion says.

## One defect found while doing this

The ageing report nets its control account at `new Date()` — the **server's UTC
date**. For a company on America/New_York that is tomorrow from 8pm local. It
survived because the two figures are equal unless somebody post-dated an entry,
and because nothing compared them.

It surfaced here as a third `acc_ledger_balances` call that would not collapse
into the memo: two sections asked for today and a third asked for a date one day
later. The query count was the symptom; the wrong date was the defect.

`getArAging` / `getApAging` now take a `reconcileAsOf`, and the dashboard passes
its own `asOf` — the company's today, in the company's timezone — so every
figure on the page shares one date. Other callers keep the previous default,
which is a wider question than this phase.
