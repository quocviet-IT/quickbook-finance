# Transfers and shareholder funding on Review import — design

**Date:** 2026-09-30
**Branch:** `feat/bank-pairs` (from `main` at 1.71)
**Release:** 1.72

## 1. What is asked

This was deferred from 1.71, where statement upload that categorises itself shipped. The client's prototype recognises two things a rule or history would get wrong.

**Transfers between the company's own bank accounts**
- If the other side is already there — money in of the same amount, on another of the company's bank accounts, within a few days — the two lines join into one transfer.
- If a line reads as a transfer ("online transfer", "xfer") and names another bank account, by its name or its last four digits, it moves the money to that account. Income and expense are not touched.

**Shareholder funding pairs**
- A deposit answered by a payment of the same amount within N days is usually the owner putting money in to cover a cost, or taking it out and putting it back.
- The client's note puts it: "Coded as spending, they would invent a cost and hide a loan."
- In the prototype this is a suggestion only: equal amounts also happen by coincidence.

The client's note also asks that the reasoning be written on the entry, "where a reviewer reading the ledger a year from now will see the reasoning without being told where to look".

## 2. Scope, as decided

Decided with the user on 2026-09-30:

- This release, (a), comes before the Beancount balance assertions, (b).
- The account that funding pairs post to is **chosen once per company**. A default is proposed from the account names. With nothing chosen, no funding pair is proposed.
- **Approach A:** a new database function posts a pair in one transaction. Both lines are posted or neither is. The entry says what the pair was.
- **Out of scope:**
  - pairs between two OneBook companies;
  - card and loan registers (the principal and interest split);
  - one-to-many pairs;
  - Beancount balance assertions.

## 3. How it works

### 3.1 The banking preference

Each company has one row of banking preference:

- **Funding pairs post to:** an active posting account of a liability type.
  - The default offered, until one is chosen, is the first such account, in code order, whose name matches `/(shareholder|owner|director|member)s?['’]?\s*(loan|advance)|loan\s+from\s+(the\s+)?(shareholder|owner|director)|due\s+to\s+(shareholder|owner|director)/i`.
  - The default is only offered; it is not saved until a person saves it.
- **Pair within:** 0, 1, 3, 7, 14 or 30 days. The default is 7.

Both are shown and saved at the top of **Banking › Rules**. Staff write them; viewers read them. Every change is audited.

### 3.2 Which lines can pair

A line can pair only when all of these hold:

- it is waiting: `unmatched`, not `pending`, and not removed by the provider;
- it has no suggested ledger match;
- no open invoice or bill has exactly its amount (money that pays a document is not the owner's);
- its bank account is in the base currency.

Pairing looks at every such line in the company, not only the import on screen.

- **Transfer pair.** Two lines on **different** bank accounts, with opposite signs, the same absolute amount, and dates at most *Pair within* days apart.
- **Funding pair.** Two lines on the **same** bank account, with opposite signs, the same absolute amount, and dates at most *Pair within* days apart. This follows the prototype, which pairs within one statement; across two accounts the same shape is a transfer.
- **Only when unambiguous.** A line pairs only with its **only** candidate, and only when it is that candidate's only candidate too.
  - Two or more candidates give no pair. **Why** says: "2 lines could be the other side — code it yourself".
  - A line is used in at most one pair.
  - If a pair of lines is a transfer candidate, it is never also offered as funding.
- **Named transfer.** No transfer pair was found, but the description matches `\b(transfer|xfer|online transfer|internal transfer|book transfer|to savings|from savings)\b` and names another of the company's bank accounts:
  - either the account's last four digits (from the masked number, or from the ledger account's code or name) appear in the description;
  - or the ledger account's full name, six characters or longer, appears in it.

  The line is proposed as an account post to that other bank account.

### 3.3 Where the new proposals sit

Review import keeps one proposal per line. The order becomes:

1. already handled;
2. ledger match;
3. the one open document;
4. **transfer pair**;
5. **named transfer**;
6. rule;
7. history;
8. **funding pair**, only when nothing above applies;
9. needs coding.

Further rules:

- **Two documents.** Two open documents of the same amount still give no proposal, and nothing below is consulted.
- **Funding as an alternative.** A line in a funding pair that already has a rule or history proposal keeps it. The funding pair is then offered as a second choice in its **Post as** picker, and **Why** says so: "Also: possible shareholder funding with WIRE IN on 2026-02-09".
- **What starts ticked.**
  - A transfer pair and a named transfer start ticked.
  - A funding pair **never** starts ticked.
- **Ticking a pair.** Choosing or ticking a pair on one line applies to both lines if the other is on screen. It is posted once.

**Labels and reasons:**

| Proposal | Label | Why |
|---|---|---|
| Transfer pair | `Transfer to Sample Savings · 1020` (or `from`) | "The other side is on Sample Savings · 1020, 2026-09-11, for the same amount. Posting makes one transfer entry and matches both lines." |
| Named transfer | `Transfer to Sample Savings · 1020` | "Reads as a transfer and names Sample Savings · 1020; no line there yet — posting moves the money without touching income or expense" |
| Funding pair | `Shareholder funding · 2600 Shareholder Loan` | "Answered by CHECK 1303 of the same amount on 2026-02-11 — the owner's money in and out, not income or a cost" |

### 3.4 Posting

**Transfer pair** — `acc_post_bank_pair(first, second, 'transfer')`:
- One entry, dated the money-out line's date.
- Debit the receiving bank's ledger account; credit the paying bank's.
- Description: `Transfer from <paying bank label> to <receiving bank label>`. Each leg's memo is its own line's description.
- Both lines get an approved reconciliation to their own leg, and become `matched`.

