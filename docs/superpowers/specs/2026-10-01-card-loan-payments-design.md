# Card payments and loan instalments on bank lines — design

**Date:** 2026-10-01
**Branch:** `feat/card-loan-payments` (from `main` at 1.74)
**Releases:** 1.75 (cards), 1.76 (loans)

## 1. What is asked

The client's side-by-side review of bank-statement handling ("Reading a bank statement, twice", 30 September) found two questions the client's prototype asks and OneBook does not. This design answers the second of them; the first, money between the client's own companies, comes after it.

**Is this line a card payment or a loan instalment?**
- Paying a card is not a cost. The costs were the card's own charges, already in the books; coding the payment to an expense counts them twice.
- A loan instalment is part principal, part interest. Only the interest belongs on the Profit and Loss.
- The prototype keeps a register of cards and loans. A line whose description carries one of a register entry's words is proposed as a payment to it: the whole amount to the card, or principal and interest for a loan.

**What the client's books show** (measured read-only on 2026-10-01; figures stay out of this repository):
- Card payments in the real books were coded correctly, and history (1.70) already proposes the right card for cards paid often. It proposes nothing for a card paid rarely, and once proposed an expense account for one.
- Every loan instalment in the real books was posted whole to the loan account. Interest was never split out. History therefore proposes the same whole-amount posting every month. The loan balance on the books is understated and interest expense is missing; correcting the past is the accountant's adjusting entry, not this feature.

## 2. Scope, as decided

Decided with the user on 2026-10-01:

- Cards and loans come before money between companies.
- **Approach A:** a register of cards and loans on **Banking › Rules**. Recognition comes before rules and history.
- **Interest:** estimated as the balance owed on the books × the annual rate ÷ 12, with the basis shown, editable on every line before posting. A loan may instead carry a fixed interest amount per payment, or none, in which case the interest is typed each time.
- A loan line never starts ticked. A card line starts ticked, as a rule's does.
- Two releases: **1.75** cards, **1.76** loans.
- **Out of scope:**
  - escrow and fees inside an instalment;
  - amortisation schedules;
  - money in from a lender (loan proceeds) and refunds from a card;
  - correcting loan payments already posted;
  - money between companies (next design).

## 3. How it works

### 3.1 The register

Each company keeps a list of **cards and loans**. One entry is:

| Field | Card | Loan |
|---|---|---|
| **Account** — what the payment repays | an active posting account of type `credit_card` | an active posting account of type `current_liability` or `long_term_liability` |
| **Words** — how the bank names it | one or more phrases, comma-separated | the same |
| **Last four** — digits the bank prints | optional, exactly four digits | the same |
| **Interest account** | — | an active posting account of type `expense` or `other_expense` |
| **Interest** | — | one of: *a rate a year* (0–100%, up to three decimals); *a fixed amount per payment*; *entered each time* |

- An account appears in the register at most once.
- An entry needs words, last four, or both.
- An entry can be switched off without deleting it. Switched off, it matches nothing.
- An entry whose account or interest account is no longer active and posting matches nothing, and the screen says why.
- Staff write the register; viewers read it. Every change is audited.

**Defaults when adding an entry:**
- *Words*: the account's name without its trailing digits and dots ("Example Card 4321" → "Example Card").
- *Last four*: the last four digits in the account's name, if any.
- *Interest account* (loan): the first active `expense` or `other_expense` account, in code order, whose name contains "interest".
- Defaults are filled into the form, never saved on their own.

### 3.2 Recognition

A waiting bank line is a **repayment** of a register entry when all of these hold:

- money **out**;
- its bank account is in the base currency;
- the entry is active and its accounts are usable (3.1);
- the line's description matches **any** of the entry's phrases, each held to word boundaries and case-insensitive, exactly as a rule's words are (`wordPattern`); **or** it contains the entry's last four as a run of exactly four digits (`(^|\D)dddd(\D|$)`).

**One entry or nothing:**
- One matching entry: the line is that entry's repayment.
- Two or more: the line gets no proposal at all, and nothing below it is consulted. **Why** says: "Matches 2 cards or loans — code it yourself".

### 3.3 Where it sits

The order on Review import becomes:

1. already handled;
2. ledger match;
3. the one open document;
4. transfer pair;
5. named transfer;
6. **card or loan**;
7. rule;
8. history;
9. funding pair, only when nothing above applies;
10. needs coding.

On **Bank Transactions**, whose Category suggestion today comes from rule, then history, the card or loan step comes before both in the same way. Ledger matches and settling keep their own columns there and are unchanged.

- A card repayment is an account proposal like a rule's. A funding pair on the same line is offered beside it as the alternative, as it is beside a rule today.
- A loan repayment is its own kind of proposal. No funding alternative is offered beside it.
- A rule or history that would have spoken is not offered beside either. The register is what the person said about this account.

### 3.4 Cards (1.75)

