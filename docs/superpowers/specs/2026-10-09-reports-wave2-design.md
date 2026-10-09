# Reports, wave 2a: five reports from the mockup

Date: 2026-10-09 · Branch: `feat/reports-wave2` (from main b2e40eb) · Release number: the next free number when it merges (1.95 if nothing else merges first).

## Why

The client's mockup, `Accounting System-v4.html`, has 34 reports. Wave 1 (1.94) brought OneBook to 26 of them. The wave 1 spec left six for wave 2:
- Financial Ratios;
- Purchases and Inventory;
- Sales Tax Liability as a period table;
- Stock Count;
- bringing the 13 Week Cash Forecast and Budget vs Actual in line with the mockup.

Stock Count needs new tables and posts entries, so it ships on its own, next. This release, wave 2a, holds the other five.

The mockup embeds a real client's books. Only its structure is used here; tests and screenshots use invented data or the sample company PC-Test.

## Decisions (agreed with the user, 09/10)

1. **Two releases.**
   - This one, 2a: Financial Ratios, Purchases and Inventory, Sales Tax Liability, the 13 Week Cash Forecast upgrade, and the Budget vs Actual upgrade.
   - Stock Count is the next release.
2. **No migration.** The only write in this release is budget figures, through the existing `acc_save_budget_month`. Nothing is posted to the books.
3. **Approach B, a hybrid.**
   - The three new reports each get their own page under `/reports/<slug>`, on the `SimpleReport` frame from wave 1, with a pure calculation module and unit tests.
   - The Cash Flow Forecast is upgraded on its existing page and keeps its chart.
   - Budget vs Actual is upgraded where it runs today, inside `ReportsClient` (`?report=budget`).
4. **Budget vs Actual keeps OneBook's period selection:** a fiscal year, then a from-month and a to-month. On top of that it gains a % of Budget column, a month-by-month table, and a full-year budget grid.
5. **The forecast takes the mockup's layout and starts from the cash on hand.** A switch, "By due date" (the default) or "As they usually pay", keeps OneBook's lag-adjusted timing.
6. **Names are the mockup's.**

## Common to all five

- Money is in the company's base currency, and dates are in the company's time zone.
- Every list read pages past PostgREST's 1,000-row cap, with a total order.
- **Who can see them.** As in wave 1, every company member can open each report. Two actions are gated:
  - "Record a payment" on Sales Tax Liability: writers only (`canWrite`).
  - Editing a budget: `budget.manage`.
- **Proof lines.** Where a report states what its total ties to, it does so under the total, as in wave 1. When the two sides disagree, it shows a warning with the difference rather than hiding it.

## Financial Ratios

`/reports/financial-ratios`, in the Analysis group. RPT_CARD line: "Liquidity, leverage and margin, worked out from the statements."

- **Period.** A From–To range with the usual presets. A "A year earlier" column always shows the same From–To shifted back one year, with the end clamped to the end of the month. The column is left blank when that earlier period has neither assets nor income.
- **Main table.** Columns: Ratio (its name, with a one-line meaning under it), This period, A year earlier, and an arrow column. The rows sit in four groups, in this order:
  1. "Can it pay its bills"
  2. "Does it make money"
  3. "How fast money moves"
  4. "How much is borrowed"
- **The arrow.**
  - "steady" (grey) when the change is under the larger of 0.005 and 1% of the earlier value.
  - Otherwise ▲ or ▼ with "better" (green) or "worse" (red), judged by the ratio's direction.
  - The neutral ratio shows "longer" or "shorter" in grey.
  - The cell is empty when either side is blank.