**Funding pair** — `acc_post_bank_pair(first, second, 'funding')`:
- Two entries, each dated its own line and posted against the preference's funding account. The server takes that account from the preference, never from the caller.
- Each entry's description names the other line: `<description>, answered by <other description> on <other date>`.
- Each line is reconciled to its own entry.

**Named transfer** posts through `acc_categorise_bank_transaction` to the other bank's ledger account, as any account post does. The other side, when it is imported, finds this entry as a ledger match.

**Checks inside `acc_post_bank_pair`:**
- The caller is staff.
- Both lines exist, are distinct, are `unmatched` and not pending, and have no reconciliation.
- The amounts are equal and opposite, and not zero.
- The dates are within the preference's window.
- For a transfer: different bank accounts, both in the base currency.
- For funding: a funding account is set, active and posting.

The function returns the entry numbers. `acc_post_entry` keeps the closed-period guard.

**Change.** Change on a line whose entry was posted by `acc_post_bank_pair` works as it does today, with one difference: `acc_uncategorise_bank_transaction` now releases **every** line reconciled to the voided entry, not only the line clicked. A transfer is taken back whole.
- A funding pair's two entries stay independent: each is taken back on its own line.
- The entries carry `source_type = 'bank'`, so today's rule for what Change may take back applies unchanged.

### 3.5 Screens

**Banking › Rules** gets a **Pairs** section above the rule list:
- **Funding pairs post to**, a picker of liability accounts, with the name-matched default preselected but not saved;
- **Pair within**;
- **Save**.

A viewer sees these as text.

**Review import**
- The new proposals appear in **Post as** and **Why**.
- A pair's picker option reads as in 3.3.
- The header counts add *transfers* and *possible funding*.

## 4. Software changes

### 4.1 Migration `0127_bank_pairs.sql`

- **`acc_banking_preference`**
  - Columns: `id boolean primary key default true check (id)`; `funding_account_id uuid references acc_account (id)`; `pair_window_days int not null default 7 check (pair_window_days in (0,1,3,7,14,30))`; `created_by`, `created_at`, `updated_by`, `updated_at`.
  - Triggers: `acc_stamp_actor` and `acc_audit_row_change`.
  - Row-level security: select for staff or viewer; insert and update for staff.
  - Grants: authenticated gets select, insert and update; service_role gets all; public and anon are revoked.
- **`acc_post_bank_pair(p_first uuid, p_second uuid, p_kind text) returns jsonb`** — security definer; behaves as in 3.4.
- **`acc_uncategorise_bank_transaction`** is replaced. Same signature and the same checks, but it deletes the reconciliations of, and resets to `unmatched`, every line reconciled to the voided entry.
- The migration changes nothing that already exists except that function.

### 4.2 Domain (pure, tested)

- `lib/domain/bank-pairs.ts`:
  - `PairLine`;
  - `findBankPairs(lines, windowDays, { fundingEnabled })` returns, for each line, its pair or the number of rival candidates;
  - `namedTransferTarget(description, otherBanks)`;
  - `suggestFundingAccount(accounts)`;
  - `PAIR_WINDOW_OPTIONS`.
- `lib/domain/statement-review.ts`:
  - `reviewProposal` takes the pair facts;
  - new proposal kinds `transfer` and `funding`;
  - the funding alternative;
  - a `pair` post item;
  - a pair key, so a pair is posted once.

### 4.3 Services and actions

- `lib/services/banking-preference.ts` — `getBankingPreference` and `saveBankingPreference` (validates a liability-type active posting account).
- `lib/services/statement-review.ts`
  - `loadImportReview` also reads every waiting line of the company (paged), the bank accounts, and the preference.
  - `postReviewItems` posts `pair` items through `acc_post_bank_pair`.
- Actions: `saveBankingPreferenceAction` on Rules. The existing review post action accepts pair items (schema updated).

### 4.4 Changelog 1.72

- Transfers between your own bank accounts.
- Shareholder funding pairs.
- The Pairs setting.

## 5. Proving it

1. **Unit tests**
   - Pairing:
     - a single candidate;
     - a rival candidate on either side;
     - outside the window;
     - equal signs;
     - a line used twice;
     - a transfer taking precedence over funding;
     - the base currency only;
     - pending lines and lines with a ledger match are excluded.
   - Named-transfer detection by last four digits and by name.
   - The name default for the funding account.
   - Precedence with the new kinds.
   - The funding alternative.
   - A pair posted once.
   - The schema.
2. **Migration**
   - A static test and `migration-grants`.
   - A rolled-back `scripts/verify-bank-pairs.mjs` on every company:
     - the preference's RLS and audit;
     - a transfer: one entry, two bank legs, two approved reconciliations;
     - Change on one side releases both;
     - funding: two entries whose descriptions name each other;
     - funding is refused with no preference;
     - the refusals: same line, the same bank for a transfer, unequal amounts, same signs, outside the window, non-staff.
   - Apply to every company only with the user's approval.
3. **Live, on PC-Test only**
   - Add a second sample bank account and a sample Shareholder Loan account.
   - Set the preference.
   - Import made-up statements for both bank accounts: a transfer, a named transfer, and a funding pair.
   - Review, post, check the entries, then take them back.
   - Screenshots in light and dark, at 1440 and 1280, shown before any push.

## 6. Constraints

- US English UI. No hex colours outside the token block. `DataTable` only. Paged reads.
- Nothing is posted without a person's click. A funding pair never starts ticked.
- Stage files by name. No Co-Authored-By trailer. Commit messages written with `printf`.
- No real client names or data in repo files. Test fixtures are invented.
- Migration 0127 goes live only with the user's approval. Writes to live data happen only on the sample company.
