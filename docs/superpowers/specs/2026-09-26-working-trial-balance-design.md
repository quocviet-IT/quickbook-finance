# Working Trial Balance

- Date: 2026-09-26
- Status: Design, pending review
- Source of requirements: `Accounting-System-v3.html`, the client's single-file
  prototype:
  - the report — "working-paper trial balance", lines 8766–8868
  - the checkbox on an entry — lines 5707–5713
  - the toggle and its closed-period check — `"adj-toggle"`, line 11893, and
    `allowChange`, line 8043
  - the note — `"adj-note"`, line 12642
  - depreciation posted as an adjusting entry — line 8947
- Third of the ten modules the prototype specifies and OneBook lacks. The first
  migration in this series.
- Direction from the client: implement **exactly as the prototype specifies**.
  Where OneBook cannot do literally what the prototype does, this document says
  so and says why (§7).

## 1. The requirement, in the prototype's words

> The accountant's three columns: what the books said before you touched them,
> what you adjusted, and what they say now. An entry counts as an adjustment
> because somebody marked it one — not because of its date or its shape — so the
> middle column is a decision, which is what makes it worth reviewing.

And from the report's own footer:

> An entry is an adjustment because you said so. Open one on the Transactions
> tab and tick *adjusting entry*, with a note saying why. Nothing is inferred from
> the date or the accounts, so the middle column is a list of decisions somebody
> made and can defend.

## 2. The constraint: marking changes no figure

Marking an entry adjusting moves it between two columns of one report. It must
not change any balance anywhere.

1. **The mark lives in its own table**, `acc_adjusting_entry`, never as a column
   on `acc_journal_entry`. Marking or unmarking therefore touches no ledger row and
   fires no ledger trigger.
2. **The mark is written only through two RPCs.** The table has a read policy and
   no write policy, so an application session cannot write it directly — the
   containment `acc_saved_report` (migration 0101) already uses.
3. **The report is read-only** and draws its totals from `acc_ledger_balances`,
   the aggregate the Trial Balance and Balance Sheet already use, so the three
   reports cannot disagree about a balance.
4. **One existing function is redefined**: `acc_post_asset_depreciation`, to mark
   the entry it posts (§5). Its body is copied verbatim from migration 0050; the
   single added statement inserts a row into `acc_adjusting_entry`. The posting
   itself — its lines, amounts, accounts and guards — is unchanged.

## 3. Data

Migration `0124_adjusting_entries.sql`.

**Table `acc_adjusting_entry`:**

| Column | Type | Meaning |
|---|---|---|
| `journal_entry_id` | `uuid` primary key, references `acc_journal_entry(id)` | the entry marked |
| `note` | `text`, nullable, at most 500 characters | "Why it was adjusted" |
| `marked_by` | `uuid`, nullable | who marked it; null when the system did (§5) |
| `marked_at` | `timestamptz` | when |

The note is **optional**, as in the prototype: its input has a placeholder and no
required check, and the report falls back to the entry's description when it is
empty (`adjNote(t) || t.narration`).

**RLS:** a read policy matching `acc_journal_entry`'s own, so whoever can read the
ledger can read its marks. No insert, update or delete policy.

**Every company schema.** `scripts/migrate.mjs` loops the company register, so
the migration reaches every company; `npm run verify:company-provisioning` is run
afterwards, as `CLAUDE.md` requires after a migration.

## 4. Marking and unmarking

**RPC `acc_mark_adjusting(p_entry_id uuid, p_note text, p_confirm_closed boolean default false)`**

- Requires `acc_has_permission('journal.post')` — whoever may post a manual
  journal may classify one.
- The entry must exist and be `posted`. A voided entry is refused.
- A blank note is stored as null.
- **An entry already marked has only its note replaced.** This is the prototype's
  `adj-note` handler, which saves the note as it is typed and does not consult the
  closed-period check.
- **Marking an entry not yet marked** in a closed period
  (`acc_is_period_closed(entry_date)`) raises an error carrying the code
  `closed_period` unless `p_confirm_closed` is true. This is the prototype's
  `allowChange`: the change is allowed once the user confirms.
