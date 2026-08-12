# P1 — Standardising One Book's UI foundation

Date: 2026-08-11
Status: design approved; wave 1 built and merged-ready, waves 2–4 awaiting plans

## 1. Purpose

P0 built the instruments: Axe, a keyboard harness, a viewport matrix, bundle
budgets and a baseline. P1 uses those instruments to standardise the UI
foundation, aiming to bring the UX and Accessibility axes to 8.0.

P1 does **not** bring Performance to 8.0. Section 3 says why.

## 2. Measured starting point

Every number below was measured directly from the source and from
`.quality-results/` on 2026-08-11. None of it is an estimate.

| Metric | Value |
|---|---|
| Files declaring `columns=` | 73 |
| Files formatting currency by hand | 56 |
| `<Table>` call sites | 51 (37 files import antd `Table` directly, 33 use `DataTable`) |
| `pagination={false}` | 61 |
| Pages marked `force-dynamic` | 59/60 |
| TSX files that are Client Components | 128/201 |
| Components over 400 lines | 13 |
| `next/dynamic` usages | **0** |
| CSS custom properties in `globals.css` (3,312 lines) | **6** (five of them `--dashboard-*`, scoped to one section; no `:root` block at all) |

Table feature variety is very low: `summary=` appears 6 times (all in reports),
`expandable=` 5, `rowSelection=` 1, `onRow=` 1, `rowClassName=` 12.

### Bundle (gzip)

| | |
|---|---|
| Loaded on ~59/63 routes, spread over 30 chunks | **613 KB** |
| `/invoices` total | 935 KB |
| `/banking` total | 921 KB |
| Lightest route in the app group | ~720 KB |

The largest single-route chunks are 136 KB on `/banking` and 121 KB on
`/invoices`.

### Three findings that changed the approach

**a. The token system already exists; nothing reads it.**
`app/providers.tsx` declares `colorPrimary: #0f766e`, `colorSuccess: #15803d`,
`colorError: #b91c1c` and `colorTextHeading: #0f172a`. The hex literals scattered
through the TSX are hand-copied duplicates of exactly those values — `#0f766e`
eight times, `#b91c1c` seven, `#15803d` five, `#0f172a` four. So the work is not
inventing a token system; it is making the source of truth that already exists
reachable from CSS and TSX.

**b. The duplication in tables lives in the columns, not in the table component.**
The tables are mostly flat, but 56 files wire up currency formatting themselves.
`formatMoney` in `lib/format.ts` is already correct and already exists — the
problem is that every site handles alignment, the negative sign and the
accessible name its own way.

**c. Performance is dominated by the shared chunk, not by page code.**
`/invoices` totals 935 KB but contributes only ~77 KB of its own. Splitting the
992-line `InvoicesClient` improves maintainability and narrows re-render scope;
it does **not** reduce what the browser downloads.

## 3. Design principles

1. **Put the reuse where the duplication actually is.** Columns, not tables.
2. **Turn a rule into structure, not a checklist item.** A rule that lives only
   in a review document gets forgotten. A rule the API enforces cannot be.
3. **One definition, many derivations** — the same pattern `lib/domain/*` already
   uses for the accounting rules.
4. **Guard with unit tests, not with review discipline** — the same pattern as
   `tests/unit/rsc-antd.test.ts` and `navigation.test.ts`.
5. **The gate stays green throughout.** No batch leaves it red.
6. **Remaining debt must be visible** as a concrete list of files.

## 4. The shrinking allowlist

Applied uniformly across all four waves. This is how the horizontal-sweep
trade-off is paid for: each wave touches many files, so it cannot be one
enormous pull request.

- The first batch of each wave builds the primitives and their tests and **turns
  the guard on immediately**, with an allowlist naming every file still in debt.
  **No screen changes.**
- Later batches migrate by business area, each deleting entries from the list.
- The final batch empties the list and deletes the mechanism.

The result: the gate is green throughout, and what remains is always a readable
list rather than a feeling. A wave abandoned half-way denounces itself.

