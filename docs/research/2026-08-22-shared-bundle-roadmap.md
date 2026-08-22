# The shared bundle is the weight — a roadmap

- Date: 2026-08-22
- Written because: spec §Phase 5 asks for this document by name — *"Create a
  separate shared-bundle roadmap if the shared bundle remains dominant."*
- Measured at commit `224dff2` + the Phase 5 working tree, `npm run
  quality:bundle`, gzip bytes

## The finding

Phase 5 set out to make `/accounting` lighter. It did, and it barely mattered,
because almost none of that route's weight belongs to it:

| | gzip |
|---|---:|
| `/accounting`, everything the browser loads | 665,200 |
| …of which the page's **own** code | **13,096** |
| …of which is shared with other routes | 652,104 |

**Two per cent of the page is the page.** Phase 5 cut the page's own code from
13,950 to 13,096 — a real reduction, and 0.13% of what a reader downloads.

## Where the weight actually is

45 chunks are shared by more than one route, totalling **908,632 gzip**. The six
largest:

| gzip | routes using it |
|---:|---:|
| 86,270 | 63 |
| 65,329 | 67 |
| 64,637 | 17 |
| 64,381 | 64 |
| 48,349 | 63 |
| 48,245 | 63 |

Six chunks, 377,211 gzip, on essentially every page in the product. This is Ant
Design and the framework runtime. No amount of work inside one route touches it.

## And `/accounting` is already among the leanest

Route-owned code, largest first:

| route | owned gzip |
|---|---:|
| `/invoices` | 165,145 |
| `/banking` | 156,129 |
| `/status` | 59,516 |
| `/login` | 43,182 |
| `/reports` | 33,019 |
| `/settings/users` | 31,818 |
| **`/accounting`** | **13,096** |

The spec's Phase 5 target — dashboard-owned JavaScript 25% below Phase 0 — was
written before any of this was measured. Meeting it now would mean finding
3,500 gzip bytes inside the smallest owned bundle in the product, on a page
that has since gained a work queue with owners, eight explanation rules, a
policy screen and a whole close mode. **It was not met: −6.1%, not −25%.** The
figure to chase was never in this route.

## What would actually move it

In the order the evidence supports, not the order of difficulty.

### 1. Find out what those six chunks contain

Nothing below should be started before this. The analyser reports chunk sizes
and which routes load them; it does not say what is *inside* one. Until that is
known, every proposal here is a guess with a number attached.

Work: a module-level attribution pass over the shared chunks, reported the same
way `bundle.json` reports routes, so it is re-runnable rather than a one-off
reading of a treemap.

### 2. Stop shipping Ant Design components nobody renders

Expected finding from step 1, stated so it can be refuted: the 63-route chunks
are antd, pulled in through barrel imports. A page that needs `Button` and
`Card` may be dragging the whole entry point.

Work: check whether the current import style is tree-shaken at all; if not,
per-component paths, measured before and after on three routes.

### 3. Split the two routes that own the most

`/invoices` and `/banking` own 321,274 gzip between them — twenty-four times
`/accounting`. Whatever is in there, it is the second-largest lever in the
product and neither route has been looked at.

### 4. Only then, revisit a per-route owned budget

`tests/quality/budgets.json` holds a ceiling for `/accounting` alone. Extending
it to every route is worth doing *after* steps 1–3, when the numbers are
understood; doing it first would freeze today's accidents as tomorrow's targets.

## What this roadmap deliberately does not say

It does not propose replacing Ant Design. The library is the reason this product
has a consistent, accessible interface built by a small team, and 900KB of
shared, cached, once-downloaded JavaScript is a normal price for that. The
question worth asking is whether we ship *all* of it to *every* page — which is
step 1, and is unanswered.

It also does not promise a figure. Every number above is measured; the only
honest thing to say about the outcome is that step 1 will produce one.
