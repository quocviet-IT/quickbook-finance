# 06. US Sales Tax

## Scope

The sales-tax module is configuration-driven and supports product calculations, liability tracking, review, and payment recording. It does not determine a company's legal filing obligations without approved professional guidance.

## Configuration

Maintain:

- Tax agencies.
- Jurisdictions and parent relationships.
- Tax rates and effective dates.
- Tax codes and combined rates.
- Customer taxability and exemption evidence.
- Product/service taxability categories.
- Company registrations and filing periods.
- Sales-tax payable and clearing accounts.

Configuration changes are versioned, approved, effective-dated, and audited. Invalid or overlapping rate periods are rejected.

## Transaction calculation

Invoices preserve the jurisdiction, rate components, taxable basis, exemption reason, rounding result, and calculation version used at issuance. Server-side totals must reproduce approved calculation fixtures.

Credit memos and refunds reverse or adjust the related tax using explicit links to the original transaction.

## Period workflow

Tax periods progress through preparation, review, approved, filed/closed, and amended states according to product policy.

- Liability reconciles to the ledger before approval.
- Missing or invalid tax treatment enters an exception queue.
- Closing a period locks its calculated return snapshot.
- Later changes create linked adjustments rather than overwriting the filed snapshot.
- Payments and refunds post against configured tax authority clearing or payable accounts.

## Reports

- Sales Tax Liability.
- Taxable and non-taxable sales detail.
- Tax by agency and jurisdiction.
- Exemption exception report.
- Adjustments after period close.
- Tax payment and clearing reconciliation.