- **Workings table, "The figures behind them".** Cash and bank, Receivables, Inventory, Current assets, Total assets, Current liabilities, Total liabilities, Accounts payable, Equity including profit to date, Income, Cost of goods sold, Running costs, Operating income, Net income, Interest, and Days in the period.
- **Inputs, by OneBook account type rather than the mockup's name matching.**
  - Balance figures are cumulative to the To date: `getLedgerBalances(null, to)` and `buildBalanceSheet`.
    - Cash: `bank` accounts.
    - Receivables: `accounts_receivable`.
    - Current assets: `bank` + `accounts_receivable` + `current_asset`.
    - Inventory: accounts used as an item's inventory account, or with `cash_flow_role = 'operating_inventory'`; else `current_asset` accounts named "Inventory" or "Stock".
    - Total assets: every asset type.
    - Current liabilities: `accounts_payable` + `credit_card` + `current_liability`.
    - Total liabilities: these plus `long_term_liability`.
    - Accounts payable: `accounts_payable`.
    - Equity: total equity including current earnings, as the Balance Sheet shows it.
  - Flow figures are over From–To: `buildProfitAndLoss`.
    - Income is `income` only.
    - Cost of goods sold: `cost_of_goods_sold`.
    - Running costs: `expense`.
    - Operating income: gross profit − running costs.
    - Net income: after other income and other expenses.
    - Interest: `expense` and `other_expense` accounts with "Interest" in the name.
    - Days: From to To inclusive, at least 1.
- **The fifteen ratios.** Each takes the mockup's name, formula, format and direction. Blank means nothing to divide by.

  | Ratio | Formula | Format | Better |
  |---|---|---|---|
  | Current ratio | current assets ÷ current liabilities | 0.00 | higher |
  | Quick ratio | (cash + receivables) ÷ current liabilities | 0.00 | higher |
  | Working capital | current assets − current liabilities | money | higher |
  | Months of cash | cash ÷ (spend ÷ (days ÷ 30.44)), where spend = cost of goods sold + running costs + other expenses | x.x months | higher |
  | Gross margin | gross profit ÷ income | % | higher |
  | Operating margin | operating income ÷ income | % | higher |
  | Net margin | net income ÷ income | % | higher |
  | Return on assets, a year | (net income × 365 ÷ days) ÷ total assets | % | higher |
  | Return on equity, a year | (net income × 365 ÷ days) ÷ equity; blank when equity ≤ 0 | % | higher |
  | Days to get paid | receivables ÷ (income ÷ days) | N days | lower |
  | Days to pay suppliers | accounts payable ÷ ((cost of goods sold + running costs) ÷ days) | N days | neutral |
  | Days of stock | inventory ÷ (cost of goods sold ÷ days) | N days | lower |
  | Debt to equity | total liabilities ÷ equity; blank when equity ≤ 0 | 0.00 | lower |
  | Debt ratio | total liabilities ÷ total assets | % | lower |
  | Interest cover | operating income ÷ interest; blank when there is no interest | 0.00 | higher |

- **Proof.** None is stated as a tie-out. The workings table lets each ratio be traced back to the statements.
- **Footnote.**
  - Balances are taken at the To date, and income and costs over the period.
  - Current and long-term follow the account type, as on the Balance Sheet.
  - Treat it as a first read, not a covenant test.
  - A dash means nothing to divide by.
- **Dashboard unchanged.** The dashboard's own margins are left as they are in this release: its net margin divides by income plus other income, and changing it would move a figure people already read.

## Purchases and Inventory

`/reports/purchases-inventory`, in the Inventory & Tax group. RPT_CARD line: "What was bought over the period and what is still in stock."

- **Period.** A From–To range.
- **Stat row.**
  - Bought in this period.
  - Purchases: the number of posting lines.
  - Suppliers.
  - On the shelf at the To date.
- **"Year by year" table.** One row per fiscal year that has entries, with columns Year, Opening stock, Bought net of returns, Count adjustment, Cost of sales, Closing stock. A red "off by" tag sits beside Closing stock in any year where opening + bought − cost of sales ≠ closing.
- **"Who it was bought from" table.**
  - Columns: Supplier, Purchases (document count), Amount, Share.
  - Rows are sorted by amount, largest first, and end in a Total row.
  - The supplier is taken from the source document (bill, expense, vendor credit, bill payment, goods receipt), as Expenses by Vendor does. Lines with no such document go to "(No vendor)".
