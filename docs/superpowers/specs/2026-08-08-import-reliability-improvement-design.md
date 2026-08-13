# Making the importer trustworthy

Date: 2026-08-08
Status: proposed design, not implemented
Scope: data import in One Book — Chart of Accounts, Opening Balances and Transactions first

## 1. Purpose

This records what is still missing before the importer can be called safe and
accounting-correct.

Success is not the screen saying `Import completed`. An import has succeeded
only when:

- what was written matches what the user reviewed and confirmed;
- no failed or conflicting row was passed over in silence;
- the journal entries are complete, balanced and traceable;
- any failure at all rolls the whole import back;
- the figures afterwards reconcile against the source file.

This describes a direction. It changes no code and no data.

## 2. Where things stand

One Book's accounting foundation is the right shape to finish this on: the
double-entry ledger is the single source of truth, financial writes go through
RPCs, and several import types already have a batch-and-rollback mechanism.

Most of the import path already works. Measured:

- the application test suite and the type check both pass;
- the transaction-import and general-ledger database checks pass and roll back
  after running;
- the system correctly recognises the Transactions file under evaluation;
- the accounts and bank records the Pacific Four Nine file refers to now exist.

What remains are the gaps that let the data actually written differ from the
Preview, or let an import half-succeed.

## 3. The Pacific Four Nine data used for this evaluation

The Transactions file holds **1,566 data rows**:

| State | Rows | Meaning |
| --- | ---: | --- |
| Ready to import | 1,466 | Has a date, a bank account, a counter account and a valid amount |
| No money moved | 99 | Debit, Credit and Amount are all zero — skippable, but it must be reported |
| Amounts disagree | 1 | Must be settled before importing |

The row needing a human decision is source row 544:

- Date: `2025-02-20`
- Description: `Check 1171`
- Bank account: one of the company's checking accounts *(the real name is held
  back: this repository is public, and the name carries the bank and the last
  four digits)*
- Category account: `Shareholder Loan`
- Amount: `-$3,450`
- Debit: `$2,000`
- Credit: `$3,450`
- Debit less Credit: `-$1,450`

The system must not guess which figure is right. Whoever owns the source data
has to say whether the Amount or the Debit/Credit pair is authoritative.

Pacific Four Nine's Chart of Accounts holds 95 active accounts:

- 54 carry `cash_flow_role = unclassified`;
- 50 can be classified automatically by the existing rules;
- 4 need an accountant to decide;
- 7 bank accounts carry a cash-flow role that should be re-checked.

The four needing a decision are `1190 - Allowance for Doubtful Accounts`,
`150 - Wave Payroll Clearing`, `151 - Transfer Clearing`, and a transfer account
named after one of the company's own bank accounts (held back for the same
reason as above).

## 4. The root causes still open

### P0. The Preview can differ from what actually gets imported

The Preview is not always invalidated when the user changes a mapping, a bank
account or an account override. An asynchronous mapping suggestion can also
land late and change the configuration after the user has already read the
Preview.

The consequence: the user confirms one set of data and the system may write
another.

### P0. An account-type override is applied too late

A row whose account type is not recognised can be dropped during mapping or
validation, before the user's override is applied. The screen may show the type
as chosen while that row never returns to the set being imported.

### P0. Chart of Accounts and Opening Balances read two different versions

The Chart of Accounts can use the overridden account type while Opening
Balances still uses the pre-override record. The database then refuses the
balance because the account type does not match.

The consequence: the account may be created while its opening balance fails.

### P1. Conflict detail is not carried back in full

The database can find an account whose code matches but whose type does not, and
skip the record. The service layer keeps mostly a `skipped` count, without the
account names and reasons a user would need to act.

### P1. The flow allows a partial import while failed rows remain

Rows with no money are reported as excluded, but a row whose Amount and
Debit/Credit disagree can land in the same group. The user can still import the
rest without ever making an explicit decision about the failed row.

### P1. Classifying existing accounts is unfinished

Classification runs mostly after a Chart of Accounts import and does not correct
values already assigned but implausible. So the Pacific Four Nine data still
carries many `unclassified` accounts and several bank accounts whose cash-flow
role needs review.

## 5. Design principles

The central one:

> The Preview must be an immutable import plan, and the database must write
> exactly that plan.

Supporting it:

