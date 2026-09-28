# Financial statements, laid out as the prototype lays them out

- Date: 2026-09-28
- Status: Design, approved in conversation 2026-09-28 (parts 1 and 2)
- Scope: phase 0 (shared report kit) and phase 1 (the five statements) of the
  report redesign. Phases 2–5 — cash flow, ledgers and lists, customers and
  vendors, inventory/tax/analysis — each get their own spec.
- Source of requirements: `Accounting-System-v3.html`, the client's prototype:
  - the report page — `renderReports` (toolbar, actions, `.paper`), `PRESETS`,
    `COMPARE` (line 4010)
  - the statements — `reportPL` (1133), `reportBS` (4594, the definition that
    runs), `reportTB` (4712), `reportBudget` (10435)
  - columns — `plCols` (4020), `bsCols`; the account tree — `buildTreeN`,
    `renderTreeN`, `treeRows`
  - QuickZoom — `zoomBtn`, `drillDetail` (1552), `renderDrill`
  - styles — `.paper`, `.rpt-head`, `table.rpt`, `.r-section`, `.r-classhead`,
    `.r-total`, `.r-sub`, `.r-grand`, `.r-spacer`, `.ind0–3`, `.pct`, `.zoom`,
    `.rpt-foot` (lines 250–310)
- Direction from the client: make OneBook's reports look and work like the
  prototype's, keeping what OneBook does that the prototype does not.

## 1. The constraint: presentation only

This phase changes how the five statements are laid out and navigated. It
changes **no figure**. Every amount is still produced by the functions that
produce it today — `buildProfitAndLoss`, `buildBalanceSheet`,
`buildTrialBalance`, `buildBudgetVsActual`, `buildStatementOfEquity`,
`compareReportLines` in `lib/domain/reports.ts` — from the same reads
(`getLedgerBalancesAction`, `getBudgetVsActualAction`,
`getStatementOfEquityAction`). The new code arranges their results; it does not
recompute them.

That is proven, not promised (§8): a read-only script runs the old arrangement
and the new one over every company and several periods and compares every
figure to the cent.

**Out of scope, decided 2026-09-28:** the prototype's *Include: Cash movements
only* filter. It changes figures, so it is a module of its own. The toolbar
states "Accrual basis" and offers no basis choice.

## 2. The report page

Routes do not change: `/reports?report=pnl|balance|trial|budget|equity`,
served by `app/(app)/reports/page.tsx` and `ReportsClient.tsx`.

From top to bottom, following `renderReports`:

1. **Toolbar** (`components/reports/ReportToolbar.tsx`, new, shared):
   - **Report** select (the five statements) and the **Accountant /
     Management** toggle, as today.
   - **Period**: the prototype's presets (`PERIOD_PRESETS` in
     `lib/domain/report-presets.ts`: This month, This quarter, This year, Last 3
     years, Last 5 years, All dates, Custom).
   - **From / To** for a range statement (P&L, Budget vs Actual, Statement of
     Equity). **As of** for a point statement (Balance Sheet, Trial Balance);
     when a point statement is compared column by column it also shows
     **Columns from**, as `renderReports` does.
   - **Compare** (P&L, Balance Sheet, Trial Balance), the prototype's `COMPARE`
     list: No comparison · Previous period · Previous year · Column per year ·
     Column per quarter · Column per month.
   - **% of income** (P&L only), as today: on by default with no comparison or
     one comparison column, off by default for a column per period, and once
     the reader flips it their choice stands (`nextShowPercentOfIncome`).
   - **Run**.
   - Actions on the right: **Copy this report**, **CSV**, **PDF**, **Excel**,
     **Print**.
2. **Management view**: the charts OneBook shows today, above the paper,
   unchanged (`ReportBody`).
3. **The paper** (`ReportPaper`, existing): company, statement name, the range
   in words (`rangeText`) or "As of <date>", "Accrual basis · USD".
4. **The statement** (`StatementTable`, §3).
5. **Footer** (`ReportFoot`): the prototype's `footNote` — "**Every figure is a
   QuickZoom.** Click any amount to open the entries behind it, then click a
   line to open the full double entry." — without its cash-basis sentence.
6. **Empty state** inside the paper when the statement has no figures: "No
   entries fall in this period. Add entries on the Journal screen, or widen the
   date range." (the prototype's `emptyReport`).

### 2.1 Compare, mapped from what OneBook has

