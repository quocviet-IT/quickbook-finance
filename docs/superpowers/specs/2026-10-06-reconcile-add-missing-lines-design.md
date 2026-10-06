# 1.82 — Add the statement lines the books do not have, in one click

**Status:** design approved by the user, 2026-10-06.
**Builds on:** 1.79 (a reconciliation started from its statement file, the statement's lines kept with it and paired with the books) and 1.81 (a run of statements; the first month that does not agree is started for a person).
**Reference:** prototype Accounting System 2.28 — `src/p24b.html` (the box and its "Add all N to the books" button), `src/p24.html` `recAddMissing`, `src/p8.html` `classify`. The prototype stays outside the repository.

## 1. The problem

When a month does not agree because the bank shows lines the books do not have — a fee, interest, a deposit nobody recorded — OneBook shows them as "Not in the books" and offers only a link, "Code the N lines the books do not have", to the whole Bank Transactions page. The person leaves the reconciliation, finds each line and codes it, then comes back and clicks Match again.

The prototype records them all from the reconciliation with one button. 1.82 does the same, the OneBook way.

## 2. Decisions taken by the user

1. **Like the prototype, a line no suggestion can place goes to an Uncategorized account** — "Uncategorized Income" for money in, "Uncategorized Expense" for money out — and is recoded later. No per-line choice before posting; the preview is read only.
2. **A line is recoded later by a reclassifying entry**, not by voiding and re-posting: the bank line is never touched, so a month already signed off stays exactly as it was.
3. **Only OneBook's existing suggestions** decide the account (card repayment, related company, bank rule, history). Transfers between own accounts, open invoices or bills, and loan principal/interest splits are not recognised in this release; such lines go to Uncategorized.
4. **Approach A:** one SQL function posts every line in one transaction — all or nothing. The statement line is linked to its bank transaction by date, amount, description and reference — the n-th identical line to the n-th — with no new column. (The import hash cannot simply be recomputed: an OFX line is keyed by the bank's FITID, which the kept statement does not hold.)
5. Undo in Bank Transactions **refuses a line cleared in a completed reconciliation** (a behaviour change, approved).

## 3. The screen

### 3.1 In the reconciliation workspace (`/banking/reconcile/[id]`)

When the reconciliation has a statement and at least one statement line stands "Not in the books" (lines dated after the statement date are not counted), an amber box sits above the Statement lines table:

- Title: **"The bank shows N things your books do not."** (N = the missing lines; "1 thing" in the singular.)
- Text: "Adding them posts real entries, dated as the bank has them and coded by your rules — anything a rule cannot place goes to Uncategorized, to recode later. They are ticked straight away, because the bank has already cleared them."
- A read-only table: **Date · Description · Amount · Would post to**. "Would post to" names the account and where it came from (rule, history, card, related company); a line going to Uncategorized carries the tag **needs coding**.
- The button **"Add all N to the books"**. No confirmation dialog — the table already shows what will be written.
- Beneath it, small: "or code them one by one in Bank Transactions" (the existing link).

Lines that cannot be added are listed under the table with the reason, and are not counted in N:

- **No bank transaction for this line** (its import was undone, or it was never imported): "Not in Bank Transactions — import the statement again, or add it there."
- **Its bank transaction is already coded or matched** elsewhere: "Already in the books — click Match again."
- **Its bank transaction is excluded** in Bank Transactions: "Excluded in Bank Transactions — include it there to add it."
- **Bank Transactions suggests a match in the books for it**: "Bank Transactions suggests a match in the books for it — approve or reject that first." (Coding it would refuse while that suggestion stands.)

When every missing line is in one of those groups, the button is not shown. Nor is it — and the box says why — when more than 500 lines could be added ("More than 500 lines — code them in Bank Transactions."), when the pairing read the statement with money in and out the other way around from the books (its bank lines carry the reversed signs, so coding them would post the wrong direction), or when the chart lacks the Uncategorized account a line needs.

The server works the list out again on the click and posts only if it is the list the person was shown; if a suggestion or a bank line changed in between, nothing is posted, the message says so, and the box is drawn again.

Clicking the button posts every line or none (§4.2). Then the reconciliation is paired and ticked again (the existing `pairAndTick`), and a message says: "N entries added from the statement and ticked." — with "; K went to Uncategorized." when K > 0. The reconciliation is **not** completed; when the difference reaches zero, Complete lights as it does today and the person clicks it.

If the database refuses (a closed period, a line changed since the page was drawn), nothing is posted and the message names the line by date, description and amount.

### 3.2 In Bank Transactions (`/banking`)

- A line whose entry posts to an Uncategorized account shows that account with the tag **needs coding** and an action **Recode**: choose the right account → "Recoded to <account> (<entry number>)". The cell then reads "<account> · recoded from Uncategorized" with **Undo recode**.
- The **Posted to** filter gains **"Needs coding (K)"**, which shows the lines still sitting in Uncategorized (coded there and not recoded). A line a transactions import owns shows the tag but not Recode.
- **Create rule** on a recoded line fills the rule with the account it was recoded to, never Uncategorized.
- **Undo** (uncategorise) on a line whose bank journal line is cleared in a **completed** reconciliation is refused: "This line is reconciled to <date>. Recode it instead, or reopen that reconciliation." (§4.4)

### 3.3 The run of statements (1.81)

Unchanged. The month the run stops at is started for a person as before; opening it shows the box of §3.1.

## 4. Data and SQL — migration 0134

0134 adds two accounts to every chart and adds or replaces functions; it changes no posted entry. It goes live only after the user approves, through `scripts/migrate.mjs`, before the code deploys.

### 4.1 The two Uncategorized accounts

Identified by `detail_type`, as Undeposited Funds is (`undeposited_funds`, migration 0125):

| detail_type | type | code | name |
|---|---|---|---|
| `uncategorized_income` | income | 4999 | Uncategorized Income |
| `uncategorized_expense` | expense | 6999 | Uncategorized Expense |

For every company schema, for each of the two:
1. If an active account already has the `detail_type`, nothing changes.
2. Else, if an account of the right type is named exactly "Uncategorized Income" / "Uncategorized Expense" (case-insensitive), it is given the `detail_type` (one company's chart already holds such accounts under other codes).
3. Else the account is created: posting, active, cash-flow role operating, with code 4999 / 6999 — or, if that code is taken, the highest free code from 4998 down to 4950 / 6998 down to 6950. If none is free the migration fails for that company and says so.

A new company has them from the start without touching the chart templates: the provisioner replays every migration into the new schema, 0134 included. The company-provisioning self-check confirms them. The chart shows their detail type as "Holding account — money in not yet coded" / "— money out not yet coded".

### 4.2 `acc_add_statement_lines_to_books(p_reconciliation_id uuid, p_items jsonb) returns jsonb`

`p_items`: `[{ "statement_line_id": uuid, "bank_transaction_id": uuid, "account_id": uuid }]`, at least one, at most 500.

Checks, each raising with the line's date, description and amount:
- the caller is staff (`acc_is_staff()`), and the reconciliation exists and is **in progress**;
- each statement line belongs to this reconciliation and is dated on or before its statement ending date;
- each bank transaction belongs to the reconciliation's bank account, is `unmatched`, has no `acc_reconciliation` row, and has **the same date and the same amount** as its statement line;
- no statement line and no bank transaction appears twice;
- each account is active, a posting account, and not the bank account's own ledger account.

Then, for each item in order, it calls the existing `acc_categorise_bank_transaction(bank_transaction_id, account_id)` — the same entry, period guard and bank match as coding one line in Bank Transactions. All in one transaction: any failure rolls every line back. Returns `[{ statement_line_id, entry_id, entry_number }]`.

`security definer`, `set search_path = public`, like 0111; revoked from public and anon, granted to authenticated and service_role (the 0080 rule).

### 4.3 `acc_recode_uncategorized(p_bank_transaction_id uuid, p_account_id uuid) returns jsonb`, and `acc_undo_recode(p_bank_transaction_id uuid) returns jsonb`

`acc_recode_uncategorized` requires that:
- the caller is staff;
- the bank transaction does not belong to a transactions import (that import's Undo voids the entries it made, and would leave a recode it knows nothing of behind);
- the bank transaction is coded: it has an approved `acc_reconciliation` row to a posted entry with `source_type = 'bank'` and no `source_id`;
- that entry has two lines, and its non-bank line is on an Uncategorized account;
- it has no posted recode yet (the original entry is locked while this is checked, so two clicks cannot both recode);
- the new account is active, posting, not an Uncategorized account, and not a bank account.

It posts one entry through `acc_post_entry`:
- **date:** the original entry's date (a closed period refuses, as any posting does, and the message says the period is closed);
- **description:** "Recode: <original description>";
- **source:** `source_type = 'bank'`, `source_id` = the original entry. (Not a new `recode` source: a value added to the `acc_journal_source` enum cannot be used in the transaction that adds it, which the rolled-back verify script needs. Every check meaning "an entry Bank Transactions coded" asks for `source_id is null`, so a recode is never mistaken for one.)
- **lines:**
  - money out: Dr the new account / Cr Uncategorized Expense;
  - money in: Dr Uncategorized Income / Cr the new account.

It returns `{ entry_id, entry_number }` and writes an audit row.

`acc_undo_recode` voids that recode entry, the same way other entries are voided, and writes an audit row. Same grants as §4.2.

### 4.4 Undo refuses a reconciled line

`acc_uncategorise_bank_transaction` (last replaced in 0127) gains one check, before anything is voided. If the bank-side journal line of the entry is in `acc_reconciliation_line` for a reconciliation whose status is completed, it raises "This line is reconciled to <statement date>. Recode it instead, or reopen that reconciliation." for a line in Uncategorized, and "This line is reconciled to <statement date>. Reopen that reconciliation to change it." for any other. Taking back a line that has a recode voids the recode too — left alone it would move money off an Uncategorized account that no longer holds any. Everything else in the function is unchanged. A line ticked only in a reconciliation still in progress can still be undone, as today; deleting a bank line (0114), which takes its entry back through this function, is refused the same way.

### 4.5 Coding history learns through recodes

`acc_coding_history()` (0126) is replaced so that:
- an entry whose offset account is Uncategorized and that has a posted recode reports the **recode's** account;
- an entry still in Uncategorized is left out.

The machine therefore never suggests Uncategorized, and a fee recoded once to Bank Charges is suggested as Bank Charges the next time. Rules may not target an Uncategorized account (the rule editor's account list leaves them out).

## 5. The application

- **Domain (pure, unit-tested):** from the kept statement lines, their standings and the account's suggestions, build what the box shows:
  - the lines to add, each with its account and where it came from;
  - the lines that cannot be added, each with its reason.
  
  The link to the bank transaction is the line itself: the same date, amount, description (cut to 500 characters, as the statement keeps it) and reference (trimmed and cut to 80), the n-th identical line taking the n-th identical bank line, oldest first.
- **Service:** reads the bank transactions by `(bank_account_id, raw_hash)` (paged — see the paged-reads rule) and the coding suggestions for that bank account (`codingSuggestions`), finds the two Uncategorized accounts by `detail_type`, and calls the RPCs.
- **Server actions** (in `statement-actions.ts` and `app/(app)/banking/actions.ts`):
  - `addMissingLinesAction(reconciliationId, shown)` builds the list again on the server — never trusting the browser's list — and posts it only if it matches what the person was shown (`shown`: each line and its account), then runs `pairAndTick`;
  - `recodeUncategorizedAction(bankTransactionId, accountId)`;
  - `undoRecodeAction(bankTransactionId)`.
  
  All of them are guarded by `canWrite`, like coding a line today.
- **Screens:** the box in `ReconcileWorkspaceClient`; Recode, Undo recode and the "Needs coding" filter in Bank Transactions' category cell and filters.
- **Release:** changelog **1.82**; the guide's reconciliation step mentions Add all, and a new step "Recode a line from Uncategorized".

## 6. Testing

- **Unit:**
  - the add-list: suggestions used in order; Uncategorized by direction; the two "cannot add" reasons; lines after the statement date left out;
  - the hash link, including two identical lines on one day;
  - the screen strings.
- **SQL verify script** (`scripts/verify-add-missing-lines.mjs`), applying 0134 inside a transaction that is always rolled back, on all six company schemas:
  - both accounts exist with their `detail_type`;
  - add-all posts every line and the reconciliation's pairing then ticks them;
  - any one bad item posts nothing (wrong date, wrong amount, another bank account, already matched, closed period, reconciliation completed);
  - recode posts the right lines in both directions;
  - recode refuses a second recode, a line not in Uncategorized, and a closed period;
  - undo recode works;
  - Undo of a line cleared in a completed reconciliation is refused, and of one in an in-progress reconciliation still works;
  - history maps a recoded entry and drops an unrecoded one;
  - anon can call none of the new functions.
- **Whole suite:** typecheck, lint, unit tests, build, bundle budget.
- **Live check on PC-Test only**, with a new bank account and invented statements:
  - a month with a service fee that a rule codes to Bank Charges, and an unknown line that goes to Uncategorized;
  - Add all → the difference reaches zero → Complete;
  - Bank Transactions → Needs coding → Recode → the completed reconciliation is unchanged;
  - Undo on that line is refused.
  
  Screenshots, light and dark, approved by the user before the push.

## 7. Out of scope

- Recognising transfers between own accounts, open invoices or bills, and loan payments.
- A per-line account choice or skip before posting.
- An Exceptions-report check for Uncategorized balances.
- Changing the books-side "Outstanding" lines.
