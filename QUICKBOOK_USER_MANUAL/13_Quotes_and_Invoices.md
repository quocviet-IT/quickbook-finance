# 13. Quotes and Invoices

> Source scope: *QuickBooks Online Business User Manual*, Version 4 - July 2022, pages 63-67.

## Purpose

This chapter explains how QuickBooks Online creates and manages quotes, converts accepted quotes into invoices, records invoice payments, and links supporting documents.

It also translates the documented workflow into design requirements for an internal accounting and sales system.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. Current menu names, payment options, tax settings, and feature availability may differ by version and country.

---

## 1. Quote-to-Cash Overview

The documented sales workflow is:

```text
Create Quote
    ↓
Send Quote
    ↓
Customer Accepts
    ↓
Convert Quote to Invoice
    ↓
Send Invoice
    ↓
Receive Payment
    ↓
Match Payment to Bank Transaction
    ↓
Close Invoice
```

A robust system should preserve the full traceability from the original quote through invoice and payment.

---

## 2. Before Creating a Quote

Before creating the first quote, confirm that the company file is configured correctly.

Review:

- company information;
- tax settings;
- products and services;
- customer records;
- payment terms;
- quote numbering;
- invoice numbering;
- quantity and pricing settings;
- custom transaction fields;
- document templates.

---

## 3. Create a Quote

Navigate to:

```text
New/Create > Customers > Quote
```

Complete the quote form.

Typical fields include:

| Field | Description |
|---|---|
| Customer | Customer receiving the quote |
| Quote date | Date the quote is issued |
| Expiry date | Date the quote expires |
| Quote number | Unique reference |
| Tax treatment | Inclusive, exclusive, or outside tax scope |
| Product or service | Item being quoted |
| Quantity | Number of units |
| Description | Item or service description |
| Rate | Unit price |
| Discount | Optional discount |
| Message | Customer-facing note |
| Attachment | Supporting file |

---

## 4. Quote Line Items

Each quote may contain one or more line items.

Example:

| Product/Service | Quantity | Rate | Amount |
|---|---:|---:|---:|
| Consulting Service | 10 | 100.00 | 1,000.00 |
| Implementation Support | 5 | 150.00 | 750.00 |

Calculation:

```text
Line Amount = Quantity × Rate
```

Quote total:

```text
Subtotal
- Discount
+ Tax
= Total Quote Amount
```

---

## 5. Tax Treatment

The documented quote form supports amounts that are:

- tax inclusive;
- tax exclusive;
- outside the scope of tax.

The system should calculate:

- net amount;
- tax amount;
- gross amount.

### Recommended control

Tax treatment should default from the product or service but remain reviewable on the quote line.

---

## 6. Add More Lines

Use additional lines when the quote includes multiple:

- products;
- services;
- delivery stages;
- work packages;
- fees;
- discounts;
- optional items.

A custom system may also support:

- grouped sections;
- subtotals;
- optional lines;
- alternates;
- milestone groups;
- BOM-linked items.

---

## 7. Add Attachments

The manual allows a document or file to be attached to the quote.

Examples:

- product specifications;
- drawings;
- contract terms;
- scope of work;
- pricing worksheet;
- customer requirements.

The documented maximum attachment size for a quote is 25 MB.

### Recommended attachment controls

- allowed file types;
- malware scanning;
- file-size limit;
- document classification;
- access permission;
- retention policy;
- immutable link to the quote.

---

## 8. Save and Send a Quote

After reviewing the quote, select:

```text
Save and Send
```

The email body can be edited before sending.

Then select:

```text
Send and Close
```

### Recommended send log

Store:

- recipient;
- CC/BCC;
- subject;
- message body;
- sent by;
- sent at;
- delivery status;
- attachment list;
- quote version.

---

## 9. Quote Statuses

The manual indicates that quote status can be updated, including when a quote is accepted.

Recommended status model:

```text
Draft
    ↓
Pending Approval
    ↓
Sent
    ↓
Viewed
    ↓
Accepted
    ↓
Converted to Invoice
```

