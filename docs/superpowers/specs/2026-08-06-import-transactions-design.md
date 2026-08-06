# Importing transactions from another product — design

Date: 2026-08-06
Slice 2 of 4 in the import work (guidance → **transactions** → saved reports → batch).

## Where this came from

The video of 2026-08-05, at 01:34–02:26:

> I want you to have another import details, like transactions. Transactions
> coming from Wave because it is already categorized there… the fields will be
> the date, the description, the bank where it is came from, the chart of
> account, and then the amount… and then if it is reconciled or not. But
> definitely don't include that, 'cause I can manage it.

And Finding 3 asks for the same tab, plus the ability to pick the target bank
account and to preview through the existing steps 2 and 3.

This is **not** the file attached to feedback 428ca4db. That one is Wave's
*Account Transactions* report — one-sided, grouped into per-account sections,
handled in slice 4. The file this slice reads carries **both sides** of each
transaction, which is what makes posting possible at all.

## Decisions already taken

| Question | Decision | Why |
|---|---|---|
| Where does a row land? | One two-sided journal entry **and** an `acc_bank_transaction` marked `matched`, joined by an approved reconciliation | Wave already categorized it, so re-deciding each line is wasted work; the bank row is what stops a later bank feed counting the same money twice |
| A row names an account the company does not have? | **Refuse the whole file** and list every missing account | Import the chart first — the order the user themselves described. Creating accounts from a typo is how a chart of accounts rots |
| Reconciled flag in the file | Ignored | The user asked for it to be left out |
| Extensibility | One target, several file shapes | The next company exports from QuickBooks or a bank, with different column names and often a Debit/Credit pair instead of one Amount |

## What "extensible" means concretely

Adding a source later must be adding **aliases and an amount shape**, never a new
code path:

- Column names are matched by the existing alias scorer in
  `lib/domain/import-mapping.ts`. A new product's spelling is one more string in
  an alias list.
- The amount arrives as **either** a single signed `Amount` column **or** a
  `Debit`/`Credit` pair. Both normalise to one signed minor amount in a pure
  function, so no caller learns which shape the file used.
- The bank account may come from a **column in the file** or from **one account
  chosen for the whole file**. Wave names the bank per row; a plain bank export
  does not name it at all.

None of this is a plugin framework. It is one target whose fields cover the
variation, which is the smallest thing that answers the ask.

## The sign convention, stated once

A bank account is an asset, so **debit means money in**. The signed amount is:

```
signed = amount           (when the file has one signed Amount column)
signed = debit − credit   (when the file has the pair)
```

`signed > 0` debits the bank and credits the category account; `signed < 0` does
the reverse. The `acc_bank_transaction` row carries the same signed value, which
is the convention migration 0010 already uses.

## Architecture

### Domain — `lib/domain/import-mapping.ts` and a new pure module

`ImportTarget` gains `"transactions"`; `TARGET_LABEL.transactions` is
`"Transactions"`. Its fields:

| Key | Label | Required | Aliases (abridged) |
|---|---|---|---|
| `txn_date` | Date | yes | date, transaction date, posting date |
| `description` | Description | no | description, memo, notes, details, payee |
| `bank_account` | Bank account | no | bank, bank account, from account, paid from, source account |
| `category_account` | Chart of account | yes | chart of account, category, gl account, expense account, income account |
| `amount` | Amount | no | amount, total |
| `debit` | Debit | no | debit, debit amount, money in |
| `credit` | Credit | no | credit, credit amount, money out |

`bank_account` is optional because the screen offers a default; `amount` is
optional because `debit`/`credit` may carry it instead. Neither absence is
silent: the screen refuses to run until one amount source and one bank source
exist, and says which is missing.

`lib/domain/transaction-import.ts` (new, pure):

- `signedAmountMinor(record): { minor: number } | { problem: string }` — the
  rule above, rejecting a row that has no amount at all or has both an `Amount`
  and a `Debit`/`Credit` that disagree.
- `transactionRawHash(input): string` — the dedupe key, `sha256` over the bank
  account, ISO date, description and signed amount. Two identical rows in one
  file are two transactions; the same row imported twice is one.
- `describeTransactionRow(record): string` — the line shown in the dry run.

### Database — migration 0099

`acc_import_transactions(p_rows jsonb, p_default_bank_account_id uuid) returns jsonb`,
`security definer`, `acc_is_staff()` gated. For each row, inside the one
transaction the function already runs in:

1. Resolve the bank account and the category account **server-side** by code,
   by `code - name`, or by name, case-insensitively. An unresolved account
   raises — the client's resolution is a courtesy, not the authority.
2. Insert `acc_bank_transaction` with the signed amount, `source = 'file_upload'`,
   `status = 'matched'` and the raw hash. `on conflict (bank_account_id, raw_hash)
   do nothing` — a returning-less conflict means this row was already imported,
   so the function counts it as skipped and moves on **without posting**.
3. Post the journal entry through `acc_post_entry`, the same door every other
   document uses, so the closed-period guard and the balance check apply
   unchanged.
4. Insert `acc_reconciliation` linking the bank row to the journal line on the
   bank account, `status = 'approved'`. A bank line marked matched that points at
   nothing would be a lie.

It returns `{ imported, skipped, problems }`. Nothing is inserted for a row that
fails, and any failure rolls the whole call back.

### Application

- `lib/services/data-import.ts`: `previewImport` learns the transactions case —
  it resolves accounts against the company's chart, counts duplicates against
  existing `raw_hash` values, and reports every unresolved account name.
  `ImportPreview` gains two optional fields, `duplicates?: number` and
  `missingAccounts?: string[]`, so the other four targets are untouched.
  `runImport` gains the `acc_import_transactions` call.
- `app/(app)/settings/import/ImportClient.tsx`: the new tab, a bank-account
  picker shown only for it, and a step-3 block listing missing accounts with the
  Import button disabled.

## Error handling

Three refusals, each with its own sentence: an account the chart does not have
(with the list), no amount column chosen, and no bank account either in the file
or picked. A closed period is refused by `acc_post_entry` and surfaces verbatim.

Duplicates are not an error. They are counted and named in the dry run, so
re-importing a corrected file is a safe, ordinary act.

## Testing

- Unit: the sign rule for both file shapes and their disagreement; the hash's
  stability and its sensitivity to each input; the transactions field set;
  preview against a fake client covering missing accounts and duplicates; the
  action's authorization; a UI contract test for the tab, the picker and the
  400-line ceiling.
- Migration contract: the RPC exists, is granted, resolves accounts three ways,
  posts through `acc_post_entry`, and never writes when a row fails.
- Behavioural, rollback-only (`scripts/verify-import-transactions.mjs`): import
  two rows into a real company, prove the journal entry balances and the bank row
  is `matched` and linked; re-import the same rows and prove nothing is added;
  prove a missing account refuses the call; prove a closed period refuses it.
  Then `ROLLBACK`.