| Prototype | Range statement (P&L) | Point statement (BS, TB) | Replaces in OneBook |
|---|---|---|---|
| No comparison | one column | one column | "One period" |
| Previous period | the range of the same length ending the day before From | the last day of the month before As of | "Two periods"; "vs prior month end" |
| Previous year | the same dates one year earlier | the same day one year earlier | "vs same month last year" |
| Column per year | a column per fiscal year inside From–To, plus Total | a column per fiscal year end from Columns from to As of | "Last 3 years" |
| Column per quarter | a column per quarter inside From–To, plus Total | a column per quarter end | "By quarter" |
| Column per month | a column per month inside From–To, plus Total | a column per month end | "By month"; "Last 12 months" |

With Previous period or Previous year a statement shows its two columns and
**Change** (amount and %), from `compareReportLines`. Column per … is capped at
`MAX_TREND_COLUMNS` (24) with the message `trendColumnLimitMessage` already
gives. The OneBook bases "vs prior quarter end" and "vs prior year end" are
retired in favour of the prototype's list, as approved.

Column dates are computed by a pure function
(`lib/domain/statement-columns.ts`), reusing `previousPeriodRange`,
`monthlyColumns`, `quarterlyColumns`, `fiscalYearForDate` and
`report-periods.ts` helpers where they exist.

## 3. The statement table

`components/reports/StatementTable.tsx` (new): a plain HTML `<table>` styled
after the prototype's `table.rpt`, in `report-paper.module.css`. It is not a
list — nothing is sorted, filtered or paged — so it is not a `DataTable`, in the
same way the entry sheet's tables are not (`tests/unit/table-adoption.test.ts`
matches Ant Design's `<Table`, which this does not use).

It renders a **statement model** (`lib/domain/statement.ts`, new, pure):

```ts
type StatementRowKind = "section" | "classhead" | "account" | "subtotal" | "total" | "grand" | "spacer" | "note";

interface StatementCell {
  amount: number | null;          // minor units, base currency; null = blank
  zoom: ZoomSpec | null;          // what clicking the figure opens; null = not a link
}

interface StatementRow {
  key: string;
  kind: StatementRowKind;
  label: string;
  depth: 0 | 1 | 2 | 3;           // indentation, the prototype's .ind0–.ind3
  accountId: string | null;       // an account row's name opens its General Ledger
  cells: StatementCell[];         // one per column
  percent?: (number | null)[];    // % of income, per column, when shown
}

interface StatementColumn { key: string; label: string; sub: string } // sub = the column's dates in words

interface Statement {
  title: string;                  // "Profit and Loss", …
  range: string;                  // the paper's range line
  columns: StatementColumn[];
  change: boolean;                // two columns plus Change
  rows: StatementRow[];
  empty: boolean;
  outOfBalance: number | null;    // Trial Balance / Balance Sheet: the difference, when not zero
}
```

The look, per row kind (prototype class in brackets):

| Kind | Look |
|---|---|
| section (`r-section`) | small capitals, bold, space above, no figures |
| classhead (`r-classhead`) | a tinted band naming a group inside a section |
| account | the account's code and name, indented by depth; the name opens its General Ledger for the column's dates in a new tab |
| subtotal (`r-sub`) | thin rule above, semi-bold |
| total (`r-total`) | rule above, bold |
| grand (`r-grand`) | rule above, double rule below, bold, slightly larger |
| spacer (`r-spacer`) | 9 px gap |
| note | a muted full-width line, e.g. "No income in this period" |

Every figure in a cell with a `zoom` is a QuickZoom button (§5) — including
totals, as the prototype's `zoomBtn` wraps "Total Income". Negative figures are
shown in the danger colour. Column headers carry the column label and, under
it, its dates in small text (`sub`). All colours are theme tokens, so it reads
in light and dark.

### 3.1 The account tree

Accounts nest under their parent (`acc_account.parent_account_id`), as the
prototype's `buildTreeN` nests `Assets:Bank:…`. A parent with children renders
as: its own row (with its own balance, if any), its children one level deeper,
then **Total <parent>** as a subtotal. An account with no children renders as a
single row. Accounts whose parent is in another section, or absent from the
statement, render at the section's top level. Subtotals are for display: the
section total is still the builder's `total`, and a test asserts the leaf
figures sum to it. Aurora's chart has six child accounts; the other companies'
charts are flat and render exactly as before, row for row.

The page passes the parent map (`accountId → parentId`) from `listAccounts`,
which it can already read.

## 4. The five statements

