# Lists that fit the screen

- Date: 2026-08-24
- Status: Approved design, ready for planning
- Trigger: feedback `a9c5b84b` (schema `co_pc_49`, `/banking`, filed 2026-08-22, still `new`)
- Scope: every table in the application — 38 of them — of which 15 need column work

## 1. What was reported

> "There are so many gaps in the columns, it looks very bad. It should be
> narrower, more effective, and all viewing pages or listings. In viewing in
> listing format, it should not be scrolling from left to right, only from top
> to bottom."

This is the fourth arrival of one complaint:

| Filed | Screen | Words | Then marked |
|---|---|---|---|
| 2026-08-01 | `/customers` | "i need this table to see in glance. rather than moving horizontally" | resolved |
| 2026-08-13 | `/reports/general-ledger` | "i already zoom out but still can see the amounts" | resolved |
| 2026-08-15 | `/banking` | "column can't drag left or right to easily view the transaction amount" | new |
| 2026-08-22 | `/banking` | the words above | new |

Each previous round was answered on the screen that was reported. The August
answer went further and gave the reader the spreadsheet gesture they asked for
— drag a heading edge to resize (RQ-01-REV). They came back with the same
sentence anyway, and the reason is in it: they do not want a gesture that
recovers a hidden column, they want the columns visible when the page opens.

## 2. What the screenshot shows

The report carries a 1470x801 screenshot of `/banking`. Read against the code
in `app/(app)/banking/BankTransactionsTable.tsx`:

| Column | Width | What every row actually held |
|---|---|---|
| Account source | 200 | "Bank Of America - 121" — identical on all 25 rows, and already the value chosen in the filter bar above |
| Reference | 135 | an em dash on all 25 rows |
| Description | 320 | truncated mid-word, with 335px of repetition immediately to its right |
| Category | 190 | truncated, reading "500 — Cost of G(" |
| Match, Status | 430 | off-screen; reachable only by scrolling sideways |

Both halves of the complaint are therefore one fault. The gaps are columns
spending width on nothing, and the horizontal scroll is where those columns
push the useful ones.

## 3. The measurements that constrain the design

- `Sider` is 248px (`components/AppShell.tsx`).
- `.app-shell__content` has `margin: 24px` (`app/globals.css`).
- The table box is therefore **viewport minus 296px**: **1174px at 1470**,
  **1070px at 1366**, **984px at 1280**.
- `/banking` declares 1530px of columns plus two 56px pinned actions plus the
  selection checkbox: **about 1674px**. At 1470 the deficit is **500px**.

The floor this design commits to is **no horizontal scrolling at viewport 1280
and above** (table box 984px). Below that — tablet portrait and phones — a
table may scroll inside its own box; section 9 states that as out of scope.

## 4. The rule

Every table splits its columns in two.

**Measured columns** carry values of known length — a date, an amount, a
quantity, a status, an icon button. They take a fixed pixel width from one
shared token set, never a hand-picked number.

**Elastic columns** carry text somebody typed — a description, a name, a memo.
They take **no width at all**, absorb whatever room is left, and cut what does
not fit with an ellipsis plus a tooltip. Each table has one or two.

Because the elastic columns have no width, `table-layout: fixed` makes the
total exactly the box width. No DOM measurement, no `ResizeObserver`, no
first-paint flash, and the table reflows for free when the sidebar collapses.

**Whatever does not fit moves to the second line** of the elastic cell — a 12px
muted line under the primary text. Nothing is deleted, only re-seated.
`/banking` already reads this way ("File upload" under the description,
"JE-007813" under the category), so this is the application's own idiom rather
than a new invention.

The constraint every screen must satisfy:

    sum(measured widths) + sum(elastic minimums) <= 984

If a screen cannot meet it, more columns move to the second line until it can.

## 5. Width tokens

New module `lib/design/table-metrics.ts` — plain numbers, no imports, so a unit
test asserts against it directly:

| Token | px | For |
|---|---|---|
| `DATE` | 88 | a date such as 2026-07-13 |
| `MONEY` | 116 | an amount such as -327,089.13 with tabular figures |
| `MONEY_WIDE` | 124 | running balances |
| `CODE` | 110 | document numbers, prefixes |
| `STATUS` | 104 | one tag |
| `QTY` | 88 | counts and percentages |
| `PICKER` | 150 | a select rendered inside a cell |
| `ACTION` | 40 | one icon button; a group of three is 120 |
| `TEXT_MIN` | 200 | floor for a primary elastic column |
| `RICH_MIN` | 240 | floor for an elastic cell holding controls, such as Match |

The existing builders in `components/ui/columns.tsx` (`moneyColumn`,
`dateColumn`, `statusColumn`) take these as their default width, so a screen
that spreads a builder is correct without saying anything. Two builders join
them: `flexColumn` (elastic, ellipsis, tooltip) and `secondaryLine` (the 12px
muted line, one line, ellipsis).

## 6. Infrastructure

### 6.1 components/ui/DataTable.tsx

- Drop the `scroll={{ x: "max-content" }}` default. That single line is why all
  38 tables were permitted to outgrow their box.
