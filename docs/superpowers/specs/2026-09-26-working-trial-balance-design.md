# Working Trial Balance

- Date: 2026-09-26, revised 2026-09-28
- Status: Design, approved 2026-09-28
- Source of requirements: `Accounting-System-v3.html`, the client's single-file
  prototype:
  - the report — `reportWorkingPapers` and `wpRows`, "working-paper trial
    balance", lines 8766–8868; listed in the report menu at line 2462
  - the checkbox on an entry card — lines 5707–5713
  - the toggle and its closed-period check — `"adj-toggle"`, line 11893;
    `allowChange` and `lockBanner`, lines 8036–8075
  - the note — `"adj-note"`, line 12642
  - the empty state — `emptyReport`, line 1388
  - depreciation posted as an adjusting entry — line 8947
- Third of the ten modules the prototype specifies and OneBook lacks. The first
  migration in this series.
- Direction from the client: implement **exactly as the prototype specifies**,
  its presentation as well as its logic. Where OneBook cannot do literally what
  the prototype does, this document says so and says why.

### What the revision changed

The first draft was written before the Exception Report and Beancount Export
were reworked (release 1.64), and followed the prototype's logic more closely
than its screens. This revision:

- moves the checkbox to where the prototype has it — the entry card, which in
  OneBook is the expanded row of the Journal screen — instead of the Journal
  *report* (§6);
- gives the closed-period banner both of the prototype's buttons (§6);
- lays the report out as `reportWorkingPapers` does, with the period picker,
  the paper, the figures, the two-row header and the adjustments list, reusing
  what 1.64 built: `ReportPaper`, `StatRow`, `PERIOD_PRESETS`,
  `EntryDetailDrawer` (§7);
- exports PDF, Excel and CSV like the Exception Report (§7);
- marks depreciation with a trigger instead of redefining the posting
  function — approved 2026-09-28 (§5).

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
   on `acc_journal_entry`. Marking or unmarking touches no ledger row and fires
   no ledger trigger.
2. **The mark is written only through two RPCs** and one trigger (§5). The table
   has a read policy and no write policy, so an application session cannot write
   it directly — the containment `acc_saved_report` (migration 0101) uses.
3. **The report is read-only** and draws its totals from `acc_ledger_balances`,
   the aggregate the Trial Balance and Balance Sheet use, so the three reports
   cannot disagree about a balance.
4. **No posting function is redefined.** Depreciation is marked by a trigger
   that writes only to `acc_adjusting_entry` (§5).

## 3. Data

Migration `0124_adjusting_entries.sql`.

**Table `acc_adjusting_entry`:**

| Column | Type | Meaning |
|---|---|---|
| `journal_entry_id` | `uuid` primary key, references `acc_journal_entry(id)` | the entry marked |
| `note` | `text`, nullable, at most 500 characters (check constraint) | "Why it was adjusted" |
| `marked_by` | `uuid`, nullable | who marked it; null when the system did (§5) |
| `marked_at` | `timestamptz not null default now()` | when |

The note is **optional**, as in the prototype: its input has a placeholder and no
required check, and the report falls back to the entry's description when it is
empty (`adjNote(t) || t.narration`).

**RLS and grants:** RLS enabled; one select policy matching
`acc_journal_entry_read` (`acc_current_role() is not null`), so whoever can read
the ledger can read its marks. No insert, update or delete policy. `revoke all …
from public, anon`; `grant select … to authenticated`; `grant all … to
service_role` — the pattern `tests/unit/migration-grants.test.ts` enforces.

**Every company schema.** `scripts/migrate.mjs` loops the company register, so
the migration reaches every company; `npm run verify:company-provisioning` is run
afterwards.

## 4. Marking and unmarking

Both RPCs are `security definer`, `set search_path = public`, revoked from
`public, anon`, granted to `authenticated`.

**`acc_mark_adjusting(p_entry_id uuid, p_note text, p_confirm_closed boolean default false)`**

- Requires `acc_has_permission('journal.post')` — whoever may post a manual
  journal may classify one.
- The entry must exist and be `posted`. A voided entry is refused.
- The note is trimmed; a blank note is stored as null; more than 500 characters
  is refused.
- **An entry already marked has only its note replaced.** This is the prototype's
  `adj-note` handler, which saves the note as it is typed and does not consult the
  closed-period check.
- **Marking an entry not yet marked** in a closed period
  (`acc_is_period_closed(entry_date)`) raises an error whose message is
  `closed_period:<entry date>:<end of that closed period>` (ISO dates) unless
  `p_confirm_closed` is true. This is the prototype's `allowChange`: the change is
  allowed once the user confirms.
- Writes one `acc_audit_log` row: `table_name = 'acc_adjusting_entry'`,
  `record_id` = the entry id, `actor_id = auth.uid()`, `action` =
  `mark_adjusting` or `edit_adjusting_note`, `before_json` / `after_json` holding
  the entry number, the note, and whether the period was closed.

