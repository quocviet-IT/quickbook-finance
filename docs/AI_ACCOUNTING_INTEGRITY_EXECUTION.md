# AI Execution Guide: Accounting Integrity Hardening

## Objective

Harden the accounting database and application before production by fixing authorization bypasses, incomplete ledger validation, unsafe payment allocation, non-atomic reconciliation, historically incorrect void behavior, and non-atomic auditing.

The implementation target is:

`C:\Users\pit010\QUICKBOOK_WEBAPP\ctyhp-accounting`

Do not modify application behavior outside this scope unless it is required to preserve compatibility with the corrected accounting workflows.

## Required Reading

Before changing code, read these files completely:

1. `ctyhp-accounting/AGENTS.md`
2. `PRD/PRD_US_Accounting_Web_App.md`
3. `US_ACCOUNTING_USER_MANUAL/README.md`
4. `docs/superpowers/specs/2026-07-15-ctyhp-accounting-webapp-design.md`, applying the US scope above whenever the older design differs
5. All migrations in `ctyhp-accounting/supabase/migrations/`, especially migrations `0001` through `0013`
6. Relevant services and Server Actions under:
   - `ctyhp-accounting/lib/services/`
   - `ctyhp-accounting/app/(app)/`
7. Existing unit tests and database verification scripts under:
   - `ctyhp-accounting/tests/`
   - `ctyhp-accounting/scripts/`

Do not use country-specific requirements from `QUICKBOOK_USER_MANUAL` as implementation instructions. That directory is a legacy Australia reference; the US PRD and US manual are authoritative.

## Working Rules

- Run `git status --short` before editing.
- Preserve all unrelated user changes and untracked files.
- Do not edit migrations `0001` through `0013`; assume they may already be deployed.
- Implement database changes in one or more new forward-only migrations, beginning with the next available migration number, such as `0014_accounting_integrity_hardening.sql`.
- Do not reset, revert, delete, or overwrite existing work.
- Do not migrate or connect to a production database without explicit authorization.
- Do not commit or push unless explicitly requested.
- Enforce financial invariants in PostgreSQL, not only in React, Server Actions, TypeScript, or Zod.
- Prefer transactional PostgreSQL RPCs for multi-table financial operations.
- Preserve useful error messages without exposing secrets or internal credentials.

## Required Changes

### 1. Restrict direct financial-table writes

Review and replace RLS policies that currently give staff unrestricted `FOR ALL` access to financial tables.

Direct `INSERT`, `UPDATE`, and `DELETE` access must not allow an authenticated client to bypass posting, allocation, reversal, reconciliation, or audit logic.

At minimum, protect:

- `acc_invoice`
- `acc_invoice_line`
- `acc_payment`
- `acc_payment_allocation`
- `acc_bill`
- `acc_bill_line`
- `acc_expense`
- `acc_expense_line`
- `acc_bill_payment`
- `acc_bill_payment_allocation`
- `acc_reconciliation`
- `acc_bank_transaction`
- `acc_journal_entry`
- `acc_journal_line`
- `acc_audit_log`

Requirements:

- Keep appropriate read access for registered application roles.
- Route financial mutations through role-checked `SECURITY DEFINER` functions.
- Revoke unsafe function/table privileges where necessary and grant only the minimum required access.
- Ensure `SECURITY DEFINER` functions use a fixed, safe `search_path`.
- If draft documents currently require multiple client-side inserts, add atomic RPCs that create the header, lines, and audit event in one transaction.
- Keep `acc_audit_log` append-only. No application role may update or delete audit events.

### 2. Harden the journal posting boundary

Update or replace `acc_post_entry` so every persisted entry satisfies all ledger invariants.

Requirements:

