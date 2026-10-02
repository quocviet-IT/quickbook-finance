# Money between related companies on bank lines — design

**Date:** 2026-10-02
**Branch:** `feat/related-companies` (from `main` at 1.76)
**Release:** 1.77

## 1. What is asked

The client's side-by-side review of bank-statement handling ("Reading a bank statement, twice", 30 September) found two questions the client's prototype asks and OneBook does not. The second, cards and loans, shipped as 1.75 and 1.76. This design answers the first.

**Is this line money moving between two companies the same owners run?**
- Money sent to a sister company is a loan to it, and money received from one is a loan from it. Neither is income or a cost.
- Coded singly in each book, the same movement becomes income in one and a cost in the other. Both Profit and Loss statements are then wrong, and nothing on either Balance Sheet says who owes whom.
- The prototype (2.28) names each company in the group, with the other names a statement prints for it. A line whose description carries one of those names is proposed as **Due From** the other company when money goes out, or **Due To** it when money comes in. Because both companies are books in the same workbook, posting one side also writes the other.

**What the client's books show** (measured read-only on 2026-10-01; figures stay out of this repository):
- The companies named on the client's statements are not companies in OneBook, so OneBook cannot write their side.
- One book already carries due-from accounts for sister companies, holding opening balances only. One of them is used in both directions and carries a credit balance — one account per company, its sign saying who owes whom.
- Another book has an "Intercompany Transfer" account typed as other income. Coding to it would post this money as income, the error the review warns of. Retyping it is the accountant's decision, not this feature's.

## 2. Scope, as decided

Decided with the user on 2026-10-01 and 2026-10-02:

- **Approach A:** a register of **related companies** on **Banking › Rules**, beside Cards and loans. Recognition comes before rules and history.
- **One account per related company.** Money out debits it, money in credits it. A debit balance is money the company owes us; a credit balance is money we owe it.
- Short names on a statement ("AB") may be registered. They match whole words only.
- The account must be a current asset, a current liability or a long-term liability. An income or expense account cannot be chosen.
- A related-company line starts ticked on Review import and takes part in **Code all**, as a card's does.
- One release: **1.77**.
- **Out of scope**, until the client says whether the companies on its statements are to become OneBook companies:
  - linking a register entry to another OneBook company, and writing that company's side of the entry;
  - an "Intercompany Balances" report setting each book's figure beside the other's;
  - finding lines already coded to income or a cost that name a related company.

## 3. How it works

### 3.1 The register

Each company keeps a list of **related companies**. One entry is:

| Field | Rule |
|---|---|
| **Name** | 1–120 characters, trimmed. Unique in the company, ignoring case. |
| **Words** — how the bank names it | One or more phrases, comma-separated, ≤ 200 characters in all. Every phrase is at least 2 characters. At least one phrase. |
| **Account** — what it owes or is owed | An active posting account of type `current_asset`, `current_liability` or `long_term_liability`. |
| **Active** | On or off. |

- An account belongs to at most one related company.
- An account in the Cards and loans register cannot be a related company's account, and an account of a related company cannot be added to Cards and loans. Each save checks the other register.
- An entry can be switched off without deleting it. Switched off, it matches nothing.
- An entry whose account is no longer active and posting matches nothing, and the screen says why.
- Deleting or switching off an entry leaves every posted entry as it is.
- Staff write the register; viewers read it. Every change is audited.

**Default when adding an entry:**
- *Words*: the name with a trailing company suffix removed — `LLC`, `L.L.C.`, `Inc`, `Inc.`, `Corp`, `Corp.`, `Corporation`, `Co`, `Co.`, `Ltd`, `Ltd.`, with any comma before it ("Example Affiliate, LLC" → "Example Affiliate"). Filled into the form, never saved on its own.

### 3.2 Recognition

A waiting bank line **names** a related company when all of these hold:

- money **in or out** (a zero line names nothing);
- its bank account is in the base currency;
- the entry is active and its account is usable (3.1);
- the line's description matches **any** of the entry's phrases, each held to word boundaries and case-insensitive, exactly as a rule's words are (`wordPattern`). "AB" matches "WIRE TO AB" and "AB-" but not "TAB" or "ABC".