**`acc_unmark_adjusting(p_entry_id uuid, p_confirm_closed boolean default false)`**

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

**A trigger, not a redefinition.** `acc_post_asset_depreciation` (migration 0050)
is reached three ways — one asset, the batch, and the catch-up charge when an
asset is disposed of. Rather than copy that function to add one statement, the
migration adds:

- `acc_mark_depreciation_adjusting()` — a `security definer` trigger function
  that inserts `(new.id, new.description, null)` into `acc_adjusting_entry`, doing
  nothing if a mark already exists.
- `after insert on acc_journal_entry for each row when (new.source_type =
  'depreciation')`.

The posting functions are untouched. Every depreciation entry, from any of the
three paths and any added later, is marked; its note is the entry's own
description (`Depreciation FA-0001 - Sep 2026`). A user may unmark one like any
other entry — the trigger fires on insert only.

**Backfill.** Depreciation entries already posted are marked by the migration,
note = description, `marked_by` null. They were adjusting entries under the
prototype's definition when they were posted.

## 6. Where the mark is made

The prototype puts the checkbox on the expanded entry card in the Transactions
tab, beside Edit, Class and Open detail — where somebody acts on an entry. In
OneBook that is the **expanded row of the Journal screen** (`/journal`), which
already carries the entry's lines, its attachments and Reverse, and which
`/journal?entry=<id>` opens on one entry. The Transaction detail sheet links there
("Open in Journal"), so a reviewer goes adjustment row → sheet → Journal.

In the expanded row, under the lines:

- For a user with `journal.post`: a checkbox **"Adjusting entry"**; when ticked,
  an input with the placeholder **"Why it was adjusted"**, saved when the field
  loses focus. Voided entries show no controls.
- For anyone else: whether the entry is adjusting, and its note; no controls.
- In the list itself, an **adjusting** tag in the Status column, so marked
  entries can be found without opening each. (Not in the prototype, whose list has
  no indicator; added because OneBook's journal is long.)

The list reads each entry's mark with the entry (an embedded select on
`acc_adjusting_entry`), so the tag and the checkbox need no second request.

**Closed period.** When an RPC answers `closed_period:`, the Journal screen shows
the prototype's banner above the list:

> **<date> is in a closed period.** The books are closed through <date>. Changing
> that entry will alter a period somebody has already signed off.
> [Unlock and change it] [Leave it alone]

"Unlock and change it" retries with `p_confirm_closed = true` and remembers the
confirmation for the rest of the visit — the prototype's *"asks once, then
remembers for the rest of this sitting, so coding twenty old entries is not twenty
prompts"*. "Leave it alone" dismisses the banner and leaves the checkbox as it was.
Every change made after unlocking is audited with the period marked closed.

"The books are closed through <date>" names the end of the closed period the entry
falls in, which the RPC's message carries.

## 7. The report

Route `/reports/working-trial-balance`, title **Working Trial Balance**, in the
Accounting group of the reports catalogue, beside the Exception Report.

**Layout**, following `reportWorkingPapers` and the 1.64 reports:

1. **Filter bar:** the period picker (`PERIOD_PRESETS`: This month … All dates,
   Custom), From, To, Run; on the right PDF, Excel, CSV. Default: This year.
2. **The paper** (`ReportPaper`): company, "Working Trial Balance", the range in
   words, "Accrual basis · USD".