Alternative outcomes:

```text
Rejected
Expired
Cancelled
Superseded
```

### Status controls

- only approved quotes can be sent;
- only accepted quotes can be converted automatically;
- expired quotes require renewal or reissue;
- cancelled quotes remain available historically;
- each status change is recorded in the audit log.

---

## 10. Find and Manage Quotes

The manual describes several ways to find quotes:

- Search and Recent Transactions;
- customer record;
- Invoicing;
- All Sales;
- quote section in the sales overview.

A useful quote list should support:

- search;
- filters;
- sorting;
- pagination;
- customer filter;
- date range;
- status;
- salesperson;
- amount range;
- expiry date;
- conversion status.

---

## 11. Convert a Quote to an Invoice

When the customer accepts the quote:

1. locate the quote;
2. update its status to accepted where required;
3. select **Start Invoice** or the equivalent conversion action;
4. review the invoice;
5. save and send it.

### Traceability requirement

The invoice should retain:

- source quote ID;
- source quote number;
- source quote version;
- conversion date;
- user who converted it;
- original quoted amount;
- converted amount;
- variance reason.

---

## 12. Create an Invoice Directly

Navigate to:

```text
New/Create > Customers > Invoice
```

Typical fields include:

| Field | Description |
|---|---|
| Customer | Invoice recipient |
| Invoice date | Date issued |
| Due date | Payment deadline |
| Invoice number | Unique reference |
| Tax treatment | Inclusive, exclusive, or outside scope |
| Products and services | Items billed |
| Quantity | Units billed |
| Description | Line description |
| Rate | Unit rate |
| Tax code | Tax treatment |
| Discount | Optional discount |
| Customer message | Message displayed on invoice |
| Attachment | Supporting documentation |

---

## 13. Invoice Calculations

For each invoice line:

```text
Line Amount = Quantity × Rate
```

Invoice total:

```text
Subtotal
- Discount
+ Tax
= Invoice Total
```

Outstanding balance:

```text
Invoice Total
- Payments
- Credits
= Amount Due
```

---

## 14. Add Subtotals

The manual recommends using subtotals to group related lines.

Example:

```text
Professional Services
- Consulting
- Implementation
Subtotal

Products
- Equipment
- Accessories
Subtotal
```

Subtotals improve readability and can support reporting by section or work package.

---

## 15. Invoice Attachments

Supporting files may be attached to an invoice.

Examples:

- signed quote;
- delivery note;
- work completion report;
- purchase order;
- contract;
- product certificate;
- customer approval.

The manual documents a maximum total attachment size of 20 MB per transaction in this workflow.

---

## 16. Print and Preview

Before sending, users may:

- preview the invoice;
- print it;
- review totals;
- verify customer details;
- verify tax;
- verify payment instructions;
- confirm attachments.

### Pre-send checklist

- [ ] Customer is correct.
- [ ] Billing address is correct.
- [ ] Invoice number is unique.
- [ ] Invoice date and due date are correct.
- [ ] Products and services are correct.
- [ ] Quantities and rates are correct.
- [ ] Tax codes are correct.
- [ ] Discounts are authorized.
- [ ] Attachments are complete.
- [ ] Payment instructions are correct.
- [ ] Invoice total reconciles.

---

## 17. Recurring Invoices

The manual notes that an invoice can be made recurring when the same service and amount repeat.

Recurring transactions are managed through:

```text
Gear Icon > Lists > Recurring Transactions
```

A recurring invoice template may include:

- customer;
- frequency;
- start date;
- end date;
- products and services;
- quantity;
- price;
- tax;
- email settings;
- reminder settings.

> **Control note**
>
> Recurring invoices should be reviewed regularly to prevent billing after a contract ends.

---

## 18. Invoice Templates

The invoice form can use different templates.

Templates may control:

- logo;
- colors;
- fonts;
- header;
- footer;
- visible columns;
- payment instructions;
- legal text;
- language.

Template selection should not change the accounting data.

---

## 19. Save and Send an Invoice

Select:

```text
Save and Send
```