- **"Month by month" table.** Columns: Month, Bought, Share. It is shown only when there are purchases.
- **Definitions, following the mockup and read from the ledger.**
  - **Inventory accounts:** the same rule as Financial Ratios.
  - **Purchase line:** a posting to a `cost_of_goods_sold` account or an inventory account, in an entry that is neither an opening balance (`source = 'opening_balance'`) nor a count or adjustment. A count or adjustment entry is one with `source = 'inventory_adjustment'`, or one touching an inventory-adjustment or write-down account.
    - Credits count, so returns reduce the total.
    - In a perpetual book, a sale's cost-of-sales and inventory lines sit in one entry and cancel out. One definition therefore serves both a perpetual book and a periodic one.
  - **Per fiscal year:**
    - Opening stock = the inventory balance the day before the year starts, plus inventory brought in by opening-balance entries during the year.
    - Count adjustment = the net movement from count and adjustment entries.
    - Cost of sales = the net movement on `cost_of_goods_sold` accounts.
    - Closing stock = the inventory balance at the end of the year.
- **Proof.** The year-by-year identity. The footnote reads either "That holds in every year shown." or "One year is off by …", usually stock bought or written off through neither account.
- **Empty states.**
  - No purchases ever: "Nothing has been bought in these books yet." with "Anything coded to cost of sales or straight to inventory shows up here."
  - The supplier table with no rows: "Nothing bought in this period."

## Sales Tax Liability

`/reports/sales-tax-liability`, in the Inventory & Tax group. The Sales Tax Center's Liability tab links to it. RPT_CARD line: "Sales tax charged and paid, period by period."

- **Period.** A From–To range, plus a Monthly / Quarterly (default) / Yearly switch. Years are fiscal years, labelled "FY2026" when the fiscal year does not start in January and "2026" when it does. The first and last periods are clipped to the range.
- **Stat row.**
  - Collected.
  - Paid over.
  - "Owed at <last period end>", in the warning style when it is not zero.
  - Effective rate: collected ÷ taxable over the whole range.
- **Period table.**
  - Columns: Period, Gross sales, Taxable, Exempt, Rate, Tax collected, Paid over, Owed at period end.
  - An "Owed before this range" row opens the table, shown only when it is not zero.
  - A Total row closes it, with the Rate cell blank in that row. Owed at period end is a running balance.
- **Read from the ledger, not from invoices.** Imported books have no invoices, and the ledger also catches credit memos.
  - **Tax accounts:** the accounts that sales-direction tax codes post to (`acc_tax_code.tax_account_id`). If a company has none, use liability accounts whose name, letters only, reads "salestax" or "tax…payable", as the mockup does.
  - **Classifying each posted entry in the period:**
    - Tax = its lines on the tax accounts, credit-positive. Income = its lines on `income` accounts, credit-positive.
    - With income and tax: Taxable += income, Collected += tax.
    - With income and no tax: Exempt += income.
    - With no income, a debit to the tax account is Paid over; a credit is an adjustment, added to what is owed.
    - Gross = taxable + exempt. Rate = collected ÷ taxable, the rate actually charged.
  - **Owed at period end** = the previous figure + collected − paid over + adjustments. The opening figure is the tax accounts' balance the day before the first period.
- **Proof.** The closing figure owed is compared with the tax accounts' own ledger balance on that date.
- **"Record a payment of <amount>".** The button is shown to writers when something is owed. It opens the Sales Tax Center's existing Record payment dialog, pre-filled with the amount and the range. That posts through `acc_record_tax_payment`. When nothing is owed, the report shows "Nothing outstanding." in place of the button.
- **Footnote.** "Read from the entries, not from a rate table":
  - a sale is taxable when its entry carries a line to the tax account;
  - the Exempt column is where a missing tax line would show;
  - the rate shown is the rate actually charged.
- **Empty state.** No tax account: "No sales tax account in this chart." with "Set up a sales tax rate under Sales Tax, and what you charge lands here."

## 13 Week Cash Forecast (upgrade of the Cash Flow Forecast)

The page stays at `/reports/cash-flow-forecast`. The heading becomes "13 Week Cash Forecast", and the catalog card follows.