3. **Figures** (`StatRow`): **Accounts** (rows shown), **Adjusting entries**
   (in the danger colour when there are any, as the prototype's `neg`),
   **Adjusted total** (the adjusted debit total).
4. **The table.** A two-row header: Account (spanning both rows), then
   **Unadjusted**, **Adjustments**, **Adjusted**, each over Debit and Credit.
   Adjustment figures are coloured when non-zero; adjusted figures are bold. A
   **Total** row with a rule above and a double rule below. Account names open the
   account's General Ledger for the range in a new tab.
5. **The adjustments**, under an eyebrow heading, only when there are any:
   **No.** (AJE 1, AJE 2 … in date order), **Date**, **Name**, **Account**,
   **Debit**, **Credit**, **Why** — one row per posting; the first posting of each
   entry carries its number, date, name and reason. Why is the note, or the entry's
   description when there is none. Clicking a row opens the entry in the
   Transaction detail sheet.
6. **Footer:**

   > **An entry is an adjustment because you said so.** Open one on the Journal
   > screen and tick *Adjusting entry*, with a note saying why. Nothing is
   > inferred from the date or the accounts, so the middle column is a list of
   > decisions somebody made and can defend, which is the only version worth
   > putting in front of a reviewer.

   followed by *"Debits equal credits in all three column pairs."* — or, if any
   pair disagrees, *"Note: the columns do not agree, which should not happen while
   every entry balances."* The wording is the prototype's, with "the Transactions
   tab" replaced by where OneBook puts the checkbox. "Journal screen" links to
   `/journal`.

**Empty state**, inside the paper when no row has a figure — the prototype's
`emptyReport`: *"No entries fall in this period. Add entries on the Journal
screen, or widen the date range."*

**Rows.** One per posting account with a non-zero figure in any column:

- **Unadjusted** — for an asset, liability or equity account, its balance on the
  day before From plus its movements in the range from entries **not** marked
  adjusting; for an income or expense account, only those movements.
- **Adjustments** — movements in the range from entries marked adjusting.
- **Adjusted** — the sum of the two.

Each shown as a Debit / Credit pair in base currency: a positive net is a debit,
a negative net a credit, as `dr`/`cr` in the prototype.

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
and Adjusted columns. It is the same device the Balance Sheet uses, and it is what
lets the prototype's balance check hold. It is omitted when it is zero.

**Exports.** One `ReportExportSheet` feeds PDF, Excel (`ReportExportButtons`) and
CSV (`csvFromExportSheet`): the six columns and the total, then the adjustments.

### 7.1 How the report is computed

| Read | Gives |
|---|---|
| `acc_ledger_balances(null, From − 1 day)` | balances before the range (all zero when nothing is dated before From) |
| `acc_ledger_balances(From, To)` | every movement in the range |
| `acc_adjusting_entry` joined to posted entries dated in the range, with their lines | the Adjustments column and the list under the table |
| `acc_transaction_list(From, To)` | the Name of each adjusting entry (party, else description — `entryDisplayName`) |

Unadjusted = carried-forward balance + movement − adjustment; Adjusted =
Unadjusted + adjustment. An adjusting line's base amount is read exactly as
`acc_ledger_balances` reads it: `amount_base_minor` counted as a debit when the
line's `debit_minor > 0` and as a credit when its `credit_minor > 0`. Every read is
paged past PostgREST's 1,000-row cap. Any failed read fails the whole report — a
trial balance missing a read is a wrong trial balance, not a partial one.

## 8. Architecture

| File | Responsibility |
|---|---|
| `supabase/migrations/0124_adjusting_entries.sql` | Table, RLS, grants, the two RPCs, the trigger, the backfill. |
| `lib/domain/working-trial-balance.ts` | Pure: rows, the retained-earnings line, totals, the balance check, the AJE list, the export sheet. |
| `lib/services/working-trial-balance.ts` | The reads of §7.1, paged. |
| `lib/services/adjusting-entries.ts` | Calls the two RPCs; turns `closed_period:` into a typed result the screen can act on. |
| `app/(app)/reports/working-trial-balance/` | Page, client, action. |
| `app/(app)/journal/` and `lib/services/journal.ts` | The mark read with each entry; the checkbox, note, tag and banner; the two actions. |
| `lib/domain/report-catalog.ts`, `lib/domain/changelog.ts` | Catalogue entry; release 1.65. |

## 9. Testing

- **Domain, by concrete figures:** a balance-sheet account carries forward and an
  income account does not; an entry marked adjusting lands only in the middle
  column; a marked entry dated outside the range is ignored; the retained-earnings
  line equals the prior net result; **all three column pairs balance** for a
  constructed book that includes prior-period profit; a foreign-currency
  adjusting line is counted at its base amount.
- **The AJE list:** numbered in date order; Why falls back to the description when
  the note is empty; only the first posting carries number, date, name and why.
- **Purity:** the domain module imports nothing from `@/lib/db` or
  `@/lib/services`.
- **Service, with a stub:** reads are paged; a failed read fails the report.
- **The migration, on the real database, leaving nothing behind:**
  `scripts/verify-adjusting-entries.mjs` in the repository's established pattern —
  inside a transaction that is rolled back — proving: marking and unmarking; the
  note-only update; refusal without `journal.post`; refusal of a voided entry;
  the `closed_period:` refusal and the confirmed override; an audit row for each;
  that posting depreciation marks its entry; and that no `acc_journal_entry` or
  `acc_journal_line` row changed.
- `npm run verify:company-provisioning` after the migration is applied.
- Build, typecheck, lint, the full unit suite, the page smoke sweep and
  `verify:table-fit`.
- **Screenshots before claiming done:** the report in light and dark, on a real
  company, the adjustments list opening the sheet, and the Journal row with the
  checkbox and the closed-period banner — reviewed, and shown to the client.

## 10. Out of scope

A tick box on the manual-journal form: the prototype marks entries on the entry
card, not in its draft editor (`saveDraft` carries no `adj`). The closing-year,
stock-count and prepayment entries that the prototype also posts as adjusting:
those modules do not exist in OneBook yet, and each will mark its own entries when
it is built.
