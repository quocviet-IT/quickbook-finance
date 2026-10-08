# Reports, wave 1: ten reports from the mockup, and Beancount in the sidebar

Date: 2026-10-08 · Branch: `feat/reports-wave1` (from main bb1618f) · Release number: taken when it merges (1.92 if nothing else merges first).

## Why

The client's latest mockup, `Accounting System-v4.html`, has 34 reports. OneBook has 27 report cards, and 9 of those have no counterpart in the mockup. Of the mockup's 34:
- 16 exist in OneBook;
- 7 are partial;
- 11 are missing.

The user asked for all 34. It is split into waves, and this spec is wave 1:
- add the ten reports whose data OneBook already stores;
- move Beancount to a small sidebar item, as the mockup has it.

After wave 1, 26 of the mockup's 34 are in OneBook. Waves 2 and 3 are listed under "Not in this wave".

The mockup embeds a real client's books. Only its structure is used here; tests and screenshots use invented data or the sample company PC-Test.

## Decisions (agreed with the user, 08/10)

1. **Waves.** Wave 1 holds Beancount plus the ten small reports below.
2. **Beancount placement matches the mockup exactly:**
   - it is the last child of the Accounting group in the sidebar, labelled "Beancount";
   - the page moves to `/accounting/beancount`, and `/reports/beancount` redirects there;
   - the Report Center card is removed.
3. **"The Bin" becomes "Voided and Reversed Entries."** OneBook never deletes a posted entry; it voids or reverses it. So the report lists those entries and offers no restore.
4. **Approach A.** Each report gets its own page under `/reports/<slug>`, built from the existing paper layout: `ReportPaper`, `ReportToolbar`, `ReportExportButtons`. Each has a pure calculation module with unit tests and a card in the Report Center catalog.
5. **Who can see each report** follows the screen its data comes from; Change Log needs `audit.read`.
6. **Names are the mockup's.** The page heading is the mockup's printed heading where it differs. For example, the "Customer Balances" card prints "Customer Balance Summary".

## The ten reports

Common to all ten:
- money is shown in the company's base currency;
- void and draft documents are left out unless stated;
- every report has the toolbar's Copy, CSV and Print;
- a report with a total states, under the total, what that total ties to (the **proof line**). When the two sides disagree, it says so in a warning instead of hiding the difference.

### Receivables group

**Open Invoices** (`/reports/open-invoices`)
- Parameter: as of a date (default today).
- Columns: Date, Num, Customer, Due, Age, Amount, Open balance.
- One row per invoice with an open balance on that date.
- Age is the number of days past due on the as-of date, shown as "Current" when not yet due.
- Sorted by customer, then due date.
- Proof line: the total open balance equals the A/R Aging total on the same date. Both read the same aging source as `getArAging`.

**Customer Balances** (`/reports/customer-balances`; heading "Customer Balance Summary")
- Parameter: as of a date.
- Columns: Customer, Balance. One row per customer with a non-zero balance, sorted by name, then a total.
- Proof line: the total equals the A/R Aging total.

**Sales by Customer** (`/reports/sales-by-customer`; heading "Sales by Customer Summary")
- Parameter: a period (default this year).
- Columns: Customer, Documents, Total, % of sales. Sorted by Total, largest first; then a total row.
- Sales are posted invoices dated in the period, at their amount before sales tax, less posted credit memos dated in the period.
- Documents is the number of invoices. OneBook has no separate sales-receipt document, so invoices are the only sales document.
- % of sales is the customer's total over the grand total. It is blank when the grand total is zero.

### Payables group

**Unpaid Bills** (`/reports/unpaid-bills`): Open Invoices for bills. Columns: Date, Num, Vendor, Due, Age, Amount, Open balance. Proof line ties to the A/P Aging total (`getApAging`).

**Vendor Balances** (`/reports/vendor-balances`; heading "Vendor Balance Summary"): Customer Balances for vendors. Proof line ties to A/P Aging.