- `tableLayout="fixed"` by default.
- New prop `fit`, default `true`. `fit={false}` restores the old behaviour and
  is reserved for tables that are genuinely a matrix — the permission grid, a
  twelve-month budget — and each use carries a comment naming which.
- Keep accepting `scroll` from callers for `y` only; a caller passing `x` under
  `fit` is a bug that the contract test in 8.2 fails on.

### 6.2 Zero-sum resize

The August gesture stays. Its arithmetic changes. Today `useColumnResize` sums
the widths and hands the total to `scroll.x`, so widening a column manufactures
horizontal scroll — precisely what the reader is complaining about.

Only measured columns have a width at all, so "the total stays the same" is not
expressible as a sum over the returned map — the elastic columns are the
remainder, and CSS computes them. The invariant is therefore stated against the
box:

New pure function in `lib/domain/column-width.ts`:

    resizeWithinBox(widths, key, delta, { box, chrome, elasticFloor }, mins) -> widths

`box` is the table's own width, measured once from the DOM at pointer-down (the
nearest `.ant-table` of the handle being dragged) — no `ResizeObserver`.
`chrome` is everything in the row that is not a resizable column: the pinned
action columns and the selection checkbox. `elasticFloor` is the sum of the
elastic columns' floors.

Invariants, each one a test:

1. After the call, `sum(returned widths) + chrome + elasticFloor <= box`
   whenever it held before it.
2. No returned width is below its own minimum (`mins`, already per-column on
   `main`), and never below `MIN_COLUMN_WIDTH`.
3. Narrowing is always allowed down to that minimum; the room goes back to the
   elastic columns, which is what makes the gesture zero-sum.
4. Widening stops at the point where the elastic columns would drop under their
   floors. The drag holds still instead of overflowing the box — a measured
   neighbour is never silently narrowed to pay for it.
5. A box too small to hold what is already declared never causes a widening,
   and never shrinks a column on its own.

An elastic column starts with no width, and therefore no width to store — but
it keeps its resize handle, because Description is the column the reader
reaches for. Dragging it gives it a pixel width like any measured column, and
the room comes out of the table's **last elastic column**, which is declared
per table and never takes a width of its own (`match` on `/banking`). That is
what keeps the row total pinned to the box no matter what the reader drags:
there is always exactly one column absorbing the remainder.

**The stored-widths trap.** Readers who already dragged their columns have
1530px of widths sitting in `localStorage` under
`onebook.bank-transactions.column-widths`. Merged on top of the new defaults,
those numbers put the horizontal scrollbar straight back for exactly the person
who complained. The storage key is therefore bumped to `...v2` and the old key
deleted on read. The general ledger's key gets the same treatment.

### 6.3 app/globals.css

- `.accounting-table--fit` gets `min-width: 960px` on the inner table and
  `overflow-x: auto` on its scroll container, so the sub-1280 case degrades to
  a contained scroll instead of a broken layout.
- `.accounting-table--exact-widths` (the `min-width: 0 !important` override
  added for RQ-01-REV) applies only under `fit={false}` now. Under `fit` the
  table is meant to fill its box, which is what that rule was fighting.

## 7. Per-screen column decisions

"2nd line" means the value moves to the second line of that table's elastic
cell. Every width below is a token from section 5.

### 7.1 /banking — the reported screen

| Column | Before | After |
|---|---|---|
| Date | 115 | `DATE` 88 |
| Description | 320 | **elastic**, floor `TEXT_MIN`; second line carries account source and reference |
| Account source | 200 | removed, to the 2nd line |
| Reference | 135 | removed, to the 2nd line |
| Amount | 140 | `MONEY` 116 |
| Category | 190 | `PICKER` 150 |
| Match | 300 | **elastic**, floor `RICH_MIN` 240 |
| Status | 130 | folded into the first line of Match — the filter bar already narrows by status, so a tag column repeated the filter |
| delete, attachments | 56 + 56 | `ACTION` 40 + 40 |

Measured total 434 plus selection 36 is 470; elastic floors are 440;
**910 <= 984**. At 1470 the two elastic columns share 704px instead of fighting
over 620px of repetition.

### 7.2 Business listings

| Screen | Elastic | Measured | To the 2nd line |
|---|---|---|---|
| `/invoices` | Customer | Number, Issue date, Total, Balance due, Status, Actions (3 icons) | Created, Journal entry, Paid, Age |
| `/bills` | Vendor | Bill Number, Date, Due, Total, Balance, Status, Actions | Vendor Reference, Journal entry |
| `/expenses` | Vendor | Expense Number, Date, Total, Status, Actions | none; tokens only |
| `/accounts` | Account name | Code, Type, Status, Actions | Detail, Cash flow, Normal, Statement |
| `/customers` | Customer | Credit limit, Owed now, Available, Credit status, Status, Actions | Location |
| `/items` | Name | Code, Sales price, Ledger cost, On hand, Inventory value, Status, Actions | Purchase cost, Used for |
| `/recurring` | Schedule | Frequency, Next occurrence, Amount, Status, Actions | Last result |
| `/fixed-assets` | Asset | In service, Cost, Accum. depreciation, Net book value, Status, Actions | Depreciation progress |
| `/pay-bills` | Vendor | Payment Number, Date, Amount, Unapplied, Status, Actions | none; tokens only |