- The caller must be authorized staff.
- The line payload must be a non-empty JSON array with the required fields and valid types.
- Every line must have exactly one positive side: debit or credit.
- Negative amounts and zero-sided lines must be rejected.
- Transaction-currency debit total must equal transaction-currency credit total.
- Base-currency debit total must equal base-currency credit total.
- Every referenced account must exist, have `status = 'active'`, and have `is_posting_account = true`.
- Reject malformed, duplicate, or otherwise unsafe line data when it would violate an accounting invariant.
- Do not trust arbitrary client-provided `amount_base_minor` when it can be calculated from the configured exchange rate inside PostgreSQL.
- Keep sequence allocation, journal header creation, journal-line creation, and auditing atomic.
- Reports must not silently omit a valid journal line because it was posted to a non-posting account.

Where a specialized RPC knows the semantic role of an account, validate it. Examples:

- Customer deposit account: `bank` or another explicitly supported cash account type.
- Accounts Receivable control account: `accounts_receivable`.
- Accounts Payable control account: `accounts_payable`.
- Bill/expense lines: an allowed expense or asset account type according to the product requirements.

### 3. Correct customer-payment allocation

Harden `acc_record_payment`.

For every allocation:

- `amount_minor` must be greater than zero.
- `invoice_id` must not be duplicated within the payload.
- The invoice must exist.
- The invoice must belong to `p_customer_id`.
- The invoice currency must equal `p_currency`.
- The invoice status must be `issued` or `partial`.
- The allocation must not exceed the current invoice balance.

For the complete payment:

- Total allocation must not exceed `p_amount_minor`.
- Negative or skipped allocation rows must not be able to reduce the calculated allocation total.
- Lock affected invoices in a deterministic order before updating them to prevent races and deadlocks.
- Payment creation, journal posting, invoice balance updates, allocation rows, and the audit event must commit or roll back together.

Apply equivalent defensive validation to bill payments. Preserve the existing vendor, currency, status, and balance checks while adding positive-amount and duplicate-bill validation.

### 4. Make reconciliation one-to-one and atomic

Replace the multi-request approval flow with a transactional, role-checked database RPC.

Requirements:

- Lock the reconciliation row, bank transaction, and payment during approval.
- Only a `suggested` reconciliation may be approved.
- The bank transaction must still be `unmatched`.
- The payment must exist and must not be void.
- One bank transaction may have at most one approved reconciliation.
- One payment may have at most one approved reconciliation.
- Add partial unique indexes or equivalent database constraints for these approved-only uniqueness rules.
- Set `approved_by = auth.uid()` and update the timestamp.
- Change the bank transaction status to `matched` in the same transaction.
- Write the audit event in the same transaction.
- Reject concurrent or repeated approval cleanly.
- Do not leave reconciliation and bank-transaction states partially updated after an error.

Review rejection behavior as well. It must use a valid state transition and must not invalidate an already approved match.

### 5. Implement historically correct reversals

Do not remove an original entry from all historical reports merely by changing its status from `posted` to `void`.

Requirements:

- Preserve the original posted journal entry as historical evidence.
- Create a new reversal journal entry that swaps the original debits and credits.
- Date the reversal using an explicit void/reversal date. If the public API changes, update services and Server Actions while preserving reasonable backward compatibility.
- Store a reliable relationship between the original entry and its reversal, using explicit columns or other constrained metadata.
- Prevent a second reversal of the same original entry.
- Ensure the reversal itself is balanced in both transaction and base currencies.
- Update the source document state atomically with the reversal and audit event.
- Apply the same model consistently to invoices, bills, expenses, and bill payments.
- Preserve subledger correctness when a bill payment is reversed, including restoration of bill balances and statuses.
- A reversal recorded in a later period must not change reports for an earlier period.

### 6. Make auditing atomic

Every financial mutation and its audit event must be in the same database transaction.

Requirements:

- If audit insertion fails, the business mutation must roll back.
- Do not report an operation as failed after its financial changes have already committed.
- Remove or avoid post-commit `writeAudit()` calls for operations moved into transactional RPCs.
- Record the authenticated actor inside PostgreSQL using `auth.uid()`.
- Include useful before/after or action metadata without storing secrets.
- Keep non-financial service-level audit calls only where they are demonstrably atomic or where a transactional RPC is not required.