1. Normalise once, and use a single canonical record set for every later step.
2. Every mapping, override and bank-account choice completes before validation.
3. Any change to the inputs after a Preview invalidates that Preview.
4. Never guess accounting data when the source columns disagree.
5. Failed rows and conflicts are settled before anything financial is written.
6. An import is atomic: all of it commits, or none of it does.
7. Every import carries a batch ID, a checksum, an actor and a result report.

## 6. The proposal: an immutable import plan

### 6.1. The flow

```text
Source file
  → Parse
  → Mapping + overrides + bank selection
  → Normalise
  → Validate
  → Build an immutable import plan
  → Preview
  → User confirms plan_id/checksum
  → Database commits that exact plan
  → Batch report + audit + undo
```

Do not send `rows + mapping + overrides` back to be recomputed when the user
presses Import. Import may reference only a valid `plan_id`, or a payload whose
checksum matches the confirmed Preview exactly.

### 6.2. Versioning and invalidation

An import plan needs at least:

- `plan_id`;
- `company_id` or the company schema;
- the import type;
- the source file's checksum;
- the mapping version;
- the overrides version;
- the chosen bank account;
- the normalised record set;
- total rows and total amounts;
- the warning, ignored, duplicate, error and conflict lists;
- when it was built, and by whom.

The Preview must be invalidated the moment any of these happen: a different file
is chosen, a mapping is edited, the bank account changes, an account override is
edited, an account type changes, or a new mapping suggestion arrives.

An AI or asynchronous result that finishes late must not be able to change a
confirmed plan. Every request needs a request or version ID so a stale result is
discarded.

### 6.3. The order account-type normalisation must run in

```text
Raw value
  → Normalise characters and aliases
  → Apply the user's override
  → Check the account type is valid
  → Build the canonical record
  → Use the canonical record for both Preview and Import
```

If the user overrides `Other Current Asset` to `fixed_asset`, both the Chart of
Accounts record and the Opening Balance record must use `fixed_asset`.

### 6.4. Atomicity

Everything interdependent within one import belongs in one database
transaction: creating or updating the Chart of Accounts, writing Opening
Balances, creating journal entries, creating bank transactions and their
reconciliations, and writing the import batch and its audit metadata.

If any step fails, none of it is kept. After a rollback the account count, the
balances and the entries must equal what they were before the import began.

### 6.5. One final state per row

| State | Imports by default | Meaning |
| --- | --- | --- |
| `ready` | Yes | Valid, and will be written |
| `ignored` | Yes | Empty, or no money moved — skipped deliberately |
| `duplicate` | Yes | Already present by its de-duplication key; not written again |
| `warning` | Conditionally | Does not make the entry wrong, but the user should know |
| `error` | No | Required data missing or contradictory |
| `conflict` | No | Disagrees with existing data; needs a decision |

The default mode imports only when no `error` and no `conflict` remain. If a
partial import is ever needed, it must be its own mode with its own permission,
confirmation and report — never the default behaviour.

### 6.6. A conflict is first-class data

For each conflict the Preview must show the source row, the account code or name
or transaction reference, the value in the file, the value already in the
system, the reason, and the valid choices: keep what exists, update it, map to a
different account, or drop it from the plan.

Not a bare `1 skipped`.

## 7. What the Preview screen needs

An auditable summary: the file name and a short checksum; the target company;
the import type; the source row count; the counts of ready, ignored, duplicate,
warning, error and conflict; total Money In, Money Out and Net; the bank and
counter accounts used; the per-row list of problems; and a button to download a
CSV of everything not being imported.

The final confirmation must restate the skipped count, the failed count and the
totals. Import stays disabled while any `error` or `conflict` remains, or once
the plan has been invalidated.

## 8. Handling the Pacific Four Nine data

Fixing the importer and cleaning one company's data are two separate jobs.

**Step 1 — the source file.** Settle the correct value for row 544
(`Check 1171`). Keep the 99 no-money rows as `ignored` rather than failures.
Rebuild the Preview and confirm Money In, Money Out and Net.

**Step 2 — finish the Chart of Accounts.** Apply the 50 classifications that can
be determined automatically. Ask the accountant to decide the 4 that cannot.
Re-check the cash-flow role on the 7 bank accounts. Leave no account
`unclassified` that the rules could have classified.

**Step 3 — shadow import.** Import into a copy or a trial schema. Do not make
production the first run. Record the batch ID, checksum, row counts and totals.