- **Weeks.** Thirteen seven-day blocks starting on the company's today, as the mockup does. The first is "This week", the rest "w/c <date>", each with its date range beneath.
- **Opening cash.** The ledger balance, to today, of all `bank` accounts. The alert that said the figures were not a bank balance goes.
- **Stat row.**
  - Cash today.
  - Due in.
  - Due out.
  - In 13 weeks, in the warning style when below zero.
  - Lowest point, with its week, shown only when the running balance dips below the opening cash.
- **Overdue note.** When anything is overdue: "Already past due and counted in week one", with the receivable and payable amounts. This makes week one the optimistic case.
- **Week table.**
  - Columns: Week, From customers, To suppliers, Recurring (with the template names under it, cut to 40 characters), Net, Cash at week end.
  - A week whose running cash is below zero is highlighted.
  - A total row, "Over 13 weeks", closes the table.
- **The switch.** "By due date" (the default) or "As they usually pay".
  - **By due date:** open invoices and bills fall into weeks by due date, or by document date when there is no due date.
  - **As they usually pay:** OneBook's median days late, learned from the last 365 days, shifts that date.
  - Either way, everything overdue lands in week one, and items beyond the horizon are summed in a line under the table rather than counted.
- **Recurring.** Active templates only, with occurrences from `next_run_date` forward by frequency and interval, up to `end_date`.
  - Invoice templates: money in, on the run date plus the template's due days.
  - Bill templates: money out, the same way.
  - Expense templates paid from a `bank` account: money out on the run date. Those paid by card leave cash only when the card is paid, so they are not counted.
  - Journal templates: their lines on `bank` accounts.
  - Amounts are put into base currency at today's rate.
  - Because occurrences start at `next_run_date`, a run that has already happened is never counted twice. Its document, once issued, is an open item.
- **Chart.** It is kept and plots cash at week end, with money in and money out per week.
- **Footnote.**
  - "Only what is already committed": issued invoices, received bills and recurring templates.
  - Then either "Cash stays positive throughout." or "Cash goes below zero in the week beginning <date>, at <amount>".
- **Fixed in passing.** The page used a UTC date; it now uses the company's today.

## Budget vs Actual (upgrade)

It stays at `?report=budget` in `ReportsClient`, with its fiscal year and its from-month and to-month.

- **Columns.** Actual, Budget, Over / Under, % of Budget.
  - % of Budget = actual ÷ budget × 100, to one decimal place.
  - A line with no budget shows "—" in Budget, Over / Under and %, rather than its whole actual as a variance.
- **Sections.** OneBook keeps its five: Income, Cost of Goods Sold, Operating Expenses, Other Income, Other Expenses, then Net Income. The mockup has three, but these books carry other income and other expenses.
- **Month by month.** Shown when the range covers two months or more. Columns: Month, Actual result, Budgeted result, Over / Under. A result is income less expenses for that month.
- **Full-year budget grid.** It replaces the one-month drawer, behind the same "Manage budget" button and the same `budget.manage`.
  - One row per posting income or expense account, with twelve month cells and a Year cell. Typing a Year figure spreads it evenly over the twelve months, with the rounding remainder in the first month.
  - "Start from last year's actuals" and "Start from this year's actuals" each take an uplift %. They fill the grid only; nothing is saved until Save.
  - "Clear this year" asks for confirmation first.
  - An "Add an account" picker lists accounts with nothing budgeted yet.
  - A summary line reads: planned income, planned spending, planned result.
  - **Save** sends each changed month through `acc_save_budget_month`, one month at a time, in order.
    - If one fails, saving stops, and the message names the months saved and the months not saved.
    - Each call replaces its whole month, so pressing Save again is safe.
- Amounts stay as OneBook stores them: positive for both income and spending.

## Not in this release

- **Stock Count.** It is the next release. It needs count tables, a posting function, and the user's choice between a periodic count (one value-based entry, as in the mockup) and a perpetual one (per-item quantities).
- The dashboard's ratio and margin cards.
- The mockup's per-year CSV buttons on Purchases and Inventory. The toolbar's CSV exports the report.
- The mockup's "Past budget this month" alert.
- An as-of date on the forecast. A forecast always starts today.
- Sales tax by agency, and filing records. The Sales Tax Center keeps its by-state tables.
- **Mockup quirks not copied:**
  - sales tax period rows that look clickable but do nothing;
  - "Clear this year" with no confirmation.