### 3.3 One register, one claim

Cards and loans (1.75, 1.76) and related companies are both things the person registered about this line's other side. They are weighed together:

- The **claimants** of a line are the card and loan entries that claim it (money out only, as today) and the related companies it names.
- One claimant: the line is that claimant's.
- Two or more: the line gets no proposal at all, and nothing below it is consulted. **Why** names them: "Matches Example Affiliate and 2050 Example Card — code it yourself". A related company is named by its name, and a card or loan by its account's code and name. More than two give "Matches A, B and 2 more — code it yourself".
- This replaces 1.75's "Matches 2 cards or loans — code it yourself" with the same rule in the new words.

### 3.4 Where it sits

The order on Review import is unchanged except that step 6 now includes related companies:

1. already handled;
2. ledger match;
3. the one open document;
4. transfer pair;
5. named transfer;
6. **card, loan or related company** (3.3);
7. rule;
8. history;
9. funding pair, only when nothing above applies;
10. needs coding.

On **Bank Transactions**, the Category suggestion comes from the same step 6, then rule, then history, as it does today for cards.

- A related company's proposal is an account proposal, as a card's is. A funding pair on the same line is offered beside it as the alternative, as it is beside a rule today.
- A rule or history that would have spoken is not offered beside it.

### 3.5 The proposal

- **Post as:** `Between companies · 1460 Due from/to Example Affiliate`.
- **Why:** "Names Example Affiliate, a related company. Money between your companies is owed, never income or a cost."
- On Bank Transactions the suggestion's short label is `Related`.
- It starts ticked on Review import and takes part in **Code all**.
- Posting goes through `acc_categorise_bank_transaction` to the related company's account, so **Change** takes it back through `acc_uncategorise_bank_transaction`. No new posting function.

### 3.6 Screens

**Banking › Rules** gets a **Related companies** section after **Cards and loans** and before the rule list:

- A table with these columns:
  - name;
  - matches on (the phrases);
  - account;
  - **balance today**: "Owes us 1,140.25" for a debit balance, "We owe 3,000.00" for a credit balance, "Settled" at zero, from posted entries dated on or before today, in the base currency;
  - **waiting lines** it names;
  - switch on or off;
  - edit;
  - delete.
- The table fits 1280px without a horizontal scroll, as Cards and loans does since 1.76.
- **Add related company** opens a form with name, words and account. The account picker offers only the allowed types, in code order.
- The form previews as you type: "Names 3 waiting lines", and lists the descriptions of up to ten of them, so a short phrase that catches too much is seen before it is saved.
- A viewer sees the table as text.

**Review import**
- The new proposal appears in **Post as** and **Why**.
- The header counts add *between companies*.

**Bank Transactions**
- A related-company suggestion shows in the Category cell like a card's, with the short label `Related`.

## 4. Software changes

### 4.1 Migration

**`0131_related_company.sql`**
- **`acc_related_company`**
  - Columns:
    - `id uuid` primary key;
    - `name text not null` (1–120 characters after trimming);
    - `account_id uuid not null unique references acc_account`;
    - `match_words text not null` (1–200 characters, not blank);
    - `is_active boolean not null default true`;
    - `created_by`, `created_at`, `updated_by`, `updated_at`.
  - A unique index on `lower(btrim(name))`.
  - Triggers: `acc_stamp_actor` and `acc_audit_row_change`.
  - Row-level security as `acc_bank_rule`: select for staff or viewer; insert, update and delete for staff.
  - Grants as `acc_bank_rule`.
- Nothing that exists changes.

It reaches every company through `scripts/migrate.mjs`, and only with the user's approval.

### 4.2 Domain (pure, tested)

- `lib/domain/related-companies.ts` (new):
  - `RelatedCompany`;
  - `seedRelatedWords(name)` — the default words (3.1);
  - `relatedAccountAllowed(account)`;
  - `usableRelated(entry, accounts)`;
  - `relatedMatches(entry, description)` — `phrasesOf` and `wordPattern`, reused from `repayments.ts` and `bank-rules.ts`;
  - `validateRelatedInput(input)` — name length, at least one phrase, every phrase at least 2 characters, words length;
  - `balanceWords(balanceMinor, currency)` — "Owes us …", "We owe …", "Settled".