**Expenses by Vendor** (`/reports/expenses-by-vendor`; heading "Expenses by Vendor Summary")
- Parameter: a period.
- Columns: Vendor, Entries, Total, % of spend. Sorted by Total, largest first.
- Covers every posted ledger line in the period on an account the Profit and Loss counts as cost of sales or expense, other expenses included. Each line's amount is debit minus credit.
- The vendor is the vendor on the document the entry came from: bill, expense, or vendor credit. Lines from any other source go to one row, "(No vendor)": manual journals, bank-coded lines with no vendor, depreciation and similar.
- Entries counts each (entry, account) pair once, as in the mockup: an entry touching three expense accounts counts three.
- Proof line: the grand total equals the P&L's cost of sales plus expenses (other expenses included) for the same period.

### Accounting group

**Reconciliation Report** (`/reports/reconciliations`)
- Parameter: a bank account, or all.
- One row per signed-off statement reconciliation: bank account, statement end date, statement ending balance, signed off by, signed off at, and whether it **still agrees**. Each row links to the existing per-reconciliation report (`/banking/reconcile/[id]/report`).
- Sorted by account, then statement end date, newest first.
- "Still agrees" uses the same test the per-reconciliation report uses today: the cleared balance recomputed from its lines still equals the statement ending balance it was signed with. When it no longer agrees, the row shows the difference.

**Change Log** (`/reports/change-log`)
- Parameter: a period, plus an optional record type.
- Columns: When, Who, What, Record, Detail. What is the audit action: Added, Changed, Voided, Reversed, Locked or similar. Detail summarises the changed fields.
- Newest first, paged.
- Source: `acc_audit_log`, the same source `/settings/audit` uses.
- Only users with `audit.read` see the card or can open the page.

**Month-End Close Log** (`/reports/close-log`)
- Parameter: a fiscal year (default the current one).
- One row per close or reopen event, grouped by month. Columns: Month, Event (Closed / Reopened), When, By, Reason or note.
- If the close records which checks passed, an extra column shows them as "n of m checks ok". If they are not recorded, the column is not shown. It is never invented.
- A month that has never been closed shows one row reading "Open".
- Sources: `acc_accounting_period` and `acc_period_event`.

**Voided and Reversed Entries** (`/reports/voided-entries`)
- Parameter: a period, matched on the date of the void or reversal, not the entry date.
- Columns: Date of entry, Entry, Description, Amount, Action (Voided / Reversed), By, When, Reason, Reversal entry (linked, for reversals).
- Newest action first.
- Sources: journal entries with status void, and `acc_journal_reversal_link`. Who, when and why come from the audit log or the entry's own fields, whichever holds them.
- No restore. To post an entry again, the user creates a new one.

## Beancount

- The page moves from `app/(app)/reports/beancount` to `app/(app)/accounting/beancount`. Its heading stays "Beancount Export".
- A new sidebar item `{ key: "/accounting/beancount", label: "Beancount" }` goes last in the Accounting group of `lib/domain/navigation.ts`. Sub-items carry no icon in OneBook, as in the mockup. Its role or permission gate is the same as the page's own.
- `/reports/beancount` stays as a page that redirects to `/accounting/beancount`, keeping its query string. This keeps working:
  - old links;
  - the entry drawer's "As Beancount";
  - changelog routes, which a test requires to exist.
- The `beancount-export` card leaves `REPORT_CATALOG`.
- `tests/unit/navigation.test.ts` forbids sidebar leaves under `/reports/*`. That still holds, because the new item is not under `/reports`.

## Architecture

- **Per report:**
  - `lib/domain/reports/<name>.ts`: pure functions from rows to the report (ordering, totals, percentages, proof line, age);
  - `lib/services/reports/<name>.ts`: reads, using the existing services where they exist (`getArAging`, `getApAging`, the journal and audit reads);
  - `app/(app)/reports/<slug>/{page.tsx, <Name>Client.tsx, actions.ts}`.
- **Every list read pages** (`readAllPages`). PostgREST returns at most 1,000 rows and says nothing.
- **No migration is planned.** If one turns out to be needed (for example, a read-only function because a figure cannot be computed from paged reads), work stops and the user is asked first.
- **Report Center.** `REPORT_CATALOG` gains the ten cards in the groups above. `ReportDefinition` gains an optional permission field, so the hub hides cards a user cannot open. The page enforces the same rule on the server.
- **Server Components** must not read Ant Design compound members such as `Typography.Title`; `scripts/smoke-pages.mjs` catches this.

