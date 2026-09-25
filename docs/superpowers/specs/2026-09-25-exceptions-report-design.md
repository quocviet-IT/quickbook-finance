# The Exception Report

- Date: 2026-09-25
- Status: Approved design, ready for planning
- Source of requirements: `Accounting-System-v3.html`, the client's single-file
  prototype — the exceptions module at lines 7735–7982
- Scope: one read-only report, eight checks, no migration
- Explicitly out of scope: the other nine modules the prototype specifies
  (Beancount export, consolidation, working-paper trial balance, classes,
  estimates, prepayments and deferred income, the stock count sheet, the bin,
  history-based coding). Each gets its own spec.

## 1. Where the requirement comes from

The client supplied a working prototype of the accounting system they want.
Its comments are the requirement, written as prose next to the code that
implements it. The exceptions module opens:

> The checks a reviewer runs by hand: entries that look posted twice, a cheque
> number used more than once on the same account, money sitting in undeposited
> funds, a balance pointing the wrong way, a period with income and no costs.
> None of these is proof of an error. Each is a question worth answering.

That last sentence is the design. The report does not accuse; it raises
questions a reviewer would raise, and records that somebody looked.

A review of the client's own Pacific Four Nine ledger (1,454 entries,
2022-12-31 to 2025-12-31, exported from Wave) was carried out before this
design and found ten categorisation problems. **These eight checks catch one
of those ten reliably.** That is not a defect in the specification — the eight
are the classic reviewer's checks, not a detector for systematic
miscategorisation. It is recorded here so nobody later mistakes a clean
exception report for a clean set of books. The other nine problems are a
separate question, deliberately not in this scope.

## 2. The hard constraint: this report must not change a single figure

The report is read-only. Nothing in it writes, posts, adjusts, voids or
reclassifies. This is a requirement from the client, stated directly, and it
is stronger than a convention — it is what makes the report safe to run on a
live set of books at any time, including inside a closed period.

How it is guaranteed, in order of strength:

1. **No write path exists.** `lib/services/exceptions.ts` calls read-only RPCs
   and `select` queries only. It imports nothing that writes.
2. **The server action is read-only.** `actions.ts` returns a computed report.
   It takes a date range and returns rows. It has no other verb.
3. **The domain module cannot write.** `lib/domain/exceptions.ts` is pure: it
   receives already-read data and returns a result. It does not import the
   Supabase client, and a unit test asserts the module's import list stays
   free of `@/lib/db/*` and `@/lib/services/*`.
4. **No migration.** This work adds no SQL, so no trigger, constraint or
   function changes. Every figure the report displays is read through
   `acc_ledger_balances` and `acc_transaction_list`, which the Trial Balance
   and Transaction List reports already use.

A reviewer checking this work should be able to confirm the constraint by
reading two things: the import list of the domain module, and the verb list of
`actions.ts`.

## 3. Architecture

Approach: compute in TypeScript over existing read RPCs. Rejected
alternatives, with reasons, in §8.

| File | Responsibility | Rough size |
|---|---|---|
| `lib/domain/exceptions.ts` | Pure. Eight check functions plus `buildExceptionReport(input)`. No I/O, no clock — `today` arrives as an argument. | ~280 lines |
| `lib/services/exceptions.ts` | Five reads, assembled into `ExceptionReportInput`. | ~90 lines |
| `app/(app)/reports/exceptions/page.tsx` | Server shell: `PageHeader` + `ReportEntityBadge`, same shape as `reports/gl-posting/page.tsx`. | ~38 lines |
| `app/(app)/reports/exceptions/ExceptionsClient.tsx` | Date range, eight sections, drill-through, CSV. | ~300 lines |
| `app/(app)/reports/exceptions/actions.ts` | One server action: run the report for a date range. | ~40 lines |
| `lib/domain/report-catalog.ts` | One catalogue entry, group `accounting`. | +8 lines |
| `tests/unit/exceptions.test.ts` | Per-check tests, plus the import-list assertion from §2. | ~350 lines |

The boundary that matters: the domain module is handed data and returns an
answer. Every check can therefore be tested by constructing an input object,
with no database, no fixtures loaded from disk and no clock.

## 4. The eight checks

Normal balance side, derived from `acc_account.account_type`:

