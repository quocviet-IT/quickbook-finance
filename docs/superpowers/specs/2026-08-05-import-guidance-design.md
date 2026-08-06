# Telling the user what their import file actually is — design

Date: 2026-08-05
Slice 1 of 4 in the import work (guidance → bank transactions → saved reports → batch).

## Where this came from

Feedback report `428ca4db-a090-417a-8ed6-a40ef4f7d81e` (2026-08-04, `/settings/import`):

> Hi Viet, could you please give me information on what to do here, do i need to
> import one ledger at a time or i can batch the import of transactions like what
> am doing right now. Also batch import can save time. i will sending you a
> ledger balance for PC49 provide me a clear instruction how to add this ledger.

The screenshot attached to that report says more than the words do. The file
loaded was **"Pacific Four Nine (2.0) Account Transactions 2026-08-04 18_20.csv"**
and the tab was **Chart of accounts**. The mapping came out as:

| Field | Column chosen |
|---|---|
| Account code *(required)* | account number |
| Account name *(required)* | **Not imported** |
| Type *(required)* | **Not imported** |
| Description | description |
| Opening balance | balance (in business currency) |

with the note *"3 column(s) in the file are not used: date, debit (in business
currency), credit (in business currency)"* and the button disabled: *"Still to
choose: Account name, Type"*.

So the user was not missing instructions in the abstract. They had a **general
ledger detail export** — one row per *transaction*, with a date and debit/credit —
and put it in the one tab whose shape is one row per *account* with a balance. The
screen let them get five fields deep before stopping them, and never said the
file was the wrong kind.

### What the file actually contains (read 2026-08-06)

The file itself was later read. It is worse than "the wrong tab": **no column
mapping can read it**, because its layout changes inside one file.

- 3,162 transaction rows under ~18 accounts, each account a *section*, spanning
  December 2022 to December 2025.
- An account **with** a number puts it in column 0 — `121 - PC49 BoA CK 3388`,
  code and name in one cell.
- An account **without** a number has its name pushed into column 1, the DATE
  column — `Cash on Hand`, `Transfer Clearing`, `Stripe Sales`.
- From row 3039 the account name repeats in column 0 on *every* row.
- `Starting Balance`, `Totals and Ending Balance` and `Balance Change` rows sit
  between the transactions.

Two consequences for this slice. Detection must recognise this **specific export**
rather than only "a file with a date and a debit column", and the message must say
the file needs a reader of its own instead of implying a better mapping exists.
The user's belief that they have no account code is also wrong in a fixable way:
the code is there, glued to the name, and slice 4's reader splits it.

### Decisions already taken for the later slices