**Step 4 — reconcile.** The trial balance must balance. Total debits must equal
total credits. Each bank account's balance must match the source. Opening
balances must match the confirmed file. Cash flow must have no automatic
classification left undone. The batch report's row counts must match the
Preview.

Only once all of that holds does a production import run.

## 9. Order of work

**P0 — correctness.** Build the immutable plan and its invalidation. Apply
overrides before validation. Use one canonical record set for Chart of Accounts
and Opening Balances. Put the whole import in one transaction. Block import
while errors or conflicts remain.

**P1 — transparency and reconciliation.** Carry conflict detail from the
database through to the Preview. Separate ignored, duplicate, warning, error and
conflict properly. Add a batch report with totals and per-state counts. Finish
classification for existing data. Run the shadow import and reconcile Pacific
Four Nine.

**P2 — staging, later.** If file sizes or import types grow, add staging tables
`acc_import_plan` and `acc_import_plan_row`, with plan states:

```text
draft → validating → ready → committed
                         ↘ failed
                         ↘ voided
```

Staging lets a plan be reviewed, audited, retried and undone without re-parsing
the file in the browser. It is a later stage, not a precondition for the P0 work.

## 10. Acceptance criteria

The importer is finished when all of these hold:

1. Changing a mapping, bank account or override invalidates the current Preview.
2. A late AI result cannot change a confirmed plan.
3. Overriding an unknown account type produces a valid canonical record.
4. Chart of Accounts and Opening Balances use the same account type after an
   override.
5. Transactions cannot be imported while any `error` or `conflict` row remains.
6. The Preview and the committed batch share a checksum, a row count and totals.
7. A failure at any step leaves no partial account, balance or journal entry.
8. A duplicate is skipped without creating a new journal entry or bank
   transaction.
9. Every successful import carries a batch ID, an actor, a timestamp and a trail.
10. The trial balance after a shadow import balances, and bank balances match
    the source.
11. Pacific Four Nine has no account left `unclassified` that the rules could
    classify.
12. Row 544 is settled by a decision taken from the source data, not by the
    parser guessing.

## 11. The tests this will need

**Unit.** Invalidation when a mapping, bank account or override changes.
Protection against stale async and AI results. Overrides applied before
validation. One canonical record used throughout. Correct row-state
classification. A checksum that is stable, and that changes when the plan does.

**Service and action.** The import action accepts only a live plan. The plan's
company must match the active company. Conflict detail survives from the
database to the UI. Preview totals match the payload sent to the database.

**Database.** Chart of Accounts and Opening Balances commit together or roll
back together. One failed row rolls the whole batch back. A duplicate creates no
repeated entry. Every journal entry balances. Batch metadata matches what was
actually written.

**End to end.** Run the whole wizard from upload to batch report. Change a
mapping after a Preview and confirm the old Preview cannot be used. Run the
Pacific Four Nine file in a trial environment. Compare the trial balance, bank
balances and cash flow before and after.

## 12. Out of scope

- Repairing a source row whose Amount and Debit/Credit disagree.
- Creating an account from a name that is unknown or may be a typo.
- Changing the accounting rules `acc_post_entry` already enforces.
- Making partial import the default behaviour.
- Rebuilding the whole import interface, if smaller changes satisfy the plan
  principle.

## 13. Risks and controls

| Risk | Control |
| --- | --- |
| A large file pushes the payload past its limit | Stage by plan and row, or split into batches with their own checksum and transaction boundary |
| An import technically correct but wrong about the source | Block contradictions, demand a human decision, and reconcile afterwards |
| Duplicate or ambiguous account references | Show the candidates and require manual mapping |
| Importing into the wrong company | Bind the company to the plan and re-check it at the action and the RPC |
| Re-running a file creating duplicates | File checksum, row hash and an idempotency key |
| No way back after an import | Batch audit and a void/undo path that respects the accounting period |

## 14. Conclusion

One Book can finish this with a high chance of success, because the root causes
are identified and the existing ledger architecture already supports
transactions, audit and rollback.

The priority is not more scattered warnings. The thing that matters is turning
the Preview into an **immutable import plan** and making the database commit
exactly that plan. Once P0 is done, the shadow import and the Pacific Four Nine
reconciliation are the gate to clear before the importer is used in production.
