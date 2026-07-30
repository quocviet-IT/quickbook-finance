# 03. Customers and Accounts Receivable

## Customer master

Maintain legal/display name, contacts, billing and shipping addresses, payment terms, currency, credit settings, sales-tax treatment, exemption evidence, and active status. Sensitive or accounting-relevant changes are audited.

## Estimates

Estimates have controlled numbering, version history, expiry date, status, lines, tax calculation, attachments, approval where required, and delivery history. Accepted estimates convert to an invoice exactly once unless an authorized exception is recorded.

## Invoices

Invoice totals, discounts, and sales tax are calculated server-side. Draft invoices may be edited; issued invoices are immutable and corrected by credit, void, or replacement workflows as defined by policy.

The issued document preserves the template version, line details, calculation details, delivery history, and supporting attachments.

## Payments and credits

- Payments may be unapplied or allocated across eligible invoices for the same customer and currency.
- Allocation cannot exceed the payment or invoice balance.
- Credit memos and write-offs use explicit reason and approval rules.
- Refunds reference the customer credit or payment being refunded.
- Bank matching must link to existing receipts without creating duplicates.

## Collections and reporting

Provide customer statements, AR ageing, overdue invoice queues, configurable reminders, unapplied-payment reports, credit-balance reports, and reconciliation of AR ageing to the Accounts Receivable control account.