Each builder is a pure function in `lib/domain/statement.ts` that takes the
existing builders' output (one per column) and returns a `Statement`.

**Profit and Loss** — `pnlStatement(pnls, columns, opts)`, following
`reportPL`: Income → **Total Income**; Cost of Goods Sold → **Total Cost of
Goods Sold**; **Gross Profit**; Expenses → **Total Expenses**; **Net Operating
Income**; Other Income, Other Expenses → **Net Other Income**; **Net Income**
(grand). A section with nothing in it shows its note ("No income in this
period"). Cost of goods sold and the other-income block are omitted when empty,
as the prototype does. "Operating Expenses" keeps OneBook's name.

**Balance Sheet** — `balanceSheetStatement(sheets, columns, opts)`, following
`reportBS`:
- **Assets**: classheads Cash and Bank (`bank`), Accounts Receivable
  (`accounts_receivable`, shown only when present), Other Current Assets
  (`current_asset`), Long-term Assets (`fixed_asset`), each with its
  subtotal; **Total Assets** (grand).
- **Liabilities**: Current Liabilities (`accounts_payable`, `credit_card`,
  `current_liability`) with its subtotal; **Total Liabilities** (total).
  OneBook has no long-term liability type, so there is no long-term block.
- **Equity**: the equity accounts; **Retained earnings — prior years** and
  **Net income — this year**; **Total Equity** (total); **Total Liabilities and
  Equity** (grand).
- The split of equity is presentation of one existing figure.
  `buildBalanceSheet` carries all accumulated profit on one "Current earnings"
  line. The new layout splits it into the profit up to the day before the
  fiscal year containing As of (`netIncomeOf` over `acc_ledger_balances(null,
  fyStart − 1)`, one extra read per column) and the remainder. A test asserts
  the two lines sum to "Current earnings" exactly; the parity script checks it
  on every company.
- If assets do not equal liabilities plus equity, a note says by how much, as
  the prototype's statements do.

The balance-sheet line types need each line's account type, which
`ReportSection` lines do not carry. The builder therefore looks each line's
type up in the chart the page already passes for the tree, groups lines by
type, and is tested to reproduce the builder's section totals exactly.

**Trial Balance** — `trialBalanceStatement(tbs, columns)`, following
`reportTB`: accounts ordered by account type then code; for each column a Debit
and a Credit cell; **Total** (grand); if debits and credits differ, a note
"Debits and credits differ by <amount>".

**Budget vs Actual** — `budgetStatement(bva)`, following `reportBudget`:
columns Actual · Budget · Variance · % (OneBook's order, so the variance reads
as the first column less the second, as every change column does); the P&L's
sections and totals; a
favourable variance in the success colour and an unfavourable one in the danger
colour, favourable meaning above budget for income and below budget for costs.
The budget editor drawer stays where it is.

**Statement of Equity** — `equityStatement(soe)`: the prototype has no such
report; it takes the same paper and table: Opening equity → the activity lines
→ Net income → **Closing equity** (grand).

## 5. QuickZoom

Every figure with a `zoom` opens a side sheet, as the prototype's
`drillDetail` does.

```ts
interface ZoomSpec {
  title: string;            // "Total Income", "400 Sales", …
  accountIds: string[];     // one for an account row, several for a total
  from: string | null;      // null for a point statement: all history up to `to`
  to: string;
  figure: number;           // the amount that was clicked, minor units
}
```

- **The sheet** (`components/reports/ZoomSheet.tsx`, new): heading = the
  title and the dates in words; a list of every posted line on those accounts
  in those dates: Date · Type (source tag and number) · Name (party, else
  description) · Account (for a total) or the other side (for one account) ·
  Amount; and, for a single account, a running **Balance** that starts from the
  account's balance on the day before From. Paged in the sheet (the list can
  be thousands of lines on a large book).
- **It totals to the figure that opened it.** Amounts are shown with the
  statement's sign — the prototype's `dsign` — so the column sums to `figure`;
  a unit test asserts it, and the sheet shows a warning if a read returns lines
  that do not (which would mean the book changed between the two reads).
- **Clicking a line opens the Transaction detail sheet** (`EntryDetailDrawer`)
  on top; breadcrumbs walk back.
- **Reading it**: `lib/services/zoom.ts` (new) reads `acc_journal_line` joined
  to posted entries in the range for the account ids, paged past 1,000 rows,
  ordered by date and entry number; names come from `acc_transaction_list` for
  the same range (`entryDisplayName`). The opening balance for a single
  account comes from `acc_ledger_balances(null, from − 1)`. Every call reads;
  the server action `zoomAction(spec)` validates the ids and dates.
