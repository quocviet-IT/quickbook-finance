# 09. Multi-Currency

USD is the default base currency. Foreign currencies are enabled only through controlled company settings.

## Configuration and rates

- Use ISO currency codes and configured decimal precision.
- Store dated exchange rates, source, retrieval time, and approval state.
- Manual overrides require permission and reason.
- Customers, vendors, and bank accounts have controlled currencies.
- The rate used by a posted document is preserved.

## Accounting

Every journal entry balances in transaction and base currency. Settlement calculates realized foreign-exchange gain or loss. Period-end revaluation calculates unrealized gain or loss through an approved, idempotent run with documented reversal behavior.

## Controls and reports

- Prevent duplicate revaluation runs.
- Reconcile foreign-currency subledgers to control accounts.
- Report transaction currency, base amount, rate, source, and gain/loss.
- Audit every rate override and revaluation approval.