Review the email body, then send and close.

### Recommended delivery statuses

```text
Not Sent
Queued
Sent
Delivered
Viewed
Failed
Bounced
```

A failed or bounced invoice should enter an exception queue.

---

## 20. Receive Invoice Payment

The manual describes several ways to apply a customer payment.

### Method 1

Navigate to:

```text
New/Create > Customers > Receive Payment
```

Then:

1. choose the customer;
2. select the invoice or invoices;
3. enter the payment date;
4. select the bank or deposit account;
5. enter the amount;
6. save the payment.

### Method 2

Open the invoice and select:

```text
Receive Payment
```

### Method 3

Match the bank transaction directly from the Banking Centre.

---

## 21. Multi-Invoice Payments

One customer payment may cover multiple invoices.

Example:

```text
Payment received: 2,500

Invoice A: 1,000
Invoice B: 1,200
Invoice C: 300
```

The payment application must equal the received amount.

### Controls

- prevent over-application;
- show remaining unapplied amount;
- support partial payment;
- support customer credit;
- preserve invoice-payment links;
- record the bank deposit account.

---

## 22. Partial Payments

An invoice may be partially paid.

Example:

```text
Invoice total: 5,000
Payment received: 2,000
Remaining balance: 3,000
```

Recommended invoice statuses:

```text
Draft
Sent
Partially Paid
Paid
Overdue
Void
Cancelled
Written Off
```

---

## 23. Payment History

The invoice should show:

- payment date;
- payment amount;
- payment method;
- bank account;
- reference;
- applied amount;
- remaining balance;
- user who recorded the payment.

This provides a complete settlement history.

---

## 24. Bank Matching

When a payment is recorded before the bank feed arrives, the Banking Centre should suggest a match.

Matching criteria may include:

- amount;
- customer;
- invoice number;
- payment date;
- bank reference;
- currency.

The bank transaction should be matched to the existing payment rather than creating a duplicate deposit.

---

## 25. Quote and Invoice Versioning

A controlled system should preserve versions.

### Quote versioning

```text
Q-1001-V1
Q-1001-V2
Q-1001-V3
```

### Invoice versioning

Invoices should generally not be overwritten after issue.

Corrections should use:

- credit note;
- void;
- cancellation;
- replacement invoice;
- adjustment.

---

## 26. Approval Workflow

Recommended approval rules:

| Event | Possible approval |
|---|---|
| Quote above threshold | Sales manager |
| Discount above threshold | Finance or sales manager |
| Non-standard terms | Legal/finance |
| Invoice above threshold | Billing reviewer |
| Manual price override | Authorized approver |
| Invoice cancellation | Finance manager |
| Write-off | Finance controller |

---

## 27. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Duplicate invoice | Same quote converted twice | Unique source-quote conversion rule |
| Unauthorized discount | Sales user reduces price excessively | Discount threshold and approval |
| Wrong customer | Invoice issued to incorrect customer | Customer confirmation before send |
| Incorrect tax | Wrong tax code on line item | Tax validation |
| Invoice overwritten | Issued invoice edited without trace | Versioning and credit-note workflow |
| Duplicate payment | Bank match creates another payment | Match existing payment |
| Over-application | Payment exceeds invoice balance | Application validation |
| Missing attachment | No delivery evidence | Required-document checklist |
| Expired quote converted | Old price used | Expiry validation |
| Recurring invoice continues | Contract already ended | Recurring-template review |

---

## 28. Suggested Database Design

### `quotes`

```text
id
quote_number
version
customer_id
quote_date
expiry_date
currency_code
subtotal
discount_amount
tax_amount
total_amount
status
salesperson_id
approved_by
sent_at
accepted_at
converted_invoice_id
created_at
updated_at
```

### `quote_lines`

```text
id
quote_id
line_number
product_id
description
quantity
unit_price
discount_amount
tax_code_id
tax_amount
line_total
is_optional
group_name
```

### `invoices`