**Each wave gets its own implementation plan**, not one combined plan. The four
waves depend on each other in order but share no files, so combining them would
only produce a plan too large to follow. The parallel wave in section 9 has its
own plan.

## 5. Wave 1 — Semantic tokens

### Architecture

```
lib/design/tokens.ts          ← the single definition; pure, no I/O, no React
   ├──► app/providers.tsx     → ConfigProvider theme   (Ant Design components)
   └──► app/globals.css       → :root { --ob-* } block (CSS and inline styles)
```

Three separated layers:

1. **Palette** — raw colour values carrying no meaning (`teal700: "#0f766e"`).
   No component may import this layer.
2. **Semantics** — accounting concepts mapped onto the palette:
   `money.negative | positive | zero`;
   `status.posted | void | draft | overdue | pending`;
   `intent.primary | success | warning | danger | info`;
   `surface.* | text.* | border.*`
3. **Emitters** — `antdThemeTokens()` returns the object `ConfigProvider` takes;
   `cssVariableBlock()` returns the `:root` string.

### Making the accessibility rule structural

A status token does not return a bare colour; it returns three things:

```ts
statusToken("overdue") → { color, icon, label }
```

**Correcting a false claim from the first draft of this spec.** That draft said
the triple made the rule *structural*. It does not: `statusToken("overdue").color`
is still a one-liner, so it is a *convention*. The wave-1 Task 5 review caught
this, and it is not academic — `void` and `draft` deliberately share one muted
colour, so any screen that takes only `.color` renders the two identically.

The structure lives in `StatusBadge`:

```tsx
<StatusBadge status="overdue" />   // icon, wording and colour, inseparable
```

That is the default path for every screen. `statusToken()` remains for the
genuine exception — a total tinted by whether it is overdue, say — but showing a
status as a badge has to be **easier** than showing it wrongly.

### Preventing drift

The `:root` block sits **statically** in `globals.css`; it is not injected at
runtime. A unit test asserts it matches `cssVariableBlock()` exactly. Edit one
without the other and the test fails.

### How far wave 1 actually got — recorded after it shipped

Wave 1 is complete. Three things must be stated accurately, because waves 2–4
build on it:

1. **The scope was narrower than this section originally described.** Wave 1
   removed colour from **TSX and the Ant Design theme**. Inside `app/` and
   `components/` there are still **309 hex literals in CSS** (`globals.css` 225,
   `WorkAreaOverview.module.css` 84) — including `#0f766e` thirty times over, the
   same hand-copied duplication the wave removed from TSX. They are listed in the
   guard's allowlist with counts and reasons, and the guard now walks `.css`.
   The mistake traces to the survey above: it measured six custom properties in
   `globals.css` and concluded tokens barely existed, without ever counting the
   hex literals in the same file.
2. **`var(--ob-*)` is read zero times.** The `:root` block is the first half of a
   pipe with nothing yet drinking from it. Wave 2 must not assume CSS is already
   token-driven.
3. **`StatusBadge` has no call sites.** Every status in the app still renders as
   `<Tag color="green">` with no icon. The component is correct and tested, but
   its intended consumer is `statusColumn()` in wave 2 — count it as *built*, not
   as *adopted*.

Also still outstanding, and out of wave 1's scope: 64 `<Tag color="red">` call
sites use Ant Design's preset colour scale, which is generated independently of
`colorError`. So `CustomerCreditClient` now renders `#b91c1c` beside `#cf1322` —
two reds meaning the same thing on one screen. The "three different reds" problem
is half solved; the other half belongs to wave 2's `statusColumn()`.

### Testing — `tests/unit/design-tokens.test.ts`