## Pre-build check (before the plan)

As in wave 1, the riskiest parts are built on a local branch and run read-only against all six companies before the plan is written:
- Purchases and Inventory: the year-by-year identity in every company, the inventory-account rule, and the purchase-line exclusions.
- Sales Tax Liability: the closing owed against the tax-account balance, and the fallback for books without tax codes.
- Financial Ratios: the workings against the Balance Sheet and Profit and Loss.
- The forecast: opening cash against the bank accounts' balances, and the recurring occurrences against the templates.

Where the data disagrees with this spec, the spec gets an amendment section, as wave 1's did, before the plan is written.

## Testing

- **Unit tests.**
  - Each calculation is a pure module with unit tests: the ratios and arrows, purchases by year and the identity, sales tax periods and classification, forecast weeks with recurring items and the switch, budget spread and seeding, and month-by-month.
  - The budget grid's save sequence is tested against a stubbed save, including a failure in the middle.
- **Live check.** A read-only test against all six companies checks every proof line.
- **Smoke.** On PC-Test: each page runs, prints every row, and logs no console errors. Saving a budget is tried on PC-Test only.

## Changelog and Guide

- **Changelog.** One release, numbered at merge time in merge order. It names the five in the words the screen uses. It says plainly that the forecast now starts from cash on hand, so its running figure will differ from before.
- **Guide.** One step for each new report group. The budget flow's steps change to describe the full-year grid.

## Amendments from the data probe (09/10)

Before any code was written, the rules above were run read-only against all six companies' ledgers. These points changed.

1. **Opening entries are recognised three ways, not one.**
   - OneBook's own Opening Balances screen marks its entry `source_type = 'opening_balance'`. Imported books instead post their opening entry as `manual`:
     - two of them describe it "Opening balances…";
     - one, imported from Wave, describes it differently.
   - So an entry counts as stock **brought in**, not bought, when any one of these holds:
     - it is marked `opening_balance`;
     - its description begins "Opening balance";
     - it has a line on an `equity` account. A purchase never touches equity.
   - With this rule, no book shows its opening stock as a purchase.
2. **The year table adds up left to right.**
   - Opening stock + Bought + Count adjustment − Cost of sales = Closing stock.
   - Count adjustment is the inventory side of count and adjustment entries, positive when it adds stock. Cost of sales leaves those entries out.
   - The arithmetic is the mockup's (its cost of sales includes the adjustment). The columns now read as a sum.
   - The identity held, off by 0.00, in every year of every company. One imported book has count adjustments in two years.
3. **"Purchases" in the stat row counts entries, not posting lines.** In a perpetual book a sale touches both cost of sales and inventory and nets to zero, so only entries whose purchase lines do not net to zero are counted.
4. **Count and adjustment entries** are those with `source_type = 'inventory_adjustment'`, or with a line on an account named for an inventory adjustment or write-down. Every book has such accounts, typed `cost_of_goods_sold`.
5. **Inventory accounts.** The item-or-role rule finds the inventory accounts in every company: "1200 Inventory" in all of them, plus a second account in one imported book. The name fallback stays, but no current book needs it.
6. **Sales tax.**
   - Every company has sales tax codes, all posting to one Sales Tax Payable account, so the name fallback stays unused.
   - The closing-owed proof holds by construction, because every line on the tax accounts is classified.
   - To give the proof teeth, the report warns when another liability account reads as sales tax but no tax rate posts to it.
7. **Recurring templates.**
   - Only the demo company has any, and they are behind: their next run date has passed.
   - As in the mockup, occurrences before today are not counted.
   - A note under the table says how many templates are behind, so a missing payment is not silent.
8. **Ratios.** No probe was needed. The workings come from the same builders as the Balance Sheet and the Profit and Loss, and the live test asserts that they match.