```text
id
invoice_number
customer_id
source_quote_id
invoice_date
due_date
currency_code
subtotal
discount_amount
tax_amount
total_amount
amount_paid
amount_due
status
template_id
sent_at
created_at
updated_at
```

### `invoice_lines`

```text
id
invoice_id
line_number
product_id
description
quantity
unit_price
discount_amount
tax_code_id
tax_amount
line_total
group_name
```

### `customer_payments`

```text
id
customer_id
payment_date
amount
currency_code
payment_method
bank_account_id
reference_number
status
created_by
created_at
```

### `payment_applications`

```text
id
payment_id
invoice_id
applied_amount
created_at
```

### Supporting tables

```text
quote_versions
quote_status_history
invoice_status_history
document_attachments
email_delivery_logs
approval_requests
credit_notes
invoice_cancellations
```

---

## 29. Recommended Constraints

1. Quote number and version must be unique.
2. Invoice number must be unique.
3. Line quantity cannot be negative unless the transaction type permits it.
4. Invoice totals must equal line totals, tax, and discounts.
5. One quote cannot create duplicate invoices without an approved split workflow.
6. Payment application cannot exceed the available payment amount.
7. Payment application cannot exceed the invoice balance.
8. Issued invoices cannot be silently overwritten.
9. Cancellation and write-off require approval.
10. Currency must be consistent across invoice and payment application.

---

## 30. Suggested Workflow

```text
Create Quote
        ↓
Review Pricing and Tax
        ↓
Approve
        ↓
Send to Customer
        ↓
Customer Accepts
        ↓
Convert to Invoice
        ↓
Review and Send Invoice
        ↓
Record or Match Payment
        ↓
Apply Payment
        ↓
Close Invoice
```

---

## 31. AI Implementation Prompt

```text
Implement a quote-to-cash module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Support quote creation, versioning, approval, sending, acceptance, rejection, expiry, and cancellation.
- Support quote line items, groups, optional items, discounts, tax, attachments, and customer messages.
- Convert accepted quotes into invoices while preserving source traceability.
- Prevent duplicate quote conversion.
- Support invoice line items, subtotals, discounts, tax, templates, attachments, and email delivery status.
- Support draft, sent, partially paid, paid, overdue, void, cancelled, and written-off statuses.
- Support recurring invoice templates.
- Support customer payments, partial payments, multi-invoice payments, and unapplied balances.
- Validate payment applications against available payment and invoice balances.
- Integrate with the Banking Centre for payment matching.
- Use credit notes and cancellation workflows instead of overwriting issued invoices.
- Add role-based approvals for discounts, price overrides, cancellations, and write-offs.
- Maintain immutable status and audit history.
- Add search, filters, pagination, sticky headers, exports, and exception queues.
- Include unit and integration tests for calculations, conversion, duplicate prevention, payment application, tax, permissions, and status transitions.
```

---

## 32. Internal System Checklist

- [ ] Quote numbering is controlled.
- [ ] Quote versions are preserved.
- [ ] Expiry dates are validated.
- [ ] Discounts require approval where applicable.
- [ ] Accepted quote conversion is traceable.
- [ ] Duplicate invoice conversion is prevented.
- [ ] Invoice numbering is unique.
- [ ] Tax and totals reconcile.
- [ ] Attachments are retained.
- [ ] Email delivery status is recorded.
- [ ] Partial and multi-invoice payments are supported.
- [ ] Bank matching does not create duplicates.
- [ ] Issued invoices cannot be overwritten.
- [ ] Credit notes and cancellations are auditable.
- [ ] Outstanding balances reconcile to Accounts Receivable.

---

## Related Topics

- [11. Products and Services](11_Products_and_Services.md)
- [12. Banking Centre](12_Banking_Centre.md)
- Customising Invoices
- Adding Attachments
- Recurring Transactions
- Customer Payments
- Accounts Receivable
- Reports Centre

---

## Keywords

Quotes, estimates, invoices, quote-to-cash, customer invoice, quote conversion, partial payment, receive payment, invoice status, recurring invoice, discount approval, tax calculation, payment application, Accounts Receivable