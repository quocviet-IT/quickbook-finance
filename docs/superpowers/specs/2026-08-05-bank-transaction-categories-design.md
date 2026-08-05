# Categorizing a bank transaction — design

Date: 2026-08-05

## Where this came from

Feedback report `773843b7-8daf-493b-b7a6-da60ba0be639` (2026-08-03, status
`reviewing`, `/banking`, from admin@ctyhp.vn):

> please add another column where I can freely categorized a bank transaction.
> Please see the screen shot I shared.

The attached screenshot (`payment Schedule.png`) is from the reporter's other
system: a transaction table with a **Category** column, one dropdown per row,
holding their own words — *Deposit*, *Inventory*, *Website Platform*,
*Payroll: Employee…*. What they are asking for is their vocabulary on their bank
lines, not ours.

## Goal

A user-owned label on each bank transaction, assignable in one click from the
list, creatable on the spot, and usable to filter the list — including finding
the lines that have no label yet.

## What this is not

- **Not a posting.** Choosing a label never writes to the ledger. Bank lines
  become accounting facts by being matched to a document or settled, and that
  path keeps every guard it has. A dropdown that posted would be a second way
  into the books.
- **Not the bank's own category.** `acc_bank_transaction.category` already
  exists and holds what the feed said (Plaid's category, shown today as the
  subtitle under Description). The user's label is a separate column;
  overwriting the provider's value would destroy imported data.
- **Not label administration.** Renaming and hiding labels belong on a Settings
  screen, in a later slice.
- **Not CSV export.** The list has no export today; adding one is its own slice.

## Constraints this has to respect

- **Bank transactions are immutable.** `acc_block_bank_txn_edit` (migration
  0010) rejects any update that changes `amount_minor`, `txn_date`,
  `description`, `reference` or `raw_hash`. The new column is none of those, so
  the trigger stays exactly as it is — and a test proves it still bites.
- **`BankingClient.tsx` is 1042 lines**, against a 400-line project ceiling.
  The transactions table moves into its own component as part of this work.
  Adding a column to a file already 2.6× over the limit would make a known
  problem worse.
- Every migration must reach every company schema.

## Architecture

### Migration 0098

```
acc_bank_category
  id, name, is_active (default true), created_at, created_by, updated_at, updated_by
  unique index on lower(btrim(name))
```

`acc_stamp_actor` is attached to the table, so attribution is the database's
business and not the application's.

`acc_bank_transaction` gains `bank_category_id uuid references
acc_bank_category (id) on delete set null`. Deleting a label — which nothing in
this slice does — would leave the transactions, unlabelled.

Two functions, both `acc_is_staff()` gated:

- `acc_upsert_bank_category(p_name text) returns uuid` — trims, refuses empty
  and over-60-character names, and returns the existing id when the name already
  exists case-insensitively. Typing "Inventory" on two different rows must not
  produce two labels.
- `acc_set_bank_transaction_category(p_txn_id uuid, p_category_id uuid) returns void`
  — writes only `bank_category_id`. `null` clears the label. An inactive or
  unknown label is refused. The function is the whitelist: no caller reaches an
  amount through it.

### Application

- `lib/services/banking.ts`: `listBankCategories`, `createBankCategory`,
  `setBankTransactionCategory`. `listBankTransactions` selects the new column
  and the label's name so the list needs no second query per row.
- `app/(app)/banking/actions.ts`: `createBankCategoryAction` and
  `setBankTransactionCategoryAction`, both gated on `canWrite`, both
  revalidating `/banking`.
- `app/(app)/banking/BankTransactionsTable.tsx`: the table lifted out of
  `BankingClient.tsx`, with the new column.

### Interface

The **Category** column sits between Amount and Match — after the money, before
the accounting. Each row holds a searchable, clearable `Select`; typing a name
that does not exist offers *Create «name»* in the popup footer. Choosing saves
immediately: there is no Save button, because a label is not a document.

Beside the existing status filter there is a category filter listing every
label plus **Uncategorized**. Without that last option the labels cannot be used
for the job they were asked for — finding the lines nobody has looked at.

A reader who cannot write sees the label as plain text, not a disabled dropdown.

## Error handling

The database's refusals surface verbatim: an empty name, a name over 60
characters, an unknown label. A failed assignment leaves the row as it was and
says so; nothing is optimistically shown as saved.

## Testing

- Unit: the migration contract (whitelist column, per-company retarget, trigger
  untouched); the service adapters against a fake client; the actions'
  authorization and revalidation; a UI contract test asserting the new column,
  the Uncategorized filter, and that both touched components are under 400 lines.
- Behavioural, rollback-only (`scripts/verify-bank-categories.mjs`): create a
  label, create it again in different case and get the same id, assign it to a
  real bank transaction, clear it, prove `acc_block_bank_txn_edit` still rejects
  an amount change on that row, and prove a viewer is refused both functions.
  Then `ROLLBACK`.
- The page smoke sweep covers `/banking` rendering after the component split.
