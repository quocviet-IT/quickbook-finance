# 11. US Accounting Implementation Checklist

## Production safety

- [ ] Direct client writes cannot bypass financial RPCs.
- [ ] Every journal balances in transaction and base currency.
- [ ] Only active posting accounts receive journal lines.
- [ ] Posted records are immutable and corrections use linked entries.
- [ ] Financial mutations and audit events are atomic.
- [ ] Authorization, rollback, and concurrency tests pass.

## Accounting operations

- [ ] Company settings and fiscal year are approved.
- [ ] Accounting periods and close controls are enabled.
- [ ] Manual journals and opening balances are controlled.
- [ ] AR ageing reconciles to Accounts Receivable.
- [ ] AP ageing reconciles to Accounts Payable.
- [ ] Every bank account has a completed reconciliation workflow.
- [ ] Sales-tax liability reconciles to control accounts.
- [ ] Trial Balance, P&L, Balance Sheet, Cash Flow, GL, and Journal reports are available.

## Security and evidence

- [ ] Privileged access is limited and MFA is enabled where supported.
- [ ] User onboarding, suspension, offboarding, and session revocation are tested.
- [ ] Maker-checker approval is configured for high-risk actions.
- [ ] Audit history is immutable, searchable, and complete.
- [ ] Attachments are private, scanned, hashed, and retained.
- [ ] Sensitive taxpayer and bank information is masked and excluded from logs.

## Reliability

- [ ] Imports use staging, validation, exception review, and control totals.
- [ ] External sync is idempotent and has retry and failure history.
- [ ] Backup restoration has been demonstrated.
- [ ] Company data and documents can be exported in a portable format.
- [ ] Large reports and jobs expose status and failure details.

## Professional review

- [ ] US sales-tax configuration and outputs have accounting/tax review.
- [ ] Vendor information-reporting outputs have accounting/tax review.
- [ ] Payroll integrations and journals have payroll/accounting review.
- [ ] Security and privacy handling has been reviewed before production.

