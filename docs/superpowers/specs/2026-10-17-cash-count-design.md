# Cash on hand is counted, and the count is dated (release 2.16)

## Why

This is item OB-8 of the engineering review (13 October): "Cash on hand has no counted-on date".

A till float is proved by counting it, not by a bank statement, so reconciliation never covers it and nothing ages it. On one client's books the cash account had not moved for well over a year, and nothing said so.

**Acceptance:**
- A cash account shows when it was last counted.
- Recording a count posts the variance rather than silently overwriting the balance.

**Decided with the user (17/10):**
- The variance goes to a new account, **7510 Cash Over and Short**. It is added to the chart template for new companies, and to every existing company by a migration that asks before it runs. Another account can be chosen at count time.
- A variance follows the company's **existing approval policy**, the same way Stock Count (1.96) does.
- The **Count cash** button appears on the Chart of Accounts row of a cash account, and on the Balance Sheet's bank and cash panel.

**What counts as a cash account:** an account with `account_type = 'bank'` and `detail_type = 'cash_on_hand'` (template account 1000 Cash on Hand). Cash on hand cannot have a bank account record (0072), so Reconcile never shows it.

## Part 1: the database

### Journal source (its own migration)
- Add the journal source `cash_count`.
- It goes in a migration of its own, because a new enum value must commit before it is used (the 1.96 lesson, 0138).
- Every place that lists journal sources for display gets the new value. Find them the way 0138/0140 did.

### Account 7510
- Add `7510 Cash Over and Short` (`other_expense`, `system: true`, cash-flow role `operating`) to the chart template in `lib/domain/chart-templates.ts`.
- A migration inserts it into every existing company schema where no account has code 7510. If a company already uses code 7510 for something else, nothing is inserted and the count dialog asks for an account.
- `verify:company-provisioning` must stay green.

### `acc_cash_count` (table)

| Column | Holds |
|---|---|
| `id` | |
| `account_id` | References a cash-on-hand account |
| `counted_on date` | |
| `counted_minor` | |
| `book_minor` | The balance on that date, computed by the server |
| `difference_minor` | `counted − book` |
| `offset_account_id` | |
| `memo` | |
| `status` | `posted` or `pending_approval` |
| `journal_entry_id` | Null when the difference is zero |
| `approval_request_id` | |
| `created_by`, `created_at` | |

- A count with no difference posts no entry but is still recorded, because it still dates the count.
- "Last counted" is the latest `counted_on` with status `posted`.
- Row-level security: staff or a viewer may read; writes go through functions only.
- Writes are audited, in the 0124/0139 style.

### `acc_post_cash_count(p_account_id, p_counted_on, p_counted_minor, p_offset_account_id, p_memo)`
- **Who:** staff only.
- **Account:** must be a cash-on-hand account in the base currency.
- **Date:** `p_counted_on` on or before the company's today, and in an open period.
- **Book balance:** computed on the server at that date. The difference posts Dr/Cr cash against the offset account, with source `cash_count`. The balance is never overwritten.
- **Approval:** if `acc_approval_required('cash_count', |difference|)` and the call is not inside the approval dispatch, the count is saved as `pending_approval` with an approval request, and nothing posts until it is approved. Approving posts it through the dispatch, exactly as Stock Count does.
  - Add the `cash_count` action to the approval policy list for every company, **disabled by default** with the same default threshold Stock Count's policy uses, so nothing changes until an admin turns it on.
  - Rejecting a request leaves the count unposted and marked so.

### `acc_cash_accounts_standing(p_as_of date)` (read)
- One row per cash-on-hand account: account, balance at `p_as_of`, last counted date, counted amount, difference at that count, and days since.
- Readable by staff and viewers.

Grants for every new function: `revoke all … from public, anon` and `grant execute … to authenticated, service_role`.

## Part 2: the app

**Count cash dialog.**
- Fields: date (default today in the company's zone), counted amount, offset account (default 7510), memo.
- As the amount is typed, the dialog shows the book balance at that date and the variance, live.
- The button says **Record count**. When the policy applies, it says that the count will wait for approval.
- After posting, a message names the entry, or says "No difference; the count is recorded."

**Chart of Accounts.**
- A cash account's row shows "Last counted {date}" or "Never counted", and offers **Count cash**.
- A list of the account's counts is reachable from the row: date, counted, book, difference, entry, by.

**Balance Sheet bank and cash panel (OB-3's panel).** Cash accounts get a line in the same style as the banks:

> Cash on Hand: last counted Aug 3, 2026 ($1,250.00). Count it again.

> Cash on Hand: never counted · $1,250.00

- The line is amber after 90 days since the last count, or when the account was never counted and holds a balance.
- It uses the shared tone and sentence helpers.

**Copy and time.**
- US English.
- Dates and times in the company's time zone; never format without a zone.
- Money formatted with the existing helpers.
- On a phone, every table holds its width and scrolls inside its own box (the 2.11 lesson).
- No PDF module is imported into these client screens (the 2.11 lesson).

## Tests

- **Domain:**
  - variance sign;
  - the 90-day tone;
  - "never counted" with and without a balance;
  - the dialog's live variance;
  - amount parsing (no silent zero).
- **Migration tests:**
  - the enum value in its own file;
  - the 7510 backfill inserts only where the code is free;
  - table RLS and grants;
  - the function's role, account, date and period checks;
  - the approval branch.
- **Rolled-back verification on the sample company only:**
  - a count with a shortfall posts Dr 7510 / Cr cash for the difference;
  - an overage posts the reverse;
  - a zero difference posts nothing but dates the count;
  - with the policy on, a large difference waits for approval, and approving it posts it;
  - a viewer cannot count.

  Other schemas: structure only.
- **Smoke on PC-Test, with screenshots:** count PC-Test's cash on hand with a small invented difference, then see the Chart of Accounts row, the Balance Sheet line and the count list. Keep the count as demo data, as 2.12's scenario was kept.

## Not in this release

- OB-9 (balance comparison).
- Foreign-currency cash.
- Changing the dashboard's unreconciled-bank figure, which counts cash today. It gets a follow-up note.