- Writes one audit row: `table_name = 'acc_adjusting_entry'`, `action` =
  `mark_adjusting` or `edit_adjusting_note`, `before_json` / `after_json` holding
  the entry id, entry number, note and whether the period was closed.

**RPC `acc_unmark_adjusting(p_entry_id uuid, p_confirm_closed boolean default false)`**

- Same permission.
- Deletes the mark, and with it the note — the prototype's toggle deletes
  `adjNote` when it clears `adj`.
- The same closed-period rule and confirmation as marking.
- Audit `action = 'unmark_adjusting'`, with the removed note in `before_json`.

A later void of a marked entry leaves the mark in place; the report reads posted
entries only, so a voided entry falls out of every column.

## 5. Depreciation is an adjusting entry

The prototype's fixed-asset register posts depreciation with
`adj:true, adjNote:"Depreciation for <period>"`, and its guide says the charge
"posts as an adjusting entry, so it lands in the middle column of the working
trial balance". OneBook already has the register; it does not mark its entries.

- `acc_post_asset_depreciation(p_asset_id, p_through_date)` is redefined with its
  body copied verbatim from 0050 and one statement added after each entry it
  posts: insert into `acc_adjusting_entry` with note
  `'Depreciation through ' || p_through_date` and `marked_by` null. The batch
  function calls this one, so it is covered.
- **Backfill.** Depreciation entries already posted are marked by the migration,
  with the entry's own description as the note and `marked_by` null. They were
  adjusting entries under the prototype's definition when they were posted.

## 6. Where the mark is made

The prototype puts it on the expanded entry card in the Transactions tab. OneBook's
equivalent is an entry opened in the Journal report — `/reports/journal?entry=<id>`,
the drill-through every report already uses. On that view, for a user with
`journal.post`:

- A checkbox **"Adjusting entry"**.
- When ticked, an input with the placeholder **"Why it was adjusted"**, saved when
  the field loses focus.
- A user without the permission sees whether the entry is adjusting and its note,
  and no controls.

**Closed period.** When the RPC answers `closed_period`, the view shows the
prototype's banner:

> **<date> is in a closed period.** The books are closed through <date>. Changing
> that entry will alter a period somebody has already signed off.
> [Unlock and change it]

Pressing the button retries with `p_confirm_closed = true`, and the page remembers
the confirmation for the rest of the visit — the prototype's *"asks once, then
remembers for the rest of this sitting, so coding twenty old entries is not twenty
prompts"*. Every change made that way is audited with the period marked closed.

## 7. The report

Route `/reports/working-trial-balance`, title **Working Trial Balance**, in the
Accounting group of the reports catalogue.

**Range.** From and To, defaulting to the start of the current fiscal year through
today.

**Rows.** One per account with a non-zero figure in any column:

- **Unadjusted** — for a balance-sheet account, its balance on the day before
  From plus its movements in the range from entries **not** marked adjusting; for
  an income or expense account, only those movements in the range.
- **Adjustments** — movements in the range from entries marked adjusting.
- **Adjusted** — the sum of the two.

Each shown as a Debit / Credit pair, in base currency.

**One necessary departure, and why.** The prototype carries balance-sheet balances
forward and starts income and expense afresh. That balances only because the
prototype posts a closing entry each year moving the result into retained
earnings (line 9080). OneBook posts no closing entry: its Balance Sheet shows the
accumulated result as a computed "Current earnings" line. Carrying balances the
prototype's way in OneBook would leave the Unadjusted column out of balance by
exactly the profit or loss of every earlier period, and contradict the prototype's
own check that *"debits equal credits in all three column pairs"*.

So the report adds one line, **Retained earnings — before this period**: the net
of every income and expense account up to the day before From, in the Unadjusted
column. It is the same device the Balance Sheet already uses, and it is what lets
the prototype's balance check hold.

