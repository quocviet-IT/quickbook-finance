# Void Customer Payments Design

**Date:** 2026-08-04  
**Status:** Approved in conversation  
**Feedback:** `/payments` has no safe way to remove a demo or incorrectly
recorded customer receipt

## Context

The production `/payments` page was inspected with an authenticated, read-only
request before designing this change. It currently provides Receive payment,
attachment, and conditional refund actions, but no delete or void action.

Every customer payment is posted immediately. `acc_record_payment` assigns a
permanent payment number, posts a balanced journal entry, creates allocations,
and reduces invoice balances. Migration 0066 deliberately prevents application
users from physically deleting numbered documents. Therefore a literal delete
would violate the application's document-number and audit controls.

## Goals

- Give authorized users a safe way to remove the accounting effect of an
  incorrectly recorded customer payment.
- Attribute the void to a user, timestamp, and required reason.
- Restore affected invoice balances and statuses atomically.
- Preserve the original payment, number, allocations, attachments, journal, and
  audit evidence.
- Let a user create a reviewed replacement from the voided payment's original
  details without silently reactivating history.
- Work in every company schema through the existing migration and schema-bound
  request infrastructure.

## Non-goals

- No physical deletion of customer payments.
- No direct unvoid of the original row or journal entry.
- No automatic submission of a replacement payment.
- No automatic copying of attachments to a replacement; evidence remains linked
  to the original numbered payment.
- No changes to refund, bank reconciliation, period close, document numbering,
  or permission models beyond enforcing their existing constraints.
- No bulk void operation.

## User Experience

### Void payment

For a non-void payment, authorized users see a **Void** action in the Payments
table. Selecting it opens a confirmation modal that explains that the payment
will remain in history, its ledger effect will be removed, and invoice balances
will be restored. A reason is required before confirmation.

On success, the page refreshes and shows the payment with status **Void**. The
status detail identifies who voided it, when it was voided, and the reason. The
existing attachment action remains available so supporting evidence is not lost.

If the payment cannot be voided, the modal remains safe and the server-provided
reason is shown. No partial invoice, payment, or journal update is committed.

### Create replacement

A voided payment exposes **Create replacement** to authorized users. This opens
the existing Receive payment form in replacement mode and pre-fills:

- customer;
- amount and currency;
- payment date;
- deposit account;
- method;
- bank/check reference;
- memo.

The form reloads the customer's currently open invoices. It does not blindly
reuse old allocations because invoice balances may have changed since the void.
The user reviews or applies the current allocation and explicitly records the new
payment. The replacement receives a new payment number and journal entry.

## Database Design

Add a company-scoped migration after `0094_import_invoices.sql`.

### Payment attribution columns

Add to `acc_payment`:

- `voided_at timestamptz`;
- `voided_by uuid references auth.users(id)`;
- `void_reason text` with a trimmed, non-empty, bounded value when status is
  `void`.

Existing `updated_by` and the atomic audit trigger continue to capture the full
before/after row. The explicit void columns make the attribution available on the
Payments screen without requiring users to reconstruct it from the audit log.

### Atomic RPC

Add `acc_void_payment(p_payment_id uuid, p_reason text) returns void` as a
`security definer` function with a schema-retargetable `search_path`.

The RPC performs the following in one transaction:

1. Require `acc_is_staff()` and a non-empty normalized reason.
2. Lock the payment row and reject missing or already-void payments.
3. Reject a payment with any non-void customer refund referencing it.
4. Reject a payment with a bank-feed reconciliation in `suggested` or `approved`
   state. A rejected historical suggestion does not block the void.
5. Reject a payment whose journal lines belong to any statement reconciliation.
6. For each payment allocation, lock the invoice, restore its balance by the
   allocated amount without exceeding the invoice total, and derive status from
   the resulting balance (`issued`, `partial`, or `paid`). A void invoice is not
   modified.
7. Mark the original journal entry `void` and set its `voided_at`. The existing
   closed-period trigger rejects an entry dated in a closed period and rolls the
   whole RPC back.
