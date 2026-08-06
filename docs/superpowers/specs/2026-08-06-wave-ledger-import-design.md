# Importing a Wave general ledger

Date: 2026-08-06
Slice 4 of 4 in the import work (guidance → bank transactions → saved reports → **general ledger**).

## Where this came from

Feedback report `428ca4db-a090-417a-8ed6-a40ef4f7d81e` (2026-08-04, `/settings/import`):

> Hi Viet, could you please give me information on what to do here, do i need
> to import each of these separately or one file for all of them?

The file behind that question is attached to the report: *Pacific Four Nine (2.0)
Account Transactions*, 3,284 lines. They tried to load it into the Chart of
accounts tab. Slice 1 explained the tabs, slice 2 built a tab for a *categorized
transactions* export, and slice 3 gave a report somewhere to live. None of them
can read this file, so the report stayed open.

## What the file actually is

Measured, not assumed — every number below comes from the real file:

| | |
|---|---|
| Accounts (sections) | 26 |
| Data rows | 3,154 |
| Rows carrying no money | 198 |
| Rows with both a debit and a credit | 0 |
| Distinct dates | 554 |
| Dates where debits ≠ credits | **0** |
| Total debits | $53,182,909.72 |
| Total credits | $53,182,909.72 |
| Date range | 2022-12-31 → 2025-12-31 |
| Encoding | UTF-8 with BOM |

It is a **complete, balanced general ledger**. Each row is *one side* of a double
entry; the other side is a row in another account's section. That is why no
column mapping can read it: slice 2's file carries both sides on every row, and
this one never does.

### The layout, and its three traps

```
ACCOUNT NUMBER,DATE,DESCRIPTION,DEBIT (…),CREDIT (…),BALANCE (…)
121 - PC49 BoA CK 3388,,,,,          <- first account: name in column 0
,,,,,$0.00
,12/31/2022,Beginning Balance,"$968,798.29",,"$968,798.29"
…
Totals and Ending Balance,,,"$16,533,569.28","$16,437,275.43","$96,293.85"
Balance Change,,,"$96,293.85",,
,,,,,
,123 - PC49 Relay CK 6764,,,,        <- every later account: name in column 1
Starting Balance,,,,,$0.00
…
Payroll Processing Fee,8/29/2024,CHECKCARD 0828…,$51.00,,$51.00   <- name repeated per row
```

1. **The first account's name is in column 0; every later account's name is in
   column 1**, the DATE column. One rule covers both: a row with exactly one
   non-empty cell, in column 0 or column 1, that is not a marker and not a date.
2. **`Starting Balance`, `Totals and Ending Balance` and `Balance Change` sit in
   column 0**, where an account name also sits.
3. **One account repeats its name on every data row** (`Payroll Processing Fee`).
   The section header is authoritative; column 0 on a data row is ignored.

One more trap, invisible until it refuses an import: the account
`Taxes – Corporate Tax` uses an **en dash**, not a hyphen. A chart holding
`Taxes - Corporate Tax` would not match it.

## Goal

An administrator or accountant drops this file on a General ledger tab, sees
what it will do, chooses whether to bring the whole history or only closing
balances, and imports it in one action. A file already imported cannot be
imported again. An import that turns out to be a mistake can be undone.

## Not in scope

- **No pairing of rows into transactions.** See below.
- **No account creation.** An account the chart does not have refuses the whole
  file, listing what is missing — the rule slice 2 established.
- **No general "void any journal entry" door.** Undo covers the entries one
  import created, and nothing else.
- **No support for a partial or unbalanced export beyond refusing it.** A file
  whose dates do not balance is reported, not guessed at.

## Architecture

### Why entries are grouped by date

Each row is half a transaction, so posting requires knowing which halves belong
together. Matching on date, amount and description is guesswork: 3 January 2023
alone holds several distinct Zelle rows of $10.00 and several of $320.00, and a
wrong pairing produces books that balance while describing something that never
happened.

The data answers the question instead. **All 554 dates balance exactly** —
debits equal credits on every single one, with no exceptions. So the file is
posted as **one journal entry per date**, holding every line of that date. No
pairing is guessed, no suspense account is invented, and each line keeps its own
account and description, which is what makes the history searchable afterwards.