- `lib/domain/register-claim.ts` (new) — the claim (3.3):
  - `RegisterClaim` = one card, one loan, one related company, or rivals with their labels;
  - `registerClaim(repayments, related, line, accounts)` replaces `repaymentFor` everywhere. `repayments.ts` keeps `repaymentHits`, every usable card or loan entry a line claims, which the claim builds on.
  - `rivalsWhy(labels)` returns the sentence in 3.3.
- `lib/domain/coding.ts`:
  - `suggestCoding` takes the claim in place of the repayment fact;
  - a related company gives `{ source: "related", accountId, relatedId }` before rules;
  - `codingView` gives the `Related` short label and the why in 3.5.
- `lib/domain/statement-review.ts`:
  - `reviewProposal` takes the rivals' labels in place of their count;
  - an account proposal carries `repayment: "card"` or `related: true`, for the *Post as* prefix and the header count.
- `lib/domain/schemas.ts`: the register input.

### 4.3 Services and actions

- `lib/services/related-companies.ts`:
  - list, save, switch, delete;
  - `previewRelated` (waiting lines named, with up to ten descriptions);
  - `relatedBalances` — one paged read of `acc_ledger_balances(null, today)`, kept to the register's accounts.
  - Save checks the account against the chart (type, active, posting) and against Cards and loans.
- `lib/services/repayments.ts`: save also refuses an account that is a related company's.
- `lib/services/coding.ts` and `lib/services/statement-review.ts` read the register and pass the claim in.
- Actions on Rules, guarded by `canWrite`.
- `lib/domain/company-export.ts`: `acc_related_company` joins `EXPORT_TABLES`.

### 4.4 Changelog and guide

- **1.77**: related companies registered on Banking › Rules; a line naming one is proposed to its account, never to income or a cost; the balance with each shows on the register. The entry says plainly that lines coded before 1.77 are not changed, and that the other company's books are not written.
- The banking flow in `lib/domain/system-guide.ts` gains a step, "Add related company".

## 5. Proving it

1. **Unit tests**
   - Recognition:
     - money in and money out;
     - word boundaries, including a 2-character phrase inside a longer word;
     - case;
     - a zero line, a foreign-currency bank, an inactive entry and an unusable account ignored.
   - The claim:
     - one related company;
     - two related companies refused, with both names in **why**;
     - a related company and a card refused;
     - two cards still refused, in the new words;
     - more than two give "and N more".
   - Precedence:
     - a related company above a rule that names another account, and above history;
     - a document, a transfer pair and a named transfer above it;
     - the funding alternative beside it.
   - Defaults and validation: the suffix list, a 1-character phrase refused, a blank words field refused, the name length.
   - Balance words for a debit, a credit and zero.
   - Ticking: a related-company line starts ticked.
2. **Migration**
   - A static test and `migration-grants`.
   - A rolled-back `scripts/verify-related-companies.mjs` on every company, authenticating through `request.jwt.claims`:
     - RLS: a viewer reads but cannot insert, update or delete;
     - audit rows on insert, update and delete;
     - the checks: blank name, blank words, a duplicate name in another case, a second entry on one account;
     - a money-out and a money-in post through `acc_categorise_bank_transaction` to the related account, with the expected debit and credit;
     - Change takes one back.
3. **Live, on PC-Test only**
   - Add a sample account "Due from/to Example Affiliate" if missing.
   - Register "Example Affiliate, LLC" with the words "Example Affiliate, EXA".
   - Import a made-up statement with money out and money in naming it, and one line naming it beside a registered card.
   - Review, post, check the entries and the balance on the register, then take them back.
   - Screenshots in light and dark, at 1440 and 1280, shown before any push.
4. The four gates and the full smoke sweep against a built server.

## 6. Constraints

- US English UI. No hex colours outside the token block. `DataTable` only. Paged reads.
- Nothing is posted without a person's click.
- Money in minor units end to end.
- Stage files by name. No Co-Authored-By trailer. Commit messages written with `printf`.
- No real client names, account digits or figures in repository files. Fixtures are invented.
- Migration 0131 goes live only with the user's approval. Writes to live data happen only on the sample company.