**Figures above the table**, as in the prototype: **Accounts**, **Adjusting
entries**, **Adjusted total**.

**Totals row** for all six columns, then a footer:

> **An entry is an adjustment because you said so.** Open one in the Journal
> report and tick *Adjusting entry*, with a note saying why. Nothing is inferred
> from the date or the accounts, so the middle column is a list of decisions
> somebody made and can defend, which is the only version worth putting in front
> of a reviewer.

followed by *"Debits equal credits in all three column pairs."* — or, if any pair
disagrees, *"Note: the columns do not agree, which should not happen while every
entry balances."* The wording is the prototype's, with "the Transactions tab"
replaced by where OneBook puts the checkbox.

**The adjustments**, listed under the table as the prototype does: columns
**No.** (AJE 1, AJE 2 … in date order), **Date**, **Name**, **Account**,
**Debit**, **Credit**, **Why** — one row per posting, the first posting of each
entry carrying its number, date, name and reason. Why is the note, or the entry's
description when there is none. A row opens the entry.

**Empty state** when the range has no figures, as the prototype's `emptyReport()`.

**CSV export** through `csvWithReportIdentity`, as every other report.

### 7.1 How the report is computed

Totals come from the aggregate the other reports trust; only the small adjusting
part is read separately.

| Read | Gives |
|---|---|
| `acc_ledger_balances(null, From − 1 day)` | balances before the range |
| `acc_ledger_balances(From, To)` | every movement in the range |
| marks joined to posted entries dated in the range, with their lines | the Adjustments column and the list under the table |
| `acc_transaction_list(From, To)` | the Name of each adjusting entry |

Unadjusted = carried-forward balance + movement − adjustment; Adjusted =
Unadjusted + adjustment. Amounts are base currency, read the way
`acc_ledger_balances` reads them. Every read is paged.

## 8. Architecture

| File | Responsibility |
|---|---|
| `supabase/migrations/0124_adjusting_entries.sql` | Table, RLS, the two RPCs, the depreciation redefinition, the backfill. |
| `lib/domain/working-trial-balance.ts` | Pure: builds rows, the retained-earnings line, totals and balance checks from already-read data. |
| `lib/services/working-trial-balance.ts` | The reads of §7.1, paged. |
| `lib/services/adjusting-entries.ts` | Calls the two RPCs; turns `closed_period` into a typed result the screen can act on. |
| `app/(app)/reports/working-trial-balance/` | Page, client, action. |
| The Journal report's entry view | The checkbox, the note, the closed-period banner. |
| `lib/domain/report-catalog.ts`, `lib/domain/changelog.ts` | Catalogue entry; release 1.64. |

## 9. Testing

- **Domain, by concrete figures:** a balance-sheet account carries forward and an
  income account does not; an entry marked adjusting lands only in the middle
  column; a marked entry dated outside the range is ignored; the retained-earnings
  line equals the prior net result; **all three column pairs balance** for a
  constructed book that includes prior-period profit.
- **The AJE list:** numbered in date order; Why falls back to the description when
  the note is empty.
- **Service, with a stub:** reads are paged; a read failure fails the report.
- **The migration, on the real database, leaving nothing behind:** a
  `scripts/verify-adjusting-entries.mjs` in the repository's established pattern
  — run inside a transaction that is rolled back — proving: marking and
  unmarking; the note-only update; refusal without `journal.post`; refusal of a
  voided entry; the `closed_period` refusal and the confirmed override; an audit
  row for each; that posting depreciation marks its entry; and that no
  `acc_journal_entry` or `acc_journal_line` row changed.
- `npm run verify:company-provisioning` after the migration is applied.
- Build, typecheck, lint, the full unit suite, and the page smoke sweep.

## 10. Out of scope

A tick box on the manual-journal form: the prototype marks entries on the entry
card, not in its draft editor (`saveDraft` carries no `adj`). The closing-year,
stock-count and prepayment entries that the prototype also posts as adjusting:
those modules do not exist in OneBook yet, and each will mark its own entries when
it is built.
