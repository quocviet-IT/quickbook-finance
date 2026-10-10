# Chart of Accounts with balances and drill-down (release 1.97)

## Why

The client likes the prototype's Chart of Accounts.
- **Prototype:** one grouped list where every account shows its balance, and clicking the balance opens the account's register with a running balance. Clicking an entry there shows the full double entry.
- **OneBook's `/accounts`:** a setup table only. It has ten separate tables with repeated headers and setup tags, no balances, and rows that do nothing when clicked.
- **What already exists:** OneBook has the drill-down engine: QuickZoom (`ZoomSheet`) and the entry detail drawer (`EntryDetailDrawer`). They are reachable today only from the financial statements.

This release does three things:
- gives the chart the prototype's look;
- adds balances;
- wires the click to the existing drill-down.

## Decisions (user, 10/10)

1. **One page, two modes:** Balances (the default) and Setup. Both share the grouped list, the filters and the search.
2. **Finer groups like the prototype**, assigned from typed account data. There are no related-party groups ("Owed to/by this company"), because no data marks them reliably and guessing from names is fragile.
3. **The balance shown depends on the account:**
   - Balance sheet accounts show their balance at the As of date.
   - Income, cost of sales and expense accounts show activity from the start of the fiscal year that contains the As of date, through that date.
   - The drill-down opens the same range, so its list adds up to the figure clicked.

## The screen

### Header and toolbar

- **Page title** "Chart of Accounts", with a lede such as "45 accounts, 28 carrying a balance at Oct 10, 2026."
- **Type pills with counts:** All · Assets · Liabilities · Equity · Income · Expenses. Income takes in other income, and Expenses takes in cost of sales and other expenses. The pill counts follow the search.
- **Search** on code or name. Matching sub-accounts keep their parents visible, as today.
- **As of** date picker. It defaults to the company's today, in its time zone. It is shown in Balances mode only.
- **Balances | Setup** switch. The mode lives in the URL (`?view=setup`), so a link opens the same mode. Balances is the default.
- **Classify and New account** stay as they are, shown to people who can write.

### One continuous list

The fourteen groups, in statement order:

| Section | Groups |
|---|---|
| Assets | Bank and cash; Receivables; Inventory; Other current assets; Long-term assets |
| Liabilities | Credit cards; Payables; Other current liabilities; Long-term liabilities |
| Equity | Equity |
| Profit and loss | Income; Cost of sales; Expenses; Other expenses |

**Group header row:**
- the group name in small upper case, with the account count on the right;
- it stays pinned while the page scrolls;
- profit and loss groups also name their range, e.g. "Year to date, from Jan 1, 2026";
- empty groups are hidden.

**Account rows in Balances mode:**
- a small colour dot for the account's class (asset, liability, equity, income, expense), the code, then the name;
- sub-accounts are indented under their parent with the existing mark, and contra accounts keep their "Contra" tag;
- currency, then the balance, right-aligned in tabular figures;
- a negative balance is in parentheses in the negative money colour. Zero is muted and not clickable;
- the whole row highlights on hover;
- colours come from OneBook's design tokens, with dark mode.

**Account rows in Setup mode:**
- the same rows and groups;
- the balance column is replaced by today's Type, Cash flow and Status columns;
- the edit and deactivate buttons appear for people who can write.

**Inactive accounts:**
- In Balances mode, they appear only while they carry a balance, with an "Inactive" tag.
- In Setup mode, all accounts appear, as today.

### Clicking an account

Clicking a non-zero balance, or the account name, opens the existing QuickZoom drawer for that one account:
- **Balance sheet accounts:** every posted entry from the start of the books through the As of date.
- **Profit and loss accounts:** from the fiscal year start through the As of date.
- **Drawer contents:** the stat row, rows with the counter-account and a running balance, and its check that the list adds up to the figure.
- **Clicking an entry** opens the existing entry detail drawer: the double entry, and links to the source document and the journal.

## Data and logic

There are no migrations.

### A new pure domain module for the chart

**Grouping.** The 14 group keys and titles, in order, and the group of an account:

| Account type | Group |
|---|---|
| `bank` | Bank and cash |
| `current_asset` in the inventory account set | Inventory |
| `current_asset` with a money-in-transit detail type | Bank and cash |
| other `current_asset` | Other current assets |
| `accounts_receivable` | Receivables |
| `fixed_asset` | Long-term assets |
| `credit_card` | Credit cards |
| `accounts_payable` | Payables |
| `current_liability` | Other current liabilities |
| `long_term_liability` | Long-term liabilities |
| `equity` | Equity |
| `income`, `other_income` | Income |
| `cost_of_goods_sold` | Cost of sales |
| `expense` | Expenses |
| `other_expense` | Other expenses |