- **Debit-normal:** `bank`, `accounts_receivable`, `current_asset`,
  `fixed_asset`, `cost_of_goods_sold`, `expense`, `other_expense`
- **Credit-normal:** `accounts_payable`, `credit_card`, `current_liability`,
  `equity`, `income`, `other_income`

### 4.1 Entries recorded more than once

Group entries in `[from, to]` by `entryDate`, `partyName`, reference, the
sorted `accountIds` set, and `amountMinor` — all but the reference coming
straight from `TransactionListRow`. Report every group of more than one.

The reference is the document's own reference — `acc_payment.reference` or
`acc_bill_payment.reference`, the field migration 0071 added for "a check
number, a wire reference, an ACH trace". It is **not** `entry_number`, which is
unique by definition and would stop this check ever firing.

Prose shown with the section, from the prototype: *"Same date, same name, same
reference, same accounts, same amount. Repeated wages on one day are normal
when several people are paid the same; the same supplier paid twice usually is
not."*

### 4.2 A cheque number used twice on one account

Group `acc_payment` and `acc_bill_payment` by (bank or credit-card account,
`reference`). Report any pair where the same reference appears against the same
account more than once. Skip null and empty references.

Counted per account on purpose, so the same number in two different cheque
books is not flagged.

### 4.3 Money received but not yet banked

Accounts whose name matches `/undeposited/i` **or** whose `account_code` is
`1210`, carrying a non-zero balance as of `to`. Show balance, number of entries
touching the account up to `to`, and the oldest such entry's date.

The code is accepted alongside the name because a company can rename the
account; the name is accepted alongside the code because a company can add a
second one.

### 4.4 A balance pointing the wrong way

From cumulative balances as of `to`: report any account whose signed balance
opposes the normal side for its `account_type`.

Contra accounts are excluded — and here OneBook is better placed than the
prototype. The prototype guesses with a name regex
(`/Accumulated|Depreciation|Returns|Discount|Allowance|Contra|Distributions/i`).
OneBook records the fact: migration 0046 creates `'1590', 'Accumulated
Depreciation'` with `detail_type = 'Contra fixed asset'`. **Exclude accounts
whose `detail_type` begins with `Contra`, case-insensitive.** No regex on names.

`acc_ledger_balances` does not return `detail_type`, so the account list is
read separately and joined in TypeScript.

### 4.5 A year with income and no costs

Over the whole life of the book: for each calendar year, total income
(`income` + `other_income`) and total cost (`cost_of_goods_sold` + `expense` +
`other_expense`). Report years where income exceeds zero and cost is zero.

Ignores the date range, as the prototype does. The section is labelled
**All dates** so the reader does not think the filter is broken.

### 4.6 Bank accounts not agreed to a statement

Every `acc_bank_account` whose general-ledger balance at `to` is non-zero and
which has no completed `acc_statement_reconciliation` with
`statement_ending_date >= to`. Show the balance and the last reconciled date,
or the word **never**.

### 4.7 Entries dated in the future

Posted entries with `entry_date` later than today. Ignores the date range, as
the prototype does; labelled **All dates**.

### 4.8 Still sitting in a holding account

Accounts whose name matches `/uncategorized|suspense|ask my accountant/i` with
a non-zero balance as of `to`.

## 5. Reads

Five, all of them existing and all of them already filtered to
`status = 'posted'`, so voided entries are excluded without special handling.

| # | Read | Feeds |
|---|---|---|
| 1 | `acc_ledger_balances(null, to)` | 4.3, 4.4, 4.6, 4.8 |
| 2 | `acc_transaction_list(from, to)` | 4.1 |
| 3 | `acc_transaction_list(today + 1 day, '9999-12-31')` | 4.7 |
| 4 | `getMonthlyLedgerBalances` over the book's full span, summed by year. The span is the earliest and latest `entry_date` among posted entries, read in the same round trip — not the report's date range, and not a guessed number of years | 4.5 |
| 5 | `acc_payment` + `acc_bill_payment` where `reference` is not null; plus, only when 4.3 finds a non-zero balance, the entry count and earliest date against that account | 4.2, 4.3 |

Read 5's second half runs only when there is something to describe, so the
common case costs nothing.

## 6. The screen