Recorded here so they are not re-argued: slice 2 imports Wave's *categorized*
transactions export — a different file, carrying both sides (`date, description,
bank account, chart of account, amount`, named in the user's video of 2026-08-05).
Each row posts **one two-sided journal entry** and also writes an
`acc_bank_transaction` row already marked `matched`, so connecting a bank feed for
that account later cannot count the same money twice. Slice 3 stores an uploaded
report as an artifact that is never added to any balance.

## Goal

Before anyone maps a column, the screen should say what the selected tab needs,
offer a template that matches it exactly, and — if the file looks like something
else — say so and offer to switch.

## What this slice is not

- **Not the bank transactions import.** That is slice 2. Until it lands, a
  ledger-detail file has no home, and this slice says that plainly rather than
  implying the file will work.
- **Not batch import of several files.** Slice 4. This slice does correct the
  belief that it is needed for many accounts: one file already carries every
  account, one row each.
- **Not a saved-report archive.** Slice 3.
- **No database change.** Nothing here writes, so there is no migration and no
  rollback-only verification script for this slice.

## Architecture

### One source of truth for what a file needs

`lib/domain/import-mapping.ts` already holds, per target, every field's label,
whether it is required, its aliases and its hint. Everything this slice shows is
derived from that list, so guidance cannot drift from the mapper:

`lib/domain/import-shape.ts` (new, pure):

- `templateCsvFor(target: ImportTarget): string` — a header row of the target's
  field labels plus one example row. The example for `chart_of_accounts` is the
  PC49 case from the report, so the answer to "how do I add this ledger" is a
  file the user can open.
- `detectFileShape(headers: readonly string[]): FileShapeDetection` where

  ```ts
  interface FileShapeDetection {
    /** Best matching import target, or null when nothing matches well. */
    target: ImportTarget | null;
    /** How many of that target's required fields the headers cover. */
    matchedRequired: number;
    requiredTotal: number;
    /**
     * True when the file carries a date and a debit or credit column — a
     * transactions export, which no current target accepts.
     */
    looksLikeLedgerDetail: boolean;
    /**
     * True for Wave's "Account Transactions" report specifically: an account
     * column beside a date, debit, credit and a running balance. That file is
     * grouped into per-account sections and cannot be read by column mapping at
     * all, so it earns its own sentence rather than the generic one.
     */
    looksLikeWaveAccountTransactions: boolean;
  }
  ```

- `describeShapeMismatch(selected: ImportTarget, detection: FileShapeDetection): string | null`
  — the sentence to show, or null when the file and the tab agree.

Detection scores headers against each target's aliases using the same
case-and-punctuation-insensitive comparison the mapper uses. `looksLikeLedgerDetail`
is deliberately a separate signal rather than a sixth target: the file *is*
recognisable, and pretending otherwise is what produced the report.

### The screen

`ImportGuidance.tsx` (new client component, so `ImportClient.tsx` stays under the
400-line ceiling it is close to):

- **What this file needs** — the selected tab's required fields, then its
  optional ones, each with the hint the mapper already carries.
- **One file, every account** — the sentence that answers the report's first
  question: rows are the batch; a second file is only needed for a second *kind*
  of data.
- **Download template** — `templateCsvFor(target)` as a file named for the tab.
- **Where this comes from in QuickBooks or Wave** — one line per tab naming the
  report to export.

In step 2, a warning appears when `describeShapeMismatch` returns a sentence. When
the detected target exists, the warning carries a **Switch to <target>** button
that changes the tab and re-proposes the mapping against the same file. For a
ledger-detail file the warning explains what the file holds, that a balance-only
import is what Chart of accounts does, and that bank lines have their own route.

Nothing about the existing three steps, the mapping table, the unused-column note
or the dry run changes. The wizard was not wrong; it was silent.

## Error handling

Detection is advisory. A user who knows better can ignore the warning and carry
on — the required-field gate and the dry run still stand between them and the
ledger. The one thing detection must never do is *block* an import that the
mapper would accept.

An empty file, or one whose headers match nothing, produces no warning rather
than a wrong guess: `target: null`, `looksLikeLedgerDetail: false`, and the
guidance panel alone.

## Testing

- `templateCsvFor` for all five targets: the header row equals the field labels
  from `fieldsFor(target)`, and the example row has the same number of cells.
- `detectFileShape` against real header sets, including **the exact headers from
  the report's file** — `account number, date, description, debit (in business
  currency), credit (in business currency), balance (in business currency)` —
  which must set both `looksLikeLedgerDetail` and
  `looksLikeWaveAccountTransactions`, and must not claim a confident
  `chart_of_accounts` match.
- A ledger-detail file *without* the running balance sets `looksLikeLedgerDetail`
  but not `looksLikeWaveAccountTransactions`, so the two signals cannot collapse
  into one.
- `detectFileShape` against a genuine QuickBooks chart-of-accounts export, which
  must match `chart_of_accounts` with every required field covered and
  `looksLikeLedgerDetail` false.
- `describeShapeMismatch` returns null when the file and tab agree.
- A UI contract test: the guidance component exists, `ImportClient` renders it and
  the mismatch warning, both files stay under 400 lines.
- `scripts/smoke-pages.mjs` for `/settings/import`.
