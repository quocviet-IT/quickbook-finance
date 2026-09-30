# Balance assertions in the Beancount export — design

**Date:** 2026-09-30
**Branch:** `feat/beancount-balance` (from `main` at 1.72)
**Release:** 1.73

## 1. What is asked

The client's note on the Beancount export (1.63):

> Beancount lets a file state what an account *should* hold on a date — `2026-06-30 balance Assets:Bank:… 4500.68 USD` — and refuses to read the file if it does not. […] any entry inserted, changed or missed in that month makes `bean-check` fail loudly.
>
> Both exports emit `open` directives and transactions, and neither emits a single `balance`. […] one line per reconciled statement, taken from the figure that was already agreed.

## 2. What is there today

- The export writes options, `open` for every account (dated the book's first entry), `price` lines and every posted entry. It writes no `balance`.
- A statement reconciliation (`acc_statement_reconciliation`, 0025/0026) stores the statement date and the statement's ending balance. It completes only when the lines cleared in it bring the beginning balance to the statement balance exactly.
- Posted entries are immutable: lines cannot be changed or deleted, and the only change to an entry is voiding it (`status = 'void'`, `voided_at = now()`). Every entry has `posted_at`.

Measured on live data on 2026-09-30 (read only):

- One completed reconciliation exists in the whole system. On its statement date the statement balance and the book balance differ by the 15 lines not yet cleared (outstanding cheques). A `balance` line carrying the statement figure would fail `bean-check` on correct books.
- Two companies with bank accounts (9 and 6 of them) have no reconciliation at all, so their file would have no `balance` line until someone reconciles.
- 41 entries in one company are void; 10 of them have no `voided_at` (old test data from before every void path set it). None of the 10 touches a bank account.

## 3. Decided

With the user on 2026-09-30:

- **The figure is the book balance as it stood when the reconciliation was completed**, not the statement balance and not today's book balance. It is rebuilt from `posted_at` and `voided_at`, which is exact because posted entries cannot change. No migration.
- The statement balance and the outstanding items are written as a comment beside it, so the file shows how the two agree.

## 4. What the file gets

A section after the transactions, before `;; --- End of file ---`:

```
;; --- Balance assertions ---
;; One per completed bank reconciliation: the book balance on the statement
;; date as it stood when the reconciliation was completed. Beancount checks a
;; balance at the start of its day, so each is dated the day after the statement.

; Statement of 2026-07-31: 12,480.00 USD. Books differ by -1,125.40 USD: 3 lines not yet cleared.
2026-08-01 balance Assets:Bank:1010-Operating-Account   11354.60 USD
```

- **One line per completed reconciliation.** In progress (including reopened) sessions write nothing.
- **Date:** the statement date plus one day.
- **Account:** the bank account's GL account, named exactly as elsewhere in the file.
- **Figure:** the sum of signed amounts (debit − credit, in the entry's currency) of the lines on that GL account whose entry
  - is dated on or before the statement date,
  - was posted on or before the reconciliation's `completed_at`, and
  - was not void at that moment (`voided_at` is null or later than `completed_at`).
- **Comment:** the statement date and balance, the difference (figure − statement balance), and how many counted lines were not cleared in that reconciliation or an earlier completed one on the same account. With no difference it reads `Books agree with the statement.` The count explains the difference; it is not required to add up to it (a first reconciliation may start from a beginning balance).
- **Order:** by assertion date, then account name.

### When no `balance` is written

A comment takes the line's place and says why. The figure is never guessed.

| Case | Comment |
|---|---|
| The GL account's currency is not the base currency, or a line counted is in another currency | `; Not asserted: the statement of <date> is reconciled in <base>, and <account> holds <ccy>.` |
| A void entry without `voided_at` has a line on the account dated on or before the statement date | `; Not asserted: an entry on <account> was voided at an unrecorded time, so its balance at completion cannot be rebuilt.` |

Reconciliation works in base-currency amounts (`amount_base_minor`), while the file posts in each entry's own currency. The two agree only when both are the base currency, which is every bank account today.

### `open` dates

Every account opens on the earlier of the book's first entry and the earliest assertion date, so a `balance` never falls before its account opens.

## 5. Software changes

**`lib/domain/beancount-balance.ts` (new, pure)**
- Types for the rows it needs: completed reconciliations, bank-account → GL account, GL lines with the entry's date, currency, `posted_at`, status and `voided_at`.
- `balanceAssertions(input)` returns, per completed reconciliation, either `{ kind: "balance", date, accountId, amountMinor, currencyCode, statementDate, statementMinor, unclearedCount, reconciliationId }` or `{ kind: "skipped", reason, … }`.
- `nextDay(date)` for ISO dates.

**`lib/domain/beancount.ts`**
- `BeancountInput` gains `assertions` (from `balanceAssertions`).
- A new line kind: `{ kind: "balance"; text; accountId; accountStart; accountEnd; reconciliationId }`. Its comment line is `{ kind: "reconciliation"; text; reconciliationId }`.
- The builder writes the section above and moves `open` dates as described. It is still the only builder, so the file on screen and the file handed over cannot differ.

**`lib/services/beancount.ts`**
- Paged reads, in total order:
  - `acc_statement_reconciliation` (completed only);
  - `acc_bank_account`;
  - `acc_reconciliation_line` (which lines each session cleared);
  - the lines on those GL accounts, embedding the entry's date, currency, status, `posted_at` and `voided_at`, void entries included.
- The new tables join `BEANCOUNT_SOURCES`, so the audit record counts them.
- `readBeancountSummary` adds the number of completed reconciliations and the bank accounts that have none.

**`app/(app)/reports/beancount`**
- The stat row adds "Balance assertions".
- When some bank accounts have no completed reconciliation, a note names how many and links to Banking › Reconcile.
- On screen, a `balance` line's account opens its ledger, and its comment opens the reconciliation (`/banking/reconcile/<id>`).

**`lib/domain/changelog.ts`**: release 1.73.

Nothing posts, no migration, no new permission. The export keeps its rule: any failed read fails the whole file.

## 6. Proving it

1. **Unit tests** (`beancount-balance`, `beancount`)
   - The date is the day after the statement date, across a month and a year end.
   - A line posted after completion and dated inside the period is not counted.
   - A line voided after completion is counted; one voided before is not.
   - A void entry without `voided_at` on the account in the period gives a skip; elsewhere it changes nothing.
   - A session in progress writes nothing.
   - Two completed sessions on one account give two lines.
   - A non-base account or a foreign-currency line gives a skip.
   - The difference and the uncleared count in the comment (lines cleared by an earlier completed session are not counted).
   - `open` dates move back when an assertion is earlier than the first entry.
   - The section's exact text, with invented figures.
2. **`bean-check` on real books**, files kept in the scratchpad and never committed:
   - the company with the completed reconciliation: clean means its books have not changed in that period since completion, and a failure is a finding to report;
   - a copy of that file with one extra invented transaction in the reconciled month must fail.
3. **Smoke sweep and screenshots** of Reports › Beancount (light and dark), shown before any push.

## 7. Constraints

- US English UI. No hex colours outside the token block. Paged reads.
- No real client names or figures in repo files; test figures are invented.
- Stage files by name. No Co-Authored-By trailer.
- Out of scope: month-end assertions for accounts without a reconciliation, and assertions from closed periods.