## Testing

1. **Unit tests per calculation module:**
   - ordering, totals and percentages, including a zero grand total;
   - Age, including "Current" on the due date;
   - the "(No vendor)" row;
   - entries counted once per account;
   - credit memos reducing sales;
   - proof-line agreement and disagreement;
   - the Close Log's "Open" row;
   - voided versus reversed rows.

   A catalog test: ten new cards with unique hrefs, each to an existing page, Beancount absent. A navigation test: Beancount last in Accounting, and the redirect page present.
2. **A read-only check script run on every company,** with no writes:
   - Open Invoices and Customer Balances equal A/R Aging;
   - Unpaid Bills and Vendor Balances equal A/P Aging;
   - Expenses by Vendor equals the P&L's expense total for the year.

   A mismatch is reported per company.
3. **Smoke** every new page and the Beancount redirect.
4. **Screenshots, light and dark,** of each report and of the sidebar with Beancount, on PC-Test, with an approval page. Nothing is pushed until the user approves the shots.
5. **Gates before push:** typecheck, lint, the whole unit suite, build and the bundle budget.

## Changelog and Guide

- One release for wave 1. It names the ten reports and the Beancount move in the words the screen uses.
- The number is taken at merge time, in merge order: the next free number above what main has.
- The Guide gets a step for finding Beancount in the sidebar. It also gets one step per group of new reports, not one per report.

## Not in this wave

- **Wave 2 (medium):** Financial Ratios; Purchases and Inventory; Sales Tax Liability as a period table; Stock Count with counted quantities; bringing 13 Week Cash Forecast and Budget vs Actual in line with the mockup.
- **Wave 3 (large, each its own release, each needing the user's decisions first):**
  - Intercompany Balances and Consolidated, which read two companies' books at once;
  - Profit and Loss by Class, which needs a class on entries;
  - Prepayments and Deferred Income, which needs schedules and posted releases.
- **Cross-cutting items from the mockup, not asked for in this wave:**
  - an accrual or cash switch on every report;
  - "Save all" and "Print all";
  - pinned reports;
  - "show accounts with no balance" on the Balance Sheet and Trial Balance.

## Amendments from pre-building (08/10)

Before the plan was written, the ten reports were built on a local branch and run, read-only, against all six companies. These are the points where the code and the data changed what is written above.

1. **Who can see each report.** No existing report page is gated; Row Level Security lets every company member read. "Follows the screen its data comes from" therefore means open to every member, except the Change Log (`audit.read`).
2. **Proof lines.** Open Invoices, Customer Balances, Unpaid Bills and Vendor Balances are held to the **control account**: A/R or A/P.
   - They read the same open-item list as the A/R and A/P Aging, so tying to the aging would prove nothing. The aging total is shown as a line instead.
   - OneBook's aging is the current open position of documents dated on or before the as-of date, not a historical one, and these reports follow it.
3. **Sales by Customer is read from the ledger.**
   - It adds every posting to an income account, under the customer of the invoice, credit memo or payment behind it.
   - In base currency, so sales tax is never in it and foreign-currency invoices count at their posted rate.
   - Income with no customer document goes to a "(No customer)" row, so the total equals Income on the Profit and Loss.
4. **Expenses by Vendor** includes cost of sales and other expenses, so its total equals the P&L's cost of sales + expenses + other expenses. Bill payments (early-payment discounts) count for their vendor.
5. **Voided and Reversed Entries.**
   - Entries voided before the books kept the time of a void (10 in one company) are dated by their entry date, and When reads "Not recorded".
   - Who voided a document comes from the audit log, so only for readers with `audit.read`.
   - The reason sits under the description.
6. **Change Log.**
   - It shows the newest 1,000 entries, the audit search's ceiling, and says when there are more.
   - The Detail column leaves out ids, links, stamps and hashes.
7. **File layout.** Modules are `lib/domain/<name>.ts`, reads are `lib/services/party-reports.ts` and `review-reports.ts`, and the pages share one `SimpleReport` frame. `lib/domain/reports.ts` and `lib/services/reports.ts` are already files, so no `reports/` folder.
8. **Beancount** gets its own loading screen. Otherwise the Accounting overview's dashboard skeleton would show while the file builds.