- The inventory set is the same rule as releases 1.95 and 1.96: `pickInventoryAccounts` / `getInventoryAccounts`. The money-in-transit check uses `isBankSectionDetail`, as now.
- These groups replace today's ten `ACCOUNT_SECTIONS`, because both modes share them. `account-sections` keeps the tree, the code order, `withAncestors` and `parentChoices`; its test is updated to the new groups.
- A sub-account nests under its parent when both fall in the same group. Otherwise it stands at the top level of its own group.

**Natural balance.**
- Debit-normal accounts show debit less credit, and credit-normal accounts show credit less debit.
- The normal side is the account's own (`accountNormalBalance(type, isContra)`), so a contra account's normal balance is positive.
- A negative figure means the account is the wrong way round.
- Amounts are base-currency minor units.

**Range.**
- Balance sheet accounts use `from = null`, `to = As of`.
- Profit and loss accounts use `from = the first day of the fiscal year containing As of` (by the company's fiscal year start month), `to = As of`.

**Drill-down spec.**
- The `ZoomSpec` is `{ title, accountIds: [id], from, to, figure }`, with the range above and the figure as shown.
- QuickZoom's `zoomSign` already follows the figure's sign.

### Service

`getChartBalances(sb, asOf)` returns the natural balance per account id, together with the fiscal year start used.
- It makes two paged reads: `getLedgerBalances(sb, null, asOf)` for balance sheet accounts, and `getLedgerBalances(sb, fyStart, asOf)` for profit and loss accounts.
- It reads the fiscal year start month from company settings, and the inventory set from `getInventoryAccounts`.

### Page and action

- **Server page:** reads the accounts and the balances at the company's today.
- **Changing As of:** calls a read-only action, `chartBalancesAction(asOf)`.
  - Any signed-in role may call it, as with QuickZoom.
  - It validates the date.
  - It returns the balances and the fiscal year start.
- **Tables:** go through `DataTable` or `ReportTable`, never antd's `Table` directly. Columns fit the 1280 box, and there is no horizontal scroll.

## Verification

- **Unit tests:**
  - the group of every account type, including the inventory rule and money in transit;
  - the natural sign, including contra and wrong-way balances;
  - the fiscal year range, with a fiscal year that does not start in January;
  - the zoom spec;
  - the lede and pill counts;
  - column widths;
  - the existing table contracts (table adoption, table fit, server components).
- **Live test (read-only, all six companies):**
  - Every account's chart figure equals its ledger balance in the right range.
  - For every account with a balance, the QuickZoom list adds up to the chart figure.
  - Report counts and agree/disagree only.
- **Smoke and screenshots on the sample company PC-Test:**
  - Balances and Setup, light and dark.
  - The As of change, the pills and the search.
  - Clicking a balance sheet balance and a profit and loss balance, then an entry.
  - The drawer's figures add up.
  - An approval page goes to the user before pushing.

## Not in this release

- Editing opening balances inline. OneBook has its own Opening Balances page.
- Deleting accounts. Deactivate stays.
- Related-party groups.
- Exporting or printing the chart with balances.
- Cash-basis figures.

## Release

1.97, or the next free number when merging.
- **Changelog:** says what changed on the screen.
- **Guide:** the chart-of-accounts steps are updated for the two modes and the click-through.

## Amendments from pre-building (10/10)

The feature was built and run on a local pre-build branch first. Results:
- **Live check, read-only on all six companies:** every account's figure equals its natural ledger balance over the right range. For every account with a balance, the QuickZoom list adds up to the figure. The drill-down part takes about five minutes.
- **Smoke on the sample company, read-only:** 18 of 18.

These points were settled along the way.

1. **Where the groups live.**
   - The fourteen groups are in a new module, `lib/domain/chart-groups.ts`.
   - Today's ten `ACCOUNT_SECTIONS` and `sectionOf` stay, because the new-company chart templates (`chart-templates.ts` and its test) are organised by them.
   - `account-sections.ts` gains `accountGroups(accounts, groups, groupOf)`, which builds the same code-ordered tree for any grouping. `accountSections` now sits on top of it, unchanged.
   - Both modes of the page use the fourteen groups.
2. **An account that fits two groups.** A current asset in the inventory account set goes to Inventory, even if its detail type marks money in transit.
3. **Fiscal year.**
   - With no settings row, the fiscal year starts in January.
   - The drawer's dates come from the same fiscal year start the figures were worked out from, so a click covers the dates of the figure clicked.
4. **Screen helpers** that are pure live in `lib/domain/chart-list.ts`: the rows, the visible accounts, the labels and the column widths.
5. **Switching Balances and Setup** writes the address with `history.replaceState`, as `lib/client/use-table-url-state.ts` does. The rows are already in the browser, and a router navigation would read every balance again.
6. **Class dots** use the app's existing chart colours. No new tokens were added.
7. **Small choices:**
   - Setup keeps today's cash flow role filter.
   - Archived accounts are treated like inactive ones.
   - Clicking an account's name opens its entries in both modes.
8. **A QuickZoom fix the chart makes more visible:** its total line now says "1 line" for a single line, not "1 lines". It is noted in the changelog.
