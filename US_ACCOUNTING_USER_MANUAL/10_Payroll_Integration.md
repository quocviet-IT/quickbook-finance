# 10. Payroll Integration

Full in-house payroll calculation and tax filing are deferred. The preferred first implementation is a controlled integration with an approved US payroll provider.

## Integration scope

- Map payroll-provider accounts to the Chart of Accounts.
- Import or receive approved payroll summaries using idempotent external IDs.
- Post balanced payroll journals.
- Track payroll run, provider status, pay date, journal, and payment-batch references.
- Reconcile net pay, payroll liabilities, taxes, benefits, deductions, and provider withdrawals.
- Retain provider reports securely.

## Controls

- Payroll data has stricter permissions than ordinary accounting data.
- Sensitive employee information is minimized and protected.
- Completed payroll runs are immutable.
- Corrections use provider-supported adjustments and linked accounting entries.
- Failed or duplicate sync attempts enter an exception queue.
- Preparation, payroll approval, payment release, and reconciliation may be segregated.

Any later in-house payroll module requires a separate professionally reviewed PRD.