| Assertion | What it catches |
|---|---|
| Every semantic token resolves to a palette entry | An orphan hex smuggled into the semantic layer |
| The `:root` block matches `cssVariableBlock()` | The two sources drifting apart |
| `providers.tsx` contains no hex literal | A colour pasted straight into the theme |
| Every text/background pair meets WCAG AA 4.5:1 | Unreadable colour — computable from the values alone, so it is a unit test rather than something to wait for Axe to find |
| Non-colour theme settings survive in `providers.tsx` | A rewrite silently dropping `headerHeight`, which is exactly what happened once |
| No-hex guard over `app/` and `components/`, walking `.ts`, `.tsx` and `.css` | Hard-coded colour coming back, including through a CSS Module beside a component |

`lib/client/invoice-pdf.ts` and `lib/client/report-export.ts` are deliberately
outside the guard: colours inside a generated PDF or an XLSX cell are not CSS and
never derive from the theme.

### Batches

- **Batch 1** — `tokens.ts`, its tests, wiring `providers.tsx`, emitting `:root`,
  and turning the no-hex guard on with its allowlist. No pixel changes.
- **Batches 2…n** — remove hex by area: charts and dashboard, reports,
  operational screens, the rest.
- **Final batch** — the allowlist covers only the two stylesheets left for a
  later wave.

## 6. Wave 2 — Table

### Components

```
components/ui/DataTable.tsx      ← stays thin (~80 lines), gains a two-mode contract
components/ui/ReportTable.tsx    ← variant for the 6 report tables with summary rows
components/ui/columns.tsx        ← the column kit: where the reuse really is
lib/client/table-url-state.ts    ← the URL-sync hook
```

### The column kit

| Builder | What it solves |
|---|---|
| `moneyColumn()` | Right alignment, tabular figures, a negative marked by **sign and icon** rather than colour alone, and an `aria-label` that reads clearly ("negative 1,234.56 US dollars"). Calls the existing `formatMoney`; does not reimplement it |
| `statusColumn()` | Uses wave 1's `statusToken()` — colour, icon and label |
| `dateColumn()` | One date format, with a correct `<time datetime>` |
| `actionsColumn()` | Routes through `IconActionButton`, inheriting the 44×44 target from wave 3 |

### The two-mode contract

`DataTable` accepts **one of two** data sources:

- client mode: `rows={T[]}` — paginated and sorted locally
- server mode: `page={{ rows, total, pageIndex, pageSize }}` plus callbacks

Both run through `useTableUrlState`. When a screen later moves to server-side
paging, what changes is the data source in `page.tsx`; the table markup and every
column declaration are **untouched**.

### URL state, and a performance trap

59 of 60 pages are `force-dynamic`. If the hook called `router.replace()` on
every filter change, each keystroke would trigger a server render — fixing the UX
by breaking the performance. So the hook distinguishes:

- **client mode** → writes the URL with `history.replaceState`, no router call.
  The URL is still shareable and restorable, with no round trip.
- **server mode** → `router.replace()`, because the round trip is the point.

URL parameters are parsed with **Zod**, following the `lib/domain/schemas.ts`
convention. An old link carrying `page=abc`, or a sort column that no longer
exists, falls back to the defaults rather than throwing. That is validating
untrusted input, not swallowing an error.

### Testing

- `moneyColumn` with a positive, a negative and zero — check the rendered string
  **and** the `aria-label`
- `useTableUrlState` — parse↔serialise round trip; junk parameters fall back
- Guard 1: every `<Table>` outside `DataTable`/`ReportTable` must be allowlisted
- Guard 2: `pagination={false}` (61 sites) — each allowlist entry **must carry a
  reason**, because some tables are bounded by construction and are not wrong

### Batches

- **Batch 1** — column kit, hook and `DataTable` contract, with tests. No screen
  changes.
- **Batches 2…n** — Sales → Purchases → Banking → Accounting → Settings.
- **Final batch** — Reports, which need `ReportTable` and its summary rows.

### Out of scope for this wave

This wave improves UX and maintainability. It does **not** reduce the bundle.

## 7. Wave 3 — Forms and accessibility

The weakest axis, but not for want of awareness: 97 `aria-label` declarations
already exist. The cause is that every form has to remember the hard parts for
itself. So the design collects the hard parts into one path a form cannot bypass.

