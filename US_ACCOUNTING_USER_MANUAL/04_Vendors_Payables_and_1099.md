# 04. Vendors, Accounts Payable, and 1099 Support

## Vendor master

Maintain vendor name, contacts, addresses, terms, currency, default accounts, payment method, remittance details, active status, and tax-profile status.

Changes to payment or tax information require elevated permission, reason, audit history, and optional independent approval. Sensitive taxpayer and bank information is masked and excluded from ordinary logs.

## Bills and expenses

- Bills and immediate expenses remain separate transaction types.
- Duplicate vendor, reference, date, and amount combinations generate a warning or block according to policy.
- Posted bills are immutable.
- Supporting documents are retained in private storage.
- Bills and expenses post through atomic ledger workflows.
- Vendor credits are separate records and may be applied only to eligible vendor balances.

## Bill payments

Payments support preparation and approval separation, partial allocation, multiple bills, payment batches, and later bank matching. A payment cannot exceed eligible open balances, cross vendors, or cross currencies.

## AP controls and reports

Provide AP aging, due and overdue bills, unapplied vendor credits, payment exceptions, vendor activity, and reconciliation of AP aging to the Accounts Payable control account.

## Vendor information reporting support

The vendor tax profile tracks W-9 collection status, configured 1099 eligibility, tax classification, reporting name, secured taxpayer identifier reference, and documented overrides.

For a selected tax year, the system produces an exception queue and review/export dataset derived from eligible transactions. It must identify missing information and reconcile totals to the ledger. The product must not claim filing compliance without professional review.