### 7.3 Reports

| Screen | Elastic | Measured | To the 2nd line |
|---|---|---|---|
| `/reports/general-ledger` | Memo | Date, Entry, Debit, Credit, Running | Source |
| `/reports/transactions` | Description **and** Vendor/Customer name, both elastic (measured total is only 308, so two floors of 200 fit) | Date, Amount, Reconciled | Account Type, Bank or Credit Card |
| `/reports/gl-posting` | Name; Control account in the second table | Type, Document, Date, Status, Amount, Posting; Ledger account, Subledger, Ledger balance, Variance | Journal entry |
| `/reports/number-sequence` | Document type; Documented reason in the gaps table | Prefix, Issued, On file, Explained gaps, Unaccounted for, Next number | none |
| `/reports/cash-flow-forecast` | Customer / vendor in the detail table | seven weekly money columns; Side, Number, Due, Status, Balance | none; tokens only, since seven money columns fit at 116 |
| `/settings/feedback` | What happened | Filed, Kind, Urgency, Screenshot, Attachments, Move to | Where, Reporter |

The remaining 23 tables already fit their box and are not edited. They inherit
the `DataTable` change and are covered by the gate in 8.3.

## 8. Verification

Three gates, because this complaint has now survived three fixes.

### 8.1 Unit — the arithmetic

`lib/domain/column-width.test.ts` gains the four `resizeWithinBox` invariants from
6.2. A new `lib/design/table-metrics.test.ts` asserts every token is a positive
integer, and that the measured tokens `/banking` uses plus `TEXT_MIN` plus
`RICH_MIN` stay under 984 — so widening a token later fails here rather than on
a reader's screen.

### 8.2 Contract — the boundary

`tests/unit/table-fit-contract.test.ts` reads every file that renders
`DataTable` or `ReportTable` and fails on `x: "max-content"` or a numeric
`scroll.x`, except for an allow-list naming each matrix table and its reason.
This is what stops table number 39 from reintroducing the default.

The allow-list starts with these four candidates, each confirmed against its
own file before it is entered — a table that turns out to fit is reworked
instead of exempted:

- `app/(app)/settings/permissions/PermissionMatrixClient.tsx` — permissions by role, a genuine grid.
- `components/reports/BudgetVsActualView.tsx` — twelve months plus variance columns.
- `components/reports/PnlTrendView.tsx` and `BalanceSheetTrendView.tsx` — one column per period, count chosen by the reader.
- `app/(app)/reports/saved/SavedReportViewer.tsx` — columns come from a stored report definition, so they are unknown at build time.

### 8.3 Runtime — the screen itself

`scripts/verify-table-fit.mjs`, run as `npm run verify:table-fit`: signs in via
`scripts/smoke-environment.mjs`, walks every route from
`scripts/quality/routes.mjs`, and at viewports 1470x801 and 1280x800 asserts
for every `.accounting-data-table` on the page that
`scrollWidth <= clientWidth + 1`. It prints one PASS or FAIL line per table, so
the outcome is evidence rather than a claim.

## 9. Out of scope

- No column-chooser control. The reader asked for fewer gaps, not more knobs.
- No card layout for phones; below 1280 a table scrolls inside its own box.
- No change to how money, dates or statuses are formatted.
- The 23 already-fitting tables are not restyled.

## 10. Risks

| Risk | Answer |
|---|---|
| `fixed: "right"` needs `scroll.x` in Ant Design; without it the pinned action columns may lose stickiness or warn | Verified before the rework starts. With no horizontal scroll a sticky column has nothing to stick to, so under `fit` the `fixed` flag is dropped. |
| Stored widths from August put the scrollbar back | Storage keys bumped to `v2`, old key removed on read (6.2). |
| A cell holding a select or three buttons breaks below its floor | Per-column minimums already exist on `main` (`MIN_COLUMN_WIDTHS`); `RICH_MIN` 240 is the measured floor for Match. |
| Second lines make rows taller, so fewer rows fit vertically | Rows on `/banking` are already two lines. Elsewhere the second line renders only when it has content. |
| `--exact-widths` fights the new layout | Restricted to `fit={false}` (6.3). |

## 11. Acceptance

1. `/banking` at 1470x801 and at 1280x800: no horizontal scrollbar; Date,
   Description, Amount, Category and Match all visible without scrolling;
   account source and reference readable on the second line.
2. All 15 reworked tables: no horizontal scrollbar at both viewports.
3. `npm run verify:table-fit` green for every route at both viewports.
4. Dragging a column edge still resizes, and cannot produce a horizontal
   scrollbar at either viewport.
5. `npm test`, `npm run typecheck`, `npm run lint` green.
6. Feedback `a9c5b84b` moves out of `new` only after 1 through 5 hold.
