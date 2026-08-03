# Settling an Invoice or Bill from a Bank Line

- **Date:** 2026-08-03
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Source:** System test user feedback, Finding 3 ("Bank Transactions should be the central hub
  for payment matching"), second slice
- **Related:** `docs/superpowers/specs/2026-07-24-bank-reconciliation-sessions-design.md`,
  `US_ACCOUNTING_USER_MANUAL/05_Banking_and_Reconciliation.md`

## 1. What exists, and why it is not this

The bank review queue can already match a line to a **posted** journal line in the same bank's
GL account (`acc_upsert_bank_match_suggestions`, `acc_decide_bank_match`). That answers "this
money is already in the books, do not book it twice."

It cannot answer the opposite question, which is the one people arrive with: *this money is not
in the books yet, and it pays invoice 1042.* Today that means leaving Banking, going to
Payments or Pay Bills, re-typing the amount and date that are already on screen, and coming
back to find the matcher has caught up. This slice closes that.

The first slice (already shipped) put matching and the line in one table. This one adds the
ability to create the settlement from that table.

## 2. Scope

### In scope
- From a bank line in the review queue, allocate it against open invoices (money in) or open
  bills (money out), and post the resulting receipt or payment.
- One atomic RPC: create the settlement, link it to the bank line, mark the line matched.
- Candidate ranking, so the likely documents surface without a search.

### Out of scope, and why
- **Categorising a line to an expense account.** Different posting, different slice.
- **Splitting one line across several categories**, **transfers**, **exclude with a reason**.
  All specified in the banking manual; none is this.
- **Multi-currency settlement.** A document in a currency other than the bank account's is
  refused rather than converted. FX settlement is its own module and inventing a rate inside a
  bank matcher is the wrong place for it.
- Editing or reversing a settlement from here. Void the payment where payments are voided.

## 3. Design

### 3.1 Direction decides everything

`acc_bank_transaction.amount_minor` is signed: positive is money in, negative is money out.
That single fact picks the entire path, and nothing else needs to be asked:

| Sign | Documents offered | Settlement created | Existing RPC |
|---|---|---|---|
| `> 0` | open invoices (`issued`, `partial`, balance > 0) | customer receipt | `acc_record_payment` |
| `< 0` | open bills (`open`, `partial`, balance > 0) | bill payment | `acc_pay_bills` |
| `= 0` | none — refused | — | — |

The deposit/payment account is not a choice either: it is the GL account behind the bank
account the line arrived on (`acc_bank_account.account_id`). A bank line is by definition money
that moved through that account, so offering a picker would only allow a wrong answer.

### 3.2 The RPC

`acc_settle_from_bank_transaction(p_bank_transaction_id uuid, p_allocations jsonb, p_method text, p_memo text)`

`p_allocations` is `[{ "document_id": uuid, "amount_minor": bigint }]` — invoices or bills
according to the sign, so the caller never states which.

In order:
1. `acc_has_permission('banking.match')`, else refuse. Same gate as deciding a suggestion.
2. Lock the bank transaction. It must exist and be `unmatched`. A line already `matched` or
   `ignored` is refused — this is what stops one bank line paying the same invoice twice.
3. Refuse a zero amount, and refuse an empty allocation list.
4. Resolve the bank account, its GL account and its currency.
5. Read the allocated documents. They must all belong to one customer (or one vendor), and
   every one must be in the bank account's currency. Both are refused rather than coerced.
6. Allocations must sum to no more than `abs(amount_minor)`. The payment total is the bank
   line's amount and is never anything else — the bank is the authority on how much moved.
   Any remainder is left unapplied on the customer or vendor account, which both RPCs already
   model, and which the payment screens already report.
7. Call the existing RPC. **All ledger rules stay where they are**: `acc_record_payment` and
   `acc_pay_bills` own posting, period-close guards, discount windows and numbering. This
   function orchestrates; it re-implements nothing.
8. Insert `acc_reconciliation` with `status = 'approved'`, `confidence = 1.000`,
   `rule_applied = 'manual_settlement'`, and the new settlement's id.
9. Reject any other `suggested` row for the same bank line — the question has been answered.
10. Set the bank transaction to `matched`.
11. Write `acc_audit_log`.

Steps 7–10 are one transaction. A settlement that posts without linking would leave the bank
line looking unreviewed and invite a second payment.

### 3.3 One new column

`acc_reconciliation` links to `payment_id` (a customer receipt) and `journal_line_id`. There is
no column for a bill payment, so paying a bill from a bank line has nowhere to record itself.

Add `bill_payment_id uuid references acc_bill_payment (id) on delete cascade`, with a partial
unique index mirroring the one on `journal_line_id`: a bill payment may be approved against at
most one bank transaction. Without it, two bank lines could both claim the same payment and the
statement would reconcile twice.

### 3.4 Candidate ranking

Pure, in `lib/domain/bank-settlement.ts`, so the ordering is testable and the screen does not
invent its own:

- **Exact amount** — document balance equals the line, to the minor unit. The strongest signal
  by far and ranked first.
- **Date proximity** — days between the document date and the bank date, nearer is better.
- **Direction and currency** are filters, not signals: a document that fails either is not a
  candidate at all.

Ranking only orders what a person then chooses. It never auto-posts: this creates money
movement, and a wrong guess is a wrong payment against a real customer.

## 4. Testing

Unit, with concrete numbers:
- Ranking puts an exact-amount match first, and prefers the nearer date when amounts tie.
- A document in another currency, or on the wrong side of the sign, is not a candidate.
- Allocation totals: at, under and over the bank amount.

Database, through the RPC:
- Money in settles an invoice, the invoice balance falls, the bank line becomes `matched`, and
  `acc_reconciliation` carries the payment.
- Money out settles a bill and links through `bill_payment_id`.
- A second attempt on the same bank line is refused.
- Documents from two different customers in one call are refused.
- A closed period is refused — by `acc_post_entry`, not by anything added here.

## 5. Risks

**Double settlement** is the one that costs money. Three things stop it: the bank line must be
`unmatched` and is locked for update; the new partial unique index on `bill_payment_id`; and the
existing one on `journal_line_id`.

**Orchestrating two RPCs that each post.** Only one is called per invocation, and Postgres
gives the whole function one transaction, so a failure anywhere leaves nothing behind.

**Ranking read as authority.** It is presentation. The person allocates, and the amount is the
bank's. Wording on screen should not imply the system knows which invoice this was.
