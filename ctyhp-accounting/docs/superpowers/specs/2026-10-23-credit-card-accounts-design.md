# Credit cards in Bank Transactions and Bank Reconciliation (2.45)

Approved 23 Oct 2026. Asked for by a bookkeeper: "add credit card under bank reconciliation and bank transactions, I also need to add the transactions from credit cards."

## What exists

- A credit card is a ledger account of type `credit_card`, a liability.
- A bank account record (`acc_bank_account`) is what Bank Transactions, statement imports, bank rules, bank feeds and reconciliation all hang off.
- Migration 0072's trigger `acc_guard_bank_account_ledger` refuses any ledger account that is not type `bank`. A card therefore cannot be imported or reconciled. The bookkeeper imported a card CSV into the checking account and had to undo it.
- Everything downstream of the record is sign-agnostic and works for a liability as it stands, debit positive:
  - categorizing (0111);
  - bank pairs (0127);
  - Plaid amounts;
  - the reconciliation maths (0026, 0132, 0144);
  - the statement proof.
- Cash figures are keyed on `account_type = 'bank'`, so a card stays out of cash.

## Design

A card is a bank account record of a new kind, **Credit card**, and uses the same pipeline. Nothing is posted differently.

**1. Setting one up**
- Add bank account offers the kind *Credit card*.
- It lists active posting `credit_card` ledger accounts, and suggests the only one when there is just one.
- It can create a new one, in the 2000 block.
- Migration 0159 lets `acc_guard_bank_account_ledger` accept `credit_card`.

**2. Signs**
- The books keep every bank line and balance debit positive. For a card that means a charge is negative, a payment positive, and the balance owed negative. This is how a Chase card CSV, OFX and Plaid already sign them.
- On the screens that compare the books with a statement, a card's amounts are shown the way its statement prints them: the balance owed and charges positive, payments and credits negative. These screens are the import dialog's proof and lines, and the reconciliation list, workspace, report and standing card.
- Typed balances are read the same way and negated before anything is sent.
- One pure module, `lib/domain/card-account.ts`, does every flip:
  - `shown` / `stored`;
  - transforms for a statement, a reconciliation's detail and its book lines;
  - the labels.
- Screens transform their data once at the boundary, so the existing helpers work unchanged on consistent data: pairing, advice, difference explanations, the proof.
- Bank Transactions keeps the books' sign: a charge is negative, as the CSV shows it.

**3. Files**
- A card statement comes in as CSV, OFX, QFX or QIF, with its *previous balance* and *new balance* typed as the statement prints them.
- The existing "Flip signs" box reads, for a card, "my file shows charges as positive".
- A PDF is not read for a card in this release. PDF card layouts print charges positive and a summary block, so the dialog says to use the CSV and type the balances.
- Reconcile from statement files is refused for a card for the same reason. Its button is hidden on a card, and the page explains.

**4. Paying the card**
- A payment line on the card is matched to the entry already posted from the checking account through ledger-match suggestions. When both lines are waiting, the bank-pair transfer posts one entry. Nothing new is needed here; the live test proves it.

**5. Around it**
- A card is never "below zero":
  - `getBelowZeroBankAccounts` skips cards;
  - the Balance Sheet panel says "Bank and card accounts" and shows a card's balance as owed.
- Coding history (`acc_coding_history`, migration 0159) treats a card that has a bank record as the bank side, so card purchases teach suggestions. A checking-to-card transfer then has two statement lines and teaches nothing, as a bank-to-bank transfer does today.
- Settings › Import's "add bank record" lists credit card accounts too.

## Not in 2.45

- Reading card PDF statements: needs a sample statement.
- An unreconciled-card total on the dashboard.

## Tests

- Unit tests:
  - the sign module;
  - the setup kinds;
  - the dialog's card mode: what is sent is in the books' sign;
  - the below-zero filter;
  - the migration's text.
- A live check in a throwaway company, rolled back:
  1. add a card record;
  2. import a card CSV;
  3. code the charges;
  4. match a payment to a checking entry;
  5. reconcile with the balance owed typed positive; the difference is 0;
  6. the books are unchanged by reconciling.