8. Mark the payment `void`, set `unapplied_minor` to zero, and record
   `voided_by = auth.uid()`, `voided_at`, and `void_reason`.

The RPC does not delete allocation rows. Settlement-history queries already
exclude void payments, while the retained rows preserve which invoices were
affected.

Revoke public execution and grant the exact signature only to `authenticated`
and `service_role`, matching other financial RPCs.

## Application Design

### Service and types

- Extend `PaymentRow` with the three nullable void-attribution fields.
- Extend `listPayments` to select them.
- Add `voidPayment(sb, paymentId, reason)` in the invoicing service. It delegates
  only to `acc_void_payment`; no accounting behavior is duplicated in TypeScript.

### Server Action

Add `voidPaymentAction(paymentId, reason)` under the Payments route:

- reject users for whom `canWrite(role)` is false;
- validate the payment ID and trimmed reason with Zod;
- call the schema-bound server client and `voidPayment` service;
- revalidate `/payments`, `/invoices`, `/sales`, `/dashboard`,
  `/reports/ar-aging`, `/reports/customer-statement`, `/reports/cash-flow`, and
  `/reports/transactions`;
- return the established `ActionResult` shape and surface RPC errors.

### Page and Client

- Load the actor directory on the server and pass it to `PaymentsClient` so
  `voided_by` can be rendered as a name/email.
- Add a reason modal with explicit consequences and a destructive confirm style.
- Gate Void and Create replacement controls with `canWrite`.
- Keep the existing refund rule for remaining unapplied amounts.
- Replacement mode reuses the existing form and `recordPaymentAction`; it does
  not introduce a second posting path.

## Error Handling and Safety

- The database RPC is the authoritative guard; hidden buttons are not security.
- Closed-period, refund, bank-match, and statement-reconciliation failures are
  returned as specific user-facing errors.
- Busy state is reset in `finally` for both void and replacement preparation.
- A failed RPC leaves payment, allocations, invoices, and journal unchanged.
- Concurrent void attempts serialize on the locked payment and the second attempt
  receives the already-void error.
- The payment number remains in `acc_number_source` reports, so voiding creates no
  unexplained sequence gap.
- Multi-company migrations are applied by the existing migration runner and must
  contain no runtime hard-coding to `public` beyond patterns handled by
  `retargetToSchema()`.

## Testing

### Unit and contract tests

- Service test: correct RPC name and normalized arguments; RPC errors become
  `InvoicingError`.
- Action tests: unauthorized users are rejected, invalid reasons do not call the
  service, success revalidates required pages, and RPC errors are returned.
- UI/contract tests: active rows expose Void only to writers; void rows expose
  Create replacement; attribution and reason render; replacement pre-fills the
  original details without auto-submitting.
- Migration contract test: columns, grants, guards, row locks, invoice restoration,
  journal void, payment attribution, and no physical delete are present.

### Transactional verification

Add a rollback-based verification scenario following the repository's existing
financial verification pattern:

1. Create a customer, issued invoice, and payment with an allocation.
2. Void the payment through the RPC.
3. Assert invoice balance/status are restored exactly.
4. Assert the payment and original allocation still exist with void attribution.
5. Assert the journal entry is void and posted-ledger totals return to baseline.
6. Assert a second void fails.
7. Assert a non-void refund, bank match, reconciliation line, and closed period
   each block the operation with a full rollback.

### Final verification

- Focused unit and migration tests.
- `npm test`.
- `npm run typecheck`.
- `npm run lint`.
- `npm run build`.
- Full built-server smoke sweep.
- Browser verification of `/payments` at the feedback viewport, without creating
  or voiding production data.

## Acceptance Criteria

- Authorized users can void any eligible non-void customer payment from
  `/payments` after entering a reason.
- The action records who, when, and why.
- Invoice balances and statuses are restored atomically and the journal effect is
  removed without deleting history.
- Ineligible payments are blocked with actionable errors.
- Voided payments remain visible with attachments and attribution.
- Create replacement opens a pre-filled, reviewable form and only posts after the
  user explicitly confirms it.
- The feature works in every company schema.
- All focused and mandatory verification gates pass with no new errors or
  warnings.