### Components

```
components/ui/AccessibleField.tsx    ← wraps Form.Item, wiring aria-describedby fully
components/ui/LiveAnnouncer.tsx      ← two live regions, mounted once in AppShell
lib/client/use-feedback.ts           ← toast and announcement in ONE call
lib/client/use-form-submit.ts        ← the shared path for calling a Server Action
lib/domain/error-message.ts          ← describeError()
```

### AccessibleField

Ant Design's `Form.Item` already links the label and the error. The gap is helper
text: when a field has both a description and an error, antd links only the
error, and the description disappears for screen-reader users. `AccessibleField`
generates ids with `useId()` and composes `aria-describedby` from **both**.
Required is expressed in words rather than by an asterisk alone, and an error
message carries its field's name.

It must be `"use client"` — per the trap recorded in CLAUDE.md, a Server
Component cannot read `Form.Item`.

### The announcer is welded to the toast

If `announce()` and `message.success()` stay separate, people will call the
second and forget the first. So they are one: `useFeedback().success(...)` and
`useFeedback().error(...)` do both. A guard test **forbids calling `message.*`
directly outside `useFeedback`**.

### Focus management — four moments

| Moment | Behaviour |
|---|---|
| Modal or drawer opens | Focus the first field |
| It closes | Return focus to the trigger (`useReturnFocus`) |
| **Route change** | App Router does not move focus; a screen reader stays where it was. `RouteFocus` in AppShell moves focus to the `<h1>` that `PageHeader` renders |
| Validation fails | Focus the first invalid field and announce "N errors to fix" |

### useFormSubmit

Wraps a Server Action call and handles the whole cycle: pending → on success,
announce and toast → on failure, map errors onto their fields, focus the first,
announce the count. This replaces hoping that 44 `actions.ts` files each remember
to do it.

`describeError()` strips Postgres noise and **adds recovery guidance**. It has an
easy job because the RPCs already raise readable English (`'Not authorized to
post journal entries'`, `'This line is already matched to the ledger'`). An
unrecognised error is shown **verbatim** rather than swallowed, per CLAUDE.md.

### 44×44 touch targets

Set the minimum on `IconActionButton`. Because wave 2's `actionsColumn` already
routes through that component, every table action inherits the fix without being
touched again.

### Testing

- Unit: `AccessibleField` composes `aria-describedby` from helper and error
- Unit: `describeError`, including an unknown error passing through intact
- Unit: the guard forbidding direct `message.*`
- Runtime: **add scenarios to the existing `scripts/quality/keyboard.mjs`** (638
  lines, already carrying a drawer focus-wrap harness) — focus returned on modal
  close, focus on route change, focus on validation failure. No new tooling.

## 8. Wave 4 — Page pattern and responsive

### The page pattern

```
PageHeader → summary → FilterBar → DataTable → detail drawer/modal
```

Implemented as `WorkListPage` with named slots, **the default but not mandatory**
— reports and settings legitimately have a different shape. A guard test lists
the list screens not using it. The pattern is a default, not a frame that
distorts an unusual screen.

### Responsive: data priority, declared in the column definition

Only possible because wave 2 centralised the columns. Each column declares a
priority:

```ts
moneyColumn({ title: "Balance", dataIndex: "balance_due_minor", priority: "primary" })
dateColumn({  title: "Due",     dataIndex: "due_date",          priority: "secondary" })
textColumn({  title: "Memo",    dataIndex: "memo",              priority: "detail" })
```

Below 768px, `DataTable` renders a card list from `primary` and `secondary`, and
pushes `detail` into the row's drawer. There is no separate mobile markup to
drift — the small layout is **derived** from the column declarations.

### Splitting the 13 large components

Done **in the same batch as that screen's adoption of the pattern**, not as a
separate wave, so each pull request is one complete, reviewable screen.