- A pure function (`lib/domain/zoom.ts`) applies the sign, the running balance
  and the total check, so they are unit-tested with concrete figures.

## 6. Actions

All five come from one `ReportExportSheet`, built from the `Statement`
(`statementSheet(statement, meta)` in `lib/domain/statement.ts`), so what is
exported is what is on screen:

- **PDF**, **Excel**: `ReportExportButtons`, as today.
- **CSV**: `csvFromExportSheet`, as the Exception Report does.
- **Copy this report**: the same rows as tab-separated text on the clipboard,
  so a paste into a spreadsheet keeps its columns.
- **Print**: the browser's print, with a print stylesheet that shows the paper
  alone — no navigation, toolbar or floating buttons.

## 7. Architecture

| File | Responsibility |
|---|---|
| `lib/domain/statement.ts` | The statement model; the five builders; the account tree; `statementSheet`. Pure. |
| `lib/domain/statement-columns.ts` | Compare → column dates, for range and point statements. Pure. |
| `lib/domain/zoom.ts` | Sign, running balance and total check for a zoom list. Pure. |
| `lib/services/zoom.ts` | The zoom reads, paged. |
| `components/reports/ReportToolbar.tsx` | Period, dates, Compare, % of income, Run, actions. |
| `components/reports/StatementTable.tsx` | Renders a `Statement`. |
| `components/reports/ZoomSheet.tsx` | The QuickZoom sheet, opening `EntryDetailDrawer`. |
| `components/reports/report-paper.module.css` | The `table.rpt` look, print rules. |
| `app/(app)/reports/ReportsClient.tsx` | Rewritten around the above: state, reads per column, the Management charts. |
| `app/(app)/reports/actions.ts` | `zoomAction`; the existing reads unchanged. |
| `app/(app)/reports/page.tsx` | Also passes the account parent map. |
| `components/reports/PnlTrendView.tsx`, `BalanceSheetTrendView.tsx`, `BudgetVsActualView.tsx`, `StatementOfEquityView.tsx` | Their tables are replaced by `StatementTable`. Three of them also draw charts (all but `BudgetVsActualView`); those charts are kept and shown in the Management view, and only the table code is removed. |
| `tests/live/statement-parity.live.ts`, `vitest.live.config.ts` | The read-only parity run of §8. |
| `lib/domain/changelog.ts` | Release 1.66. |

## 8. Proving it

1. **Unit tests, concrete figures** — each builder: section and grand totals
   equal the existing builder's totals; the tree's leaf figures sum to the
   section total; the equity split sums to "Current earnings"; the Trial
   Balance totals equal `buildTrialBalance`'s; the P&L % column matches
   `percentOfIncome`; compare columns and Change match `compareReportLines`.
   `statement-columns`: every Compare option for range and point statements,
   including month ends, leap years and a fiscal year starting in July.
   `zoom`: the list sums to the figure for a debit-natured and a
   credit-natured account, and the running balance starts from the opening.
   Purity guards on the three domain modules.
2. **Parity, on the real books, read-only** —
   `tests/live/statement-parity.live.ts`, run with its own config
   (`vitest.live.config.ts`, `--pool=threads`) and never by `npm test`. It signs
   in as the smoke user through `smokeSession()` (`scripts/smoke-environment.mjs`)
   and calls the services directly, so it writes nothing and records no audit
   row. For every company the user belongs to, for This year, Last 3 years, All
   dates and each Compare option, it builds each statement the old way (the
   existing builders' outputs) and the new way (the `Statement` rows) and
   compares every figure. One cent of difference fails it. (The e2e suites'
   `openE2eSession` refuses the live project by design, so it cannot be used
   here; this is the pattern the Beancount acceptance run used, kept in the
   repository so phases 2–5 reuse it.)
3. **Screenshots** of all five statements, light and dark, on the largest live company and Aurora
   (Aurora for the account tree), with a zoom open and the Transaction detail
   on top, set beside the prototype's statements — reviewed, then shown to the
   client before anything is pushed.
4. Build, typecheck, lint, the full unit suite, the page smoke sweep, and a
   table-fit measurement taken after the report has loaded.

## 9. Out of scope

- The *Cash movements only* filter (a module of its own).
- The other reports (phases 2–5).
- The prototype's "Save all 33 reports" and "Print view: all reports".
- Changing any calculation, account type or route.
