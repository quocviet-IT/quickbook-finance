# Payment detail, description edits, and correction — design

Date: 2026-08-05

## Goal

Close the two gaps left by the payment-void work: a receipt cannot be inspected
from the Payments screen, and correcting one takes two separate actions with
nothing tying them together.

After this change a user can open a receipt and see what it did, fix a typo in
its description without touching the ledger, and correct its money in one
action that either replaces the receipt or leaves it exactly as it was.

## Scope

The `/payments` screen, its Server Actions, `lib/services/invoicing.ts`, and one
company-scoped migration. Void and Create replacement already exist (migration
0095) and their behaviour does not change.

Out of scope, stated so nobody adds it:

- **Hard delete.** `acc_guard_document_number` (migration 0066) refuses to let
  an application session delete a numbered document, and that is the right
  answer: a missing PMT number is a hole in the audit trail nobody can explain.
  Void is the accounting equivalent and it is already shipped.
- **Editing amount, date, customer or allocations in place.** Rewriting a posted
  receipt would make a report printed yesterday unreproducible. Those changes go
  through Correct payment, which leaves the original readable.
- **Bill payments.** The same gaps exist on `/bills`, but that is its own slice.

## Decisions

| Question | Decision |
|---|---|
| What may be edited in place? | `method`, `reference`, `memo` — nothing that posts |
| Who may edit? | `canWrite` (admin, accountant), same as recording a receipt |
| A void receipt? | Read-only. It is a historical record, not a live one |
| How is money corrected? | One atomic RPC: void the old receipt, record the new one |
| What does the detail view show? | Receipt facts, allocations, journal lines, audit trail |

## Architecture

### Database — migration 0096

**`acc_update_payment_details(p_payment_id uuid, p_method text, p_reference text, p_memo text) returns void`**

Security definer, `acc_is_staff()` gated. Refuses when the payment is void.
Only three columns are writable through it, so the function itself is the
whitelist — no PostgREST caller can reach `amount_minor` this way. The existing
`acc_payment_atomic_audit` trigger records the change; `acc_stamp_actor` owns
`updated_at`/`updated_by` as everywhere else.

**`acc_correct_payment(p_payment_id uuid, p_reason text, p_customer_id uuid, p_payment_date date, p_currency text, p_amount_minor bigint, p_deposit_account_id uuid, p_method text, p_reference text, p_memo text, p_allocations jsonb) returns uuid`**

Calls `acc_void_payment` and then `acc_record_payment` inside one function, so
one transaction covers both. Every guard already written for the void applies
unchanged — an outstanding refund, a live bank match, a cleared statement line
or a closed period refuses the correction, and PostgreSQL rolls the whole thing
back. There is no state in which the old receipt is void and no new one exists.

The reason recorded against the void says what the correction was for, so the
audit trail reads as one story rather than two unrelated events.

### Application

- `lib/domain/schemas.ts`: `paymentDetailsSchema` (payment id plus the three
  description fields) and `paymentCorrectionSchema` (`paymentCreateSchema`
  extended with `payment_id` and a 1–500 character `reason`).
- `lib/services/invoicing.ts`: `updatePaymentDetails`, `correctPayment`, and
  `getPaymentDetail` — the last reads allocations (with invoice number and
  balance) and the journal lines of the payment's entry.
- `app/(app)/payments/actions.ts`: `getPaymentDetailAction`,
  `getPaymentAuditAction` (gated on the `audit.read` permission the invoices
  screen already uses), `updatePaymentDetailsAction`, and
  `correctPaymentAction`. The two mutations revalidate the same eight paths the
  void action does, because a correction moves the same balances.

### Interface

The Actions column becomes a paperclip icon plus a `···` menu holding **View**,
**Edit details**, **Correct payment**, **Refund** and **Void payment**. Five
buttons side by side would not fit the column, and the menu is what QuickBooks
users already expect.

- `PaymentDetailDrawer.tsx` — receipt facts including void attribution, the
  invoices it settled and for how much, the debit and credit lines of its
  journal entry, and the change history through the existing
  `DocumentAuditTrail` component.
- `EditPaymentDetailsModal.tsx` — three fields, submit through
  `updatePaymentDetailsAction`. Not offered on a void row.
- `ReceivePaymentModal.tsx` — gains a `correction` mode beside the existing
  `replacement` mode: the form is prefilled from the source receipt, a reason is
  required, and submitting calls `correctPaymentAction` instead of
  `recordPaymentAction`. The title reads "Correct payment".

Every file stays under the 400-line project ceiling; the two new components are
what keeps `PaymentsClient.tsx` a façade.

## Data flow

Correcting a receipt:

1. The row's `···` menu opens `ReceivePaymentModal` in correction mode with the
   source receipt.
2. The user edits what was wrong, types a reason, and submits.
3. `correctPaymentAction` validates with `paymentCorrectionSchema`, checks
   `canWrite`, and calls `correctPayment` on the company-bound client.
4. `acc_correct_payment` voids the old receipt, restoring the invoice balances
   it had settled, then records the new one against the invoices now chosen.
5. Eight cached views are revalidated and the table refreshes.

A refusal at any point in step 4 leaves every row exactly as it was.

## Error handling

Database refusals surface verbatim — "Reject or undo the bank match before
voiding this payment" tells the user what to do; "Correction failed" does not.
The action layer only supplies a message when the error is not an `Error`.

Editing a void receipt is prevented in three places, deliberately: the menu item
is absent, the action refuses, and the RPC refuses. The screen can be wrong; the
database cannot.

## Testing

- Unit: schema validation, the service adapters against a fake Supabase client,
  the actions' authorization and revalidation contract, and a UI contract test
  covering the new components and the 400-line ceiling.
- Migration contract: the RPC exists, is granted correctly, whitelists only the
  three description columns, and retargets into a company schema.
- Behavioural, rollback-only: extend the `verify-void-payment.mjs` pattern with
  a correction scenario proving the new receipt settles the invoice and the old
  one is void with its number intact, and a closed-period scenario proving the
  old receipt is still `applied` and no new receipt exists.