- **Post as:** `Card payment · 2050 Example Card`.
- **Why:** "Card payment — repays 2050 Example Card. A card payment is never an expense."
- On Bank Transactions the suggestion's short label is `Card`.
- It starts ticked on Review import and takes part in **Code all**, as a rule's suggestion does.
- Posting goes through `acc_categorise_bank_transaction` to the card account. No new posting function.
- If the card is also set up as a bank account in OneBook, its own statement's payment line later finds this entry as a ledger match, as a named transfer's does.

### 3.5 Loans (1.76)

**The interest proposed.**

- **Rate a year.** The balance owed is the loan account's credits less its debits over posted entries dated on or before the payment date. Then:
  - interest = owed × rate ÷ 12, in minor units, rounded half up;
  - never more than the payment, never below zero; nothing owed gives zero;
  - when several waiting lines repay the same loan, they are taken in date order, and each one's owed is reduced by the principal estimated on the lines before it.
- **Fixed.** Interest = the fixed amount, never more than the payment.
- **Entered each time.** No interest is proposed. The line cannot be posted until one is typed.

**On screen:**
- **Post as:** `Loan payment · 2500 Example Loan`.
- **Why**, by method:
  - rate: "Principal 1,600.00 to 2500 Example Loan, interest 400.00 to 8100 Interest Expense — estimated at 4.000% a year on 120,000.00 owed, ÷ 12. Check it against the lender's statement."
  - fixed: "… interest 400.00 — the fixed amount for this loan."
  - entered each time: "Enter the interest from the lender's statement."
- A **Split…** link opens one dialog, used on both Review import and Bank Transactions. It shows:
  - the payment;
  - the interest, editable, with the basis under it;
  - the principal, worked out as payment less interest and not editable;
  - the two accounts.
- A loan line **never** starts ticked. It is never part of **Code all**.
- An interest typed in the dialog is kept for that line until the page is left; it is not stored.

**Posting** — `acc_post_bank_loan_payment(p_transaction_id, p_repayment_id, p_interest_minor)`:
- One entry, dated the line's date, through `acc_post_entry`, which keeps the closed-period guard.
- Debit the loan account with the principal; debit the interest account with the interest; credit the bank's ledger account with the payment. A zero leg is left out.
- The loan and interest accounts are taken from the register entry, never from the caller. Only the interest comes from the caller.
- Description: the line's description, then " — loan payment". Leg memos: "Principal" and "Interest"; the bank leg's memo is the line's description.
- The bank leg gets an approved reconciliation and the line becomes `matched`.
- `source_type = 'bank'` with no source id, so **Change** takes it back through `acc_uncategorise_bank_transaction` unchanged.

**Checks inside the function:**
- The caller is staff.
- The line exists, is `unmatched`, is not pending, has no reconciliation, and is money out.
- Its bank account is in the base currency.
- The register entry exists, is active, and is a loan.
- Its loan account is an active posting liability, and its interest account is an active posting expense or other expense.
- The interest is a whole number of minor units from zero up to the payment.

It returns the entry number.

### 3.6 Screens

**Banking › Rules** gets a **Cards and loans** section between **Pairs** and the rule list:

- A table with these columns:
  - kind;
  - account;
  - matches on (words · ••dddd);
  - interest (rate, fixed or "Entered each time", with the interest account);
  - **past payments caught**, "12 of 12";
  - **waiting lines** it would take;
  - switch on or off;
  - edit;
  - delete.
- **Add card** in 1.75; **Add loan** in 1.76.
- The form previews as you type:
  - "Catches 12 of 12 past payments to 2050 Example Card · 2 waiting lines";
  - and lists, up to ten, the descriptions of past payments to that account it would miss.
  - A *past payment* is a finished entry with one bank leg and the other leg on that account, money out, as `acc_coding_history()` returns them. It is caught when any of its texts matches.
- A viewer sees the table as text.

**Review import**
- The new proposals appear in **Post as** and **Why**.
- The header counts add *card payments* and *loan payments*.

**Bank Transactions**
- A card suggestion shows in the Category cell like a rule's.
- A loan line shows `Loan payment` with **Split…**, which posts from the dialog.

## 4. Software changes

### 4.1 Migrations

**`0129_repayment_register.sql`** (1.75)
- **`acc_repayment_account`**
  - Columns:
    - `id uuid` primary key;
    - `kind text` (`card` or `loan`);
    - `account_id uuid not null unique references acc_account`;
    - `match_words text not null default ''` (≤ 200 characters);
    - `match_digits text` (four digits or null);
    - `interest_account_id uuid references acc_account`;
    - `interest_method text` (`rate`, `fixed`, `entered`);
    - `annual_rate numeric(6,3)` (0–100);
    - `fixed_interest_minor bigint` (≥ 0);
    - `is_active boolean not null default true`;
    - `created_by`, `created_at`, `updated_by`, `updated_at`.
  - Checks:
    - words or digits present;
    - a card has no interest fields;
    - a loan has an interest account and a method;
    - `rate` has a rate;
    - `fixed` has an amount.
  - Triggers: `acc_stamp_actor` and `acc_audit_row_change`.
  - Row-level security as `acc_bank_rule`: select for staff or viewer; insert, update and delete for staff.
  - Grants as `acc_bank_rule`.
- Nothing that exists changes.

