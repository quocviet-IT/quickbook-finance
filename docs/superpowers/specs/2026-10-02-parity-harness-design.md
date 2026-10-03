# Phase 0 — the parity harness — design

**Date:** 2026-10-02
**Branch:** `feat/parity-228`
**Roadmap:** `docs/superpowers/specs/2026-10-02-prototype-228-parity-roadmap.md`, Phase 0.

## 1. What is asked

The client wants proof that OneBook calculates what the prototype *Accounting System 2.28* calculates. Before any
parity work changes a screen, a harness must measure where the two disagree today, and stay in place so that every later
release can show its own module agrees.

Decided with the user on 2026-10-02:

- **Load and throw away.** The prototype's own books are posted into a temporary OneBook company inside one database
  transaction, OneBook computes its figures there, and the transaction is rolled back. Nothing is kept. Both sides hold
  exactly the same entries, so every difference found is a difference in calculation or presentation.
- A second, read-only pass compares the prototype's newest copy of the books OneBook already holds (the jewelry
  company loaded on 29 September) with OneBook's copy, to list the entries that differ — data, not calculation.
- Reference screenshots of every prototype screen are taken for the interface work of later phases.
- Phase 0 changes no figure in OneBook. It measures.

## 2. What is compared

For each of the prototype's two books:

| Figure | Prototype | OneBook |
|---|---|---|
| Every account's balance at every month end, from the first entry to the last | `balancesFor(view("", monthEnd))` | `acc_ledger_balances(null, monthEnd)`, debit − credit |
| Trial Balance at each fiscal year end: total debits, total credits | the rendered `reportTB()` | `buildTrialBalance` |
| Profit and Loss for each fiscal year: total income, cost of goods sold, gross profit, total expenses, net operating income, other income, other expenses, net other income, net income | the rendered `reportPL()` | `buildProfitAndLoss` — the totals `pnlStatement` displays |
| Balance Sheet at each fiscal year end: total assets, total liabilities, total equity, total liabilities and equity | the rendered `reportBS()` | `buildBalanceSheet` — the totals `balanceSheetStatement` displays |

The prototype's figures are read from what the prototype itself computes and shows — its own functions, its own
rendered reports — never re-derived. OneBook's figures come from the same pure builders the Reports screen uses, fed by
the same database function.

Later phases add their module's figures (ageing, sales tax, budget, 13-week cash …) to the harness.

## 3. How it works

### 3.1 Reading the prototype

- The prototype is the built single file (`accounting-system.html` from the 2.28 source). Its path is given when the
  harness runs; it is never copied into the repository.
- A headless Chromium opens it from disk with an empty profile, so the page seeds its two books as it does for any new
  visitor, and waits until the books are loaded.
- For each book, inside the page: make it the active book, then export
  - its company settings (fiscal-year start month, open date),
  - its accounts (name, opening balance),
  - every entry `allTxns()` returns — the opening-balances entry included — with id, date, description, closing flag
    and postings,
  - the figures in section 2, read with the prototype's own functions and from its own rendered report tables, by row
    label (for example "Net Income", "Total Assets").
- Amounts are converted to cents once, by rounding the prototype's two-decimal figure; nothing else is recomputed.

### 3.2 Loading into a throwaway company

All inside ONE transaction that is always rolled back, including on error and on timeout:

1. Build a company with `provisionCompany` under a temporary slug (`parity_` plus a random suffix), as
   `scripts/verify-company-provisioning.mjs` does.
2. Create one OneBook account per prototype account, typed by the prototype's own classification rules. Within each
   root, the first matching row wins, in this order (the prototype's own order for assets: long-lived, then cash, then
   receivable):

   | Prototype account | OneBook type |
   |---|---|
   | `Assets:` matching `FixedAsset\|Equipment\|Furniture\|Vehicle\|Property\|Building\|Land\|Intangible\|Goodwill\|Depreciation\|Amorti` | `fixed_asset` |
   | `Assets:` matching `^Assets:(Bank\|Cash)\|Cash` | `bank` |
   | `Assets:` matching `Receivable` | `accounts_receivable` |
   | other `Assets:` | `current_asset` |
   | `Liabilities:` matching `LongTerm\|Mortgage\|NotePayable\|LoansPayable\|Debenture\|Bond` | `long_term_liability` |
   | `Liabilities:` matching `CreditCard` | `credit_card` |
   | `Liabilities:` matching `AccountsPayable` | `accounts_payable` |
   | other `Liabilities:` | `current_liability` |
   | `Equity:` | `equity` |
   | `Income:InterestIncome…` / `Income:OtherIncome…` | `other_income` |
   | other `Income:` | `income` |
   | `Expenses:CostOfGoodsSold…` | `cost_of_goods_sold` |
   | `Expenses:InterestExpense…` / `TaxExpense…` / `OtherExpense…` | `other_expense` |
   | other `Expenses:` | `expense` |

   The patterns are the prototype's own (`p13` `assetClass`/`liabClass`, `p4` `COGS_RE`/`OTHER_INCOME`/`OTHER_EXPENSE`),
   so the two systems put each account in the same section. The prototype's accounts get their own codes (`P0001`
   onward); the accounts the chart template created are left unposted, so they hold nothing and change no figure.