Rules:
- The screen keeps the page shell and the table wiring
- Each modal or drawer moves to its own file, loaded with `next/dynamic`
- Pure functions stranded inside a component move to `lib/domain/`

Stated honestly: the split improves maintainability and narrows re-render scope.
The bundle reduction comes from `next/dynamic` on the modals, not from the split.

### Testing

P0 already runs four viewports (375/768/1024/1440) over the 12 routes in
`MATRIX_ROUTES`, with `viewport-clipping`, `fixed-shell-overlap` and
`target-size`. This wave **widens `MATRIX_ROUTES`** rather than building new
tooling. Add a unit guard: every column set must have at least one `primary`
column.

## 9. Parallel wave — shrinking the shared bundle

Independent of the four waves and sharing no files with them, so it can run
alongside. Pulled forward from P2 because without it the Performance axis barely
moves after P1.

### Established with certainty

**a. `jspdf` is imported statically on the largest route.**
`lib/client/invoice-pdf.ts` imports `jsPDF` and `jspdf-autotable` at the top of
the file, and `InvoicesClient.tsx` imports that module. The 121 KB gzip chunk
that sits only on `/invoices` is exactly this. `lib/client/report-export.ts`
**already** does it dynamically. Following that pattern is a certain win,
measurable immediately with `npm run quality:bundle`.

**b. The repository contains zero `next/dynamic` usages.**
The lazy-loaded-modal lever is entirely untapped. Combine with wave 4.

### To be measured before deciding

**c. The 136 KB chunk that sits only on `/banking`** — not yet identified.

**d. 613 KB shared across 30 chunks, with no dominant chunk.**
The surface is 37 antd components and 20 icons across 53 files. Check whether
`optimizePackageImports` already applies to `antd` and `@ant-design/icons` —
Next.js ships a default list, so **measure before configuring**, or the change is
a config line that does nothing.

### Principle

Every change carries before/after numbers from `npm run quality:bundle`. The
current budget is 10% or 20 KB gzip.

## 10. Acceptance criteria

### Per wave

| Wave | Done when |
|---|---|
| 1 — Tokens | No hex outside the two allowlisted stylesheets; the WCAG AA contrast test green; `providers.tsx` free of literals |
| 2 — Table | Both allowlists empty; every table goes through `DataTable`/`ReportTable`; filter, sort and page restore from the URL |
| 3 — Forms/a11y | The `message.*` allowlist empty; the new keyboard scenarios green; every touch target ≥ 44×44 |
| 4 — Pattern | Every list screen uses `WorkListPage`; every column set has a `primary`; the 13 components over 400 lines are split **or** allowlisted with a reason |
| Parallel — Bundle | `/invoices` down ≥ 100 KB gzip; items c and d measured and concluded |

### P1 overall

- The four mandatory gates green: `build`, `test`, `typecheck`, `lint`
- `scripts/smoke-pages.mjs` green against the built server
- `npm run quality:runtime` raising no new findings against the baseline
- No allowlist left behind except those explicitly deferred with a reason

## 11. Explicitly NOT in P1's scope

Stated plainly so nobody reads it as finished:

- **Server-side pagination.** Wave 2 only clears the way with its two-mode
  contract.
- **Bringing the 613 KB shared bundle down to target.** The parallel wave handles
  the certain part and measures the rest.
- **Virtualising large lists.**
- **A Web Worker for CSV parsing.**
- **Moving pages off `force-dynamic`.**
- **Converting the 309 hex literals in `globals.css` and
  `WorkAreaOverview.module.css`**, which wave 1 recorded rather than fixed.

### Expected scores after P1

| Axis | Now | After P1 (estimate) |
|---|---|---|
| UX | 7.0 | ~7.8 |
| Accessibility | 6.2 | ~8.0 |
| Performance | 6.3 | ~7.0 with the parallel wave (~6.6 without) |

Performance needs P2 to reach 8.0. These are estimates derived from the
architecture; they should be replaced with real numbers once
`npm run quality:runtime` has run a full cycle.