**`0130_loan_payment.sql`** (1.76)
- `acc_post_bank_loan_payment(uuid, uuid, bigint) returns jsonb`, security definer, as in 3.5.
- Execute is granted to authenticated and service_role; public and anon are revoked.
- Nothing that exists changes.

Both migrations reach every company through `scripts/migrate.mjs`, and only with the user's approval.

### 4.2 Domain (pure, tested)

- `lib/domain/repayments.ts`:
  - `RepaymentAccount`;
  - `repaymentFor(entries, line)` returns one entry, a count of rivals, or nothing;
  - `seedWords(accountName)` and `seedDigits(accountName)`;
  - `usableRepayment(entry, accounts)`;
  - `validateRepaymentInput`;
  - `estimateInterest({ method, annualRate, fixedMinor, owedMinor, paymentMinor })` returns `{ interestMinor | null, basis }`;
  - `estimateLoanLines(lines, owedAt)`, the date-ordered carry;
  - `owedAt(movements, date)`.
  - The rate is handled in thousandths of a percent, so the arithmetic stays in integers.
- `lib/domain/coding.ts`:
  - `suggestCoding` takes the register;
  - a card gives `{ source: "card" }` before rules;
  - a loan, or two entries, give no single-account suggestion, so rule and history stay silent.
- `lib/domain/statement-review.ts`:
  - `reviewProposal` takes the repayment fact;
  - new proposal kind `loan`;
  - the "2 cards or loans" refusal;
  - a `loan` post item `{ transactionId, repaymentId, interestMinor }`;
  - `startsTicked` is false for `loan`.
- `lib/domain/schemas.ts`:
  - the register input;
  - the loan post item (interest a non-negative integer).

### 4.3 Services and actions

- `lib/services/repayments.ts`:
  - list, save, switch, delete;
  - `previewRepayment` (past payments caught and missed, waiting lines);
  - `loanFacts`, which reads the posted movements on registered loan accounts (paged) and returns each waiting loan line's proposed interest and basis.
- `lib/services/coding.ts` and `lib/services/statement-review.ts` read the register and pass it in. `postReviewItems` posts `loan` items through `acc_post_bank_loan_payment`.
- Actions:
  - register actions on Rules, guarded by `canWrite`;
  - a loan post action on Bank Transactions;
  - the review post action accepts `loan` items.

### 4.4 Changelog and guide

- **1.75**: card payments recognised from the register, and the Cards and loans section.
- **1.76**: loan instalments split into principal and interest. The entry also says plainly that loan payments posted before 1.76 are not changed.
- The banking flow in `lib/domain/system-guide.ts` gains a step on registering cards and loans.

## 5. Proving it

1. **Unit tests**
   - Recognition:
     - by words, by last four, and both;
     - word boundaries;
     - money in ignored;
     - a foreign-currency bank ignored;
     - an inactive entry or an unusable account ignored;
     - two entries refused.
   - Precedence:
     - a card above a rule that names another account;
     - a loan silences rule and history;
     - a document and a transfer pair above both;
     - the funding alternative beside a card and not beside a loan.
   - Interest:
     - the rate on a worked example (`120,000.00 × 4.000% ÷ 12 = 400.00`);
     - rounding half up at a cent boundary;
     - the cap at the payment;
     - nothing owed;
     - fixed, and fixed above the payment;
     - entered each time;
     - two lines for one loan carrying the principal.
   - Defaults, validation, and the schema.
   - Ticking: a card starts ticked, a loan never does.
2. **Migration**
   - A static test and `migration-grants`.
   - A rolled-back `scripts/verify-card-loan.mjs` on every company, authenticating through `request.jwt.claims`:
     - the register's RLS and audit, and its checks;
     - a card post through `acc_categorise_bank_transaction`;
     - a loan post with three legs, and with zero interest giving two;
     - Change takes a loan post back;
     - the refusals: interest above the payment or below zero, money in, a card entry, a switched-off entry, an interest account of the wrong type, a pending or matched line, a foreign-currency bank, a non-staff caller.
3. **The client's own book, read-only.** With the client's cards and loan entered in a throw-away register in memory, every past card and loan payment is recognised and none is proposed to an expense account. The script stays out of the repository; the result is reported to the user.
4. **Live, on PC-Test only**
   - Add a sample card account, a sample loan and Interest Expense if missing.
   - Register them.
   - Import a made-up statement with two card payments and two loan instalments.
   - Review, split, post, check the entries, then take them back.
   - Screenshots in light and dark, at 1440 and 1280, shown before any push.
5. The four gates and the full smoke sweep against a built server.

## 6. Constraints

- US English UI. No hex colours outside the token block. `DataTable` only. Paged reads.
- Nothing is posted without a person's click. A loan line never starts ticked.
- Money in minor units end to end. Principal is worked out on the server from the payment and the interest; a total sent by the browser is never trusted.
- Stage files by name. No Co-Authored-By trailer. Commit messages written with `printf`.
- No real client names, account digits or figures in repository files. Fixtures are invented.
- Migrations 0129 and 0130 go live only with the user's approval. Writes to live data happen only on the sample company.