3. Post every prototype entry, in date order, through `acc_post_manual_journal` as the company's administrator, in
   batches: a positive posting is a debit, a negative one a credit. An entry that cannot be posted (it does not balance
   in cents, or names an account that was not created) is not forced: it is listed in the report as *not loaded*, and
   its effect on the comparison is stated.
4. Read OneBook's figures (section 2) on the same connection, so they see the uncommitted entries.
5. Roll back.

### 3.3 Classifying each difference

Every pair of figures is compared to the cent. A difference is tagged with the known rule it matches, from the
roadmap's section 4, or as **new**:

- *closing entry* — the prototype leaves entries flagged as closing out of every P&L view; OneBook has no such flag;
- *rounding* — a one-cent difference where the prototype rounds a negative half-cent toward zero;
- *not loaded* — the book has entries that could not be loaded, and they touch this account or fall in this period;
- *new* — none of the above. Each *new* difference is a finding for the user.

Presentation differences — how equity is split into prior years' and this year's earnings, how accounts are grouped —
cannot show in the totals compared here; the interface phases compare them screen by screen.

### 3.4 The data pass

Read-only, against the live company OneBook already holds for the prototype's jewelry book (its schema name is given
when the harness runs):

- Entries are matched by date and the sorted list of posting amounts in cents. An optional local account map (the one
  used to load that company on 29 September) also matches accounts by name.
- Listed: entries only in the prototype, entries only in OneBook, and entries whose amounts match but whose accounts
  differ.
- Nothing is written.

### 3.5 Reference screenshots

The same headless page captures every top-level tab and every report in the prototype's report list, for each book, in
light and dark, at 1440 × 900. They are kept with the results, never in the repository, and later approval pages put
them beside OneBook's screens.

### 3.6 Output

To an output folder given when the harness runs (the default is `C:\Users\pit010\OneBook-parity-2.28\`, outside the
repository):

- `parity-report.html` — per book: accounts, months and figures compared; how many agree; every difference with its tag;
  the entries not loaded; then the data pass; then a table of the screenshots taken.
- `parity-result.json` — the same, for later phases to diff against.
- `shots/` — the screenshots.

The console prints counts only — never names, accounts or amounts.

## 4. Software

- `lib/parity/` — pure modules, imported by the harness and by tests:
  - `account-types.ts` — `prototypeAccountType(name)` by the table in 3.2;
  - `cents.ts` — `toCents(dollars)` and the posting-to-line conversion;
  - `compare.ts` — compare two maps of figures, tag each difference (3.3);
  - `drift.ts` — match two entry lists (3.4);
  - `report-html.ts` — render the report (escaped, self-contained HTML).
- `lib/services/reports.ts` — the row-to-`LedgerBalance` mapping inside `getLedgerBalances` becomes an exported
  `ledgerBalanceFromRow`, used there and by the harness, so both read balances the same way. No behaviour change.
- `tests/unit/parity-*.test.ts` — the pure modules, with invented accounts and amounts.
- `tests/parity/prototype-parity.parity.ts` — the harness itself: Playwright for the prototype, `pg` for the
  throwaway company and the data pass, the pure modules for the rest. It runs under its own Vitest config
  (`vitest.parity.config.ts`, like `vitest.live.config.ts`) so `@/` imports resolve, and is never part of `npm test`.
- `package.json` — `npm run parity`, reading `PARITY_PROTOTYPE_HTML`, `PARITY_OUT_DIR` (optional),
  `PARITY_LIVE_SCHEMA` (optional, enables the data pass) and `PARITY_ACCOUNT_MAP` (optional) from the environment.

## 5. Safety

- The throwaway company exists only inside a transaction that is rolled back in `finally`. A hard timeout ends the
  process if anything hangs; a hung connection's transaction is rolled back by the server when the connection drops.
- The temporary slug is random and checked not to exist before provisioning.
- The data pass opens a read-only transaction.
- No real name, account number or figure enters the repository: the prototype file, the account map and every output
  stay on the local machine; unit tests use invented data.

## 6. Proving it

- Unit tests for every pure module, including each difference tag and the drift matching.
- One full run on both books. The user receives the report: what agrees, what differs and why, and what the data pass
  found. No release number and no changelog entry — nothing a user of OneBook sees changes.
- The harness is the acceptance test for every later phase: a phase is done when its figures agree, or differ only in
  ways the user has accepted.

## 7. Out of scope

- Fixing any difference — each belongs to the phase that owns that area.
- Ageing, sales tax, budget and the other module reports — added by their phases.
- Bringing OneBook's copy of the jewelry book up to 2.28 — the data pass informs that decision; it does not make it.