Header: the report title, then three figures — **Entries examined**,
**Questions raised**, **Checks run (8)**.

Then eight sections, each with the same shape: title, a count, either a
`to look at` tag or a `Nothing found` tag, the prototype's explanatory
sentence, and a table. **A section with nothing in it is still drawn.** That is
deliberate: the reader must see that the check ran, not watch it disappear.

Every row that stands for an entry is clickable and opens
`/reports/journal?entry=<entryId>`, the drill-through path
`GeneralLedgerClient.tsx` already uses.

Date range: two `DatePicker`s, From and To, defaulting to the start of the
current fiscal year through today. Sections 4.5 and 4.7 carry an **All dates**
label.

CSV export through `csvWithReportIdentity`, as in the 1099, cash-flow-forecast,
customer-credit and number-sequence reports. One file, with a `Check` column so
a row can be traced back to the check that raised it.

Footer, kept from the prototype: *"Nothing here is proof of a mistake. Each
line is a question a reviewer would ask, and most have an innocent answer — four
wages of the same amount on one day, a cheque book that restarts at 1000. What
matters is that somebody has looked and can say why."*

Interface language is US English, as everywhere else in the application.

## 7. Failure behaviour

| Situation | Behaviour |
|---|---|
| No company selected | `ReportEntityBadge` says so; no read is issued |
| One read fails | An `Alert` naming **which check could not run**; the other seven still render. One failing RPC must not blank the page |
| Empty book | Eight sections, all `Nothing found`, Entries examined 0 |
| `from` later than `to` | Refused in the client; no server call |
| Large book | Checks 4.1 and 4.7 read only their date windows; 4.3–4.6 and 4.8 read database-side aggregates. 4.1 is the heaviest: Pacific Four Nine is 1,454 entries, the larger Transfine book 5,068 — neither is a concern |

## 8. Alternatives considered

**Eight SQL functions.** Faster on any size of book, and wrong for this work.
Hashing "same set of accounts, same amount" in SQL is hard to read and harder
to review; it needs a migration, which this report otherwise does not; and the
development network cannot reach the Postgres port, so every correction to a
function would have to be deployed before it could be tried. A check that is
awkward to test is a check that silently stops working.

**A hybrid — balances in SQL, row checks in TypeScript.** This is what the
chosen approach already is: `acc_ledger_balances` is a database aggregate. Not
a separate option.

## 9. Testing

**Unit tests, one `describe` per check**, calling the pure functions directly.
Each check gets at least three cases: it fires when it should, it stays silent
when it should, and one boundary case. The boundary cases that matter:

- 4.1 — two entries alike in everything but reference are **not** duplicates
- 4.2 — the same cheque number against two different bank accounts is **not**
  flagged
- 4.4 — an account with `detail_type = 'Contra fixed asset'` carrying a credit
  balance is **not** flagged
- 4.5 — a year with income and a single expense of any size is **not** flagged
- 4.6 — a bank account reconciled exactly to `to` is **not** flagged
- 4.8 — an account named "Uncategorized" with a zero balance is **not** flagged

**The read-only assertion from §2**: a test reads
`lib/domain/exceptions.ts` and fails if it imports from `@/lib/db/` or
`@/lib/services/`.

**Interface gates**: `npm run verify:table-fit`, because every table in the
application must fit its frame, and `scripts/smoke-pages.mjs`, because a
server component reading a compound Ant Design export has broken this
application before.

### Test data

Fixtures are **constructed, never copied**. This repository is public. The
Pacific Four Nine ledger contains real customer data — the names of people who
sent money by Zelle, bank account identifiers, cheque numbers, wages — and none
of it may enter `tests/`.

What the fixtures reproduce is the *shape* of each finding, with invented names
and amounts: an account named `Uncategorized` carrying a balance, so 4.8 is
proved; an `expense` account carrying a credit balance, so 4.4 is proved; two
entries on one date with one counterparty and one amount, so 4.1 is proved.

The real ledger stays in the session scratchpad and is used only to eyeball the
finished report by hand. It is not committed.

## 10. What this work does not include

No writing of any kind. No "reviewed" or "explained" flag. No stored state
about what a reviewer has already looked at. No scheduling. No cross-company
view. The prototype's exception report is read-only, and so is this one.