The alternative considered and rejected: one entry per row against a suspense
account. It balances overall (the file's totals are equal) but every entry
carries a fictional second leg, and the suspense account collects 3,154 lines
that mean nothing.

### Two modes, and what stops both being run

The person importing chooses:

- **Whole history** — 554 entries, 2,956 lines, `source_type = 'manual'`. Each
  entry is dated as the file dates it, described as
  `Wave general ledger — <file name>`.
- **Closing balances only** — one entry, 26 lines, `source_type =
  'opening_balance'`, dated as of a date the user picks (default: the file's
  last date). The net per account is what the file's own
  *Totals and Ending Balance* rows report.

Two modes on one file invites running both and posting everything twice. It
cannot happen: `acc_import_batch` records the file's `sha256`, and a file with a
live batch is refused **whatever mode is chosen**. The refusal names when it was
imported and by whom.

In this file the per-account nets sum to zero, so the balances entry needs no
plug. A file that does not balance that way puts the difference to **3900
Opening Balance Equity**, and the screen states the amount before the import
runs — the same convention `acc_post_opening_balances` already uses.

### One RPC, one transaction

The compact payload for the real file is **229,842 bytes**, well under the
Server Action body limit, so the whole file goes in a single call and posts
inside a single transaction. All of it lands or none does. A closed period, an
unknown account or an unbalanced date rolls the entire file back rather than
leaving a half-imported ledger nobody can reconcile.

`acc_resolve_account_ref` (migration 0100) is widened to treat en and em dashes
as hyphens when comparing, so `Taxes – Corporate Tax` resolves against a chart
written with either. It already matches by code, by `code - name` and by name.

### Undo

Nothing in One Book can currently void a plain journal entry — the void
functions all belong to documents. Importing three years of ledger with no way
back would be a feature nobody dares press.

So `acc_import_batch_entry` records every entry a batch created, and
`acc_void_import_batch(p_batch_id, p_reason)` voids exactly those. Voiding
follows the existing rule: the entry flips to `status = 'void'`, reports read
`posted` entries only, and the lines stay in `acc_journal_line` forever. The
batch keeps its row with the reason and the actor, and its `sha256` is freed so
a corrected export can be imported.

### Data — migration `0102_import_ledger_batches.sql`

```sql
create table acc_import_batch (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('wave_ledger')),
  mode          text not null check (mode in ('history', 'balances')),
  file_name     text not null,
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  entry_count   int  not null check (entry_count >= 0),
  line_count    int  not null check (line_count >= 0),
  from_date     date,
  to_date       date,
  -- Total debits posted, so a batch can be recognised at a glance without
  -- reading its entries back.
  total_minor   bigint not null check (total_minor >= 0),
  saved_report_id uuid references acc_saved_report (id),
  status        text not null default 'active' check (status in ('active', 'voided')),
  imported_by   uuid references auth.users (id),
  imported_at   timestamptz not null default now(),
  voided_by     uuid references auth.users (id),
  voided_at     timestamptz,
  void_reason   text
);

create unique index acc_import_batch_sha_idx
  on acc_import_batch (sha256) where status = 'active';

create table acc_import_batch_entry (
  batch_id         uuid not null references acc_import_batch (id) on delete cascade,
  journal_entry_id uuid not null references acc_journal_entry (id),
  primary key (batch_id, journal_entry_id)
);
```

Both tables are read under `acc_has_permission('documents.read')`; neither has an
insert, update or delete policy, so every write goes through a function.

Functions:

- `acc_import_ledger_entries(p_source text, p_mode text, p_file_name text,
  p_sha256 text, p_entries jsonb) returns jsonb` — refuses without `acc_is_staff()`;
  refuses a `sha256` with a live batch, naming the date it was imported; resolves
  every account reference and raises on the first it cannot find; posts each
  entry through `acc_post_entry`; records the batch and its entries; returns
  `{batch_id, entries, lines}`.
- `acc_void_import_batch(p_batch_id uuid, p_reason text) returns int` — refuses
  without `acc_is_staff()`; refuses an empty reason; voids each entry of the
  batch that is still posted; marks the batch `voided`; returns how many entries
  were voided.
- `acc_link_import_batch_report(p_batch_id uuid, p_report_id uuid)` — attaches
  the saved copy of the original file after the fact.

`p_entries` is `[{"date": "2023-01-03", "lines": [{"account": "121 - …",
"signed_minor": 100, "description": "…"}, …]}, …]`. A positive `signed_minor`
debits, a negative one credits — the same convention slice 2 uses.

### Modules

| File | Responsibility |
| --- | --- |
| `lib/domain/wave-ledger.ts` | Pure. `isWaveLedgerGrid(grid)` and `parseWaveLedger(grid)`, whose result carries the sections, the date-grouped entries and the per-account nets; `waveLedgerPayload(parse, mode, asOf)` picks which of the last two is sent. |
| `lib/services/ledger-import.ts` | `importLedgerBatch`, `listImportBatches`, `voidImportBatch`, `linkImportBatchReport`. Throws `LedgerImportError`. |
| `app/(app)/settings/import/LedgerImportPanel.tsx` | The preview: accounts, totals, problems, mode, the button. |
| `app/(app)/settings/import/ImportClient.tsx` | Modify. The `general_ledger` tab routes to the panel instead of the column mapper. |
| `app/(app)/settings/import/actions.ts` | Modify. `importLedgerAction`, `voidImportBatchAction`. |
| `lib/domain/import-mapping.ts` | Modify. `general_ledger` target and its label. |
| `lib/domain/import-shape.ts` | Modify. Point `looksLikeWaveAccountTransactions` at the new tab. |

The parser returns both shapes from one pass: `entries` (grouped by date) and
`balances` (net per account). The mode chooses which is sent; nothing is parsed
twice.

### Flow

The browser reads the file, runs `parseCsvGrid` then `parseWaveLedger`, and
shows the preview. Nothing has reached the server yet, so a file that turns out
to be the wrong shape costs one read.

On Import: the compact payload goes to the action, the action re-checks the role
and calls the RPC, and the RPC posts everything or nothing. On success the
browser saves the original file to Saved Reports through slice 3's flow and
calls `acc_link_import_batch_report`. If saving that copy fails the import still
stands and a warning says the copy was not kept — the ledger is the important
half, and pretending otherwise would mean voiding a correct import over a filing
error.

### Error handling

| Situation | What happens |
| --- | --- |
| A date whose debits ≠ credits | Blocked before any request, listing the dates and the difference |
| An account the chart does not have | Blocked, listing the names; nothing is created |
| The parser's totals disagree with the file's own *Totals and Ending Balance* rows | Blocked, naming the accounts that differ — the parser is wrong and must not post |
| A closed accounting period | `acc_post_entry` refuses; the whole file rolls back; the message names the period |
| The same file imported again | Refused, naming when it was imported and by whom |
| Rows carrying no money | Skipped, and the count is shown before the import |
| Saving the original copy fails | Warning; the import stands |
| A viewer tries any of it | Refused by the action and again by the RPC |

### Testing

**Unit — `tests/unit/wave-ledger.test.ts`.** A fixture at
`tests/fixtures/wave-account-transactions.csv`, hand-written to about forty rows
and carrying no real customer data, exercising: the first account named in
column 0, later accounts named in column 1, an account repeating its name on
every row, all three markers, a zero-amount row, money with commas and
parentheses, an en dash in an account name, and one deliberately unbalanced
date in a second fixture.

The real file is **not committed** — it is a customer's bank history. It is run
through the parser once during verification and the numbers reported.

**Migration — `tests/unit/ledger-import-migration.test.ts`.** Asserts the
migration posts only through `acc_post_entry`, gates on `acc_is_staff()`, gives
the tables no write policy, has no `delete from`, and carries the unique index on
an active `sha256`.

**Behavioural — `scripts/verify-ledger-import.mjs`.** Rollback-only, on the
pattern of `verify-import-transactions.mjs`. It proves:

1. A two-entry file posts, and every entry balances.
2. Importing the same file again is refused, and nothing new is posted.
3. An account the chart does not have refuses the whole file, with no entry left.
4. `acc_void_import_batch` voids every entry of the batch and returns the count.
5. After voiding, the same file can be imported again.
6. A viewer is refused both the import and the void.

**Gates.** `npm test`, `npm run typecheck`, `npm run lint`,
`npm run security:check-source`, `npm run build`, and `scripts/smoke-pages.mjs`
against the built server.

## Stated limits

- **The history mode posts into past periods.** That is the point of a
  migration, but it means a company that has already closed 2023 must reopen it
  or choose balances only. The refusal names the period rather than failing
  obscurely.
- **Descriptions are truncated to 200 characters** in the payload. The longest
  in the real file is 241, and the tail is a bank reference string. The original
  file is kept in Saved Reports, so nothing is lost for good.
- **Undo voids; it does not delete.** A voided import leaves its entries in
  `acc_journal_line` forever, exactly as a voided invoice does, and reports
  ignore them.
- **Undo has a window.** The trigger from migration 0029 refuses to void an
  entry dated in a closed period, so once a period the import touched has been
  closed, that part of the import can only be corrected by a reversal. This is
  the existing rule for every document in One Book, not a new limit.