## Required Tests

Add tests at the lowest layer capable of proving each invariant. Pure TypeScript tests are not sufficient for PostgreSQL RLS, constraints, triggers, concurrency, or transactions.

### Authorization and RLS

- A viewer cannot perform financial mutations.
- An accountant cannot directly update or delete an issued invoice.
- An accountant cannot directly insert, update, or delete payment allocations.
- An accountant cannot directly modify posted journal lines.
- No application role can update or delete audit rows.
- Approved RPC workflows still succeed for authorized staff.

### Journal integrity

- Reject an entry with unequal transaction-currency debit and credit totals.
- Reject an entry with equal transaction totals but unequal base-currency totals.
- Reject negative amounts.
- Reject a zero-sided line.
- Reject an inactive account.
- Reject a non-posting account.
- Accept a valid balanced entry.
- Confirm Trial Balance remains balanced after valid postings.

### Customer payments

- Reject an allocation to another customer's invoice.
- Reject an allocation in another currency.
- Reject allocation to a draft, paid, or void invoice.
- Reject zero and negative allocation amounts.
- Reject duplicate invoice IDs in one payload.
- Reject total allocation greater than the payment amount.
- Confirm a valid allocation updates payment status, unapplied amount, invoice balance, invoice status, journal, and audit record atomically.

### Bill payments

- Reject a bill belonging to another vendor.
- Reject a bill in another currency.
- Reject a draft, paid, or void bill.
- Reject zero, negative, and duplicate allocations.
- Confirm valid payment and later reversal restore bill balances correctly.

### Reconciliation

- Approve a valid suggested match.
- Reject approval of a rejected or already approved row.
- Reject approval when the bank transaction is already matched.
- Prevent two approved reconciliations for the same bank transaction.
- Prevent two approved reconciliations for the same payment.
- Confirm `approved_by` is populated.
- Confirm a forced failure rolls back reconciliation, bank status, and audit changes.

### Reversal and historical reporting

- Post a transaction in period A.
- Generate and store the period-A report result.
- Reverse the transaction in period B.
- Confirm the period-A report remains unchanged.
- Confirm the cumulative report through period B includes both the original and reversal and has the expected net balance.
- Reject a second reversal of the same entry.

### Atomic audit behavior

- Confirm every successful financial RPC creates an audit event.
- Force audit insertion to fail and confirm the entire financial operation rolls back.
- Confirm retries cannot create duplicate financial documents or duplicate reversals.

## Verification Commands

Run from `ctyhp-accounting`:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

Run relevant database verification scripts when a safe non-production Supabase/PostgreSQL environment is available.

If database credentials or a disposable test database are unavailable:

- Do not connect to production.
- Do not claim database tests passed.
- Clearly list which tests were not run and what environment is required.

## Completion Criteria

The task is complete only when all of the following are true:

- Existing behavior outside the affected workflows is preserved.
- New migrations are forward-only and safe for an already-migrated database.
- Direct authenticated-client writes cannot bypass financial workflows.
- Ledger entries are balanced in transaction and base currencies.
- Only active posting accounts can receive journal lines.
- Payment allocations enforce party, currency, status, balance, positivity, and uniqueness rules.
- Approved reconciliation is one-to-one and atomic.
- Reversals preserve prior-period reports.
- Financial mutations and audit events are atomic.
- Relevant regression tests exist and pass in the available environment.
- `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` complete successfully, except for clearly documented environment-only limitations.

## Final Report Format

When finished, report:

1. Findings fixed, ordered by severity.
2. Files and migrations changed.
3. Important schema or API design decisions.
4. Tests added.
5. Exact result of every verification command.
6. Database checks that were not run and why.
7. Remaining risks or follow-up work.

Do not state that the work is complete if any required implementation or available verification step remains unfinished.
