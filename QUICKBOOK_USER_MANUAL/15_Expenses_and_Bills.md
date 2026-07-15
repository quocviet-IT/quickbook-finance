# 15. Expenses and Bills

> Source scope: *QuickBooks Online Business User Manual*, Version 4 - July 2022, pages 72-75.

## Purpose

This chapter explains how QuickBooks Online records expenses, enters supplier bills, and applies bill payments.

It also translates the documented workflow into implementation requirements for an internal accounting system with Accounts Payable, source-document controls, approval workflows, payment allocation, bank matching, and audit history.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. Current menu names, subscription availability, tax settings, and payment features may differ.
>
> The source manual states that Bills were available in QuickBooks Online Essentials and Plus at the time of publication.

---

## 1. Expense Versus Bill

An **Expense** records a purchase that has already been paid.

A **Bill** records an amount owed to a supplier that will be paid later.

| Transaction | Payment timing | Accounting effect |
|---|---|---|
| Expense | Paid immediately or already paid | Records expense or asset and reduces cash, bank, or credit-card balance |
| Bill | Payment will occur later | Records expense or asset and increases Accounts Payable |
| Bill Payment | Pays one or more existing bills | Reduces Accounts Payable and reduces the selected payment account |

### Decision rule

```text
Has the supplier already been paid?
        |
        +-- Yes --> Record an Expense
        |
        +-- No  --> Record a Bill
```

### Common examples

```text
Petty-cash purchase              -> Expense
Credit-card purchase             -> Expense
Supplier invoice due next month  -> Bill
Payment of several open bills    -> Bill Payment
```

---

## 2. Expense-to-Payables Workflow

```text
Receive Receipt or Supplier Invoice
        ↓
Determine Expense or Bill
        ↓
Validate Supplier and Source Document
        ↓
Code Account, Product/Service, and Tax
        ↓
Review and Approve
        ↓
Post Expense or Bill
        ↓
Pay Bill When Due
        ↓
Match Payment to Bank Feed
        ↓
Reconcile and Close
```

### Key control principle

Do not use an Expense to bypass the Accounts Payable process when a supplier invoice remains unpaid.

---

## 3. Enter an Expense Transaction

Navigate to:

```text
New/Create > Suppliers > Expense
```

The source manual describes the following process:

1. select the account from which the expense was paid;
2. complete the payee, reference, date, and tax treatment;
3. allocate the transaction to the relevant expense, cost-of-sales account, or item details;
4. add a memo and supporting attachment where required;
5. select **Save and Close**.

---

## 4. Select the Payment Account

The payment account identifies where the money came from.

Examples:

- petty cash;
- operating bank account;
- credit-card account;
- employee reimbursement clearing account;
- digital-wallet account.

### Recommended validation

The selected account must:

- be active;
- be a valid bank, cash, credit-card, or clearing account;
- use a compatible currency;
- belong to the correct legal entity;
- be available to the user based on permissions.

---

## 5. Expense Header Fields

Typical expense fields include:

| Field | Purpose |
|---|---|
| Payee | Supplier, employee, or other recipient |
| Payment account | Account used to pay the expense |
| Payment date | Date payment occurred |
| Payment method | Cash, bank transfer, card, cheque, or other method |
| Reference number | Receipt, bank, cheque, or internal reference |
| Currency | Transaction currency |
| Exchange rate | Rate used for foreign-currency expenses |
| Tax treatment | Inclusive, exclusive, or outside tax scope |
| Tags, class, or location | Reporting dimensions |
| Memo | Internal explanation |
| Attachment | Receipt, invoice, or approval evidence |

### Duplicate-detection fields

A system should compare:

- supplier;
- reference number;
- date;
- amount;
- currency;
- source-document hash.

---

## 6. Category Details

Use **Category details** when the purchase is coded directly to general-ledger accounts.

Examples:

| Purchase | Possible account |
|---|---|
| Office stationery | Office Supplies Expense |
| Fuel | Vehicle or Fuel Expense |
| Professional advice | Legal and Professional Fees |
| Shipping | Freight Expense |
| Production materials | Cost of Sales or Raw Materials |
| Computer equipment | Fixed Asset account |

### Category-line fields

```text
Account
Description
Amount
Tax code
Class
Location
Customer or project
Billable status
```

### Recommended rule

The account must be selected according to the economic substance of the purchase, not only the bank description.

---

## 7. Item Details

Use **Item details** when the expense relates to configured Products and Services.

Products and Services may already be mapped to:

- expense account;
- Cost of Goods Sold account;
- inventory asset account;
- purchase tax code;
- preferred supplier.

Typical item-line fields:

```text
Product or Service
Description
Quantity
Rate
Amount
Tax code
Customer or project
Class
Location
```

### Inventory consideration

A purchase of an inventory item should update inventory according to the configured inventory workflow rather than being posted only to a general expense account.

---

## 8. Tax Treatment

The documented expense form supports amounts that are:

- tax inclusive;
- tax exclusive;
- outside the scope of tax.

The system should store:

```text
Net amount
Tax amount
Gross amount
Tax code
Tax jurisdiction
Tax calculation method
```

### Tax controls

- use a controlled tax-code list;
- validate tax codes against account and supplier type;
- require a reason for manual tax overrides;
- retain the original and changed values;
- include exceptions in tax-review reports.

---

## 9. Memo and Attachment

A memo records the internal purpose or context of the expense.

An attachment provides the source evidence.

Examples:

- supplier invoice;
- receipt;
- purchase approval;
- contract;
- delivery note;
- payment confirmation;
- email authorization.

### Recommended attachment requirement

High-risk or high-value expenses should not be approved without supporting evidence unless an exception is documented and approved.

---

## 10. Save and Close

Before saving an expense, verify:

- [ ] Payment account is correct.
- [ ] Payee is correct.
- [ ] Payment date is correct.
- [ ] Reference number is entered.
- [ ] Currency and exchange rate are correct.
- [ ] Category or item allocation is correct.
- [ ] Tax code is correct.
- [ ] Total equals the source document.
- [ ] Required attachment is present.
- [ ] Duplicate check has passed.
- [ ] Approval requirements are satisfied.

Then select:

```text
Save and Close
```

---

## 11. Enter a Supplier Bill

Navigate to:

```text
New/Create > Suppliers > Bill
```

A bill should capture an unpaid supplier obligation.

Typical bill fields include:

| Field | Purpose |
|---|---|
| Supplier | Party owed money |
| Mailing address | Supplier address |
| Bill date | Supplier invoice date |
| Due date | Payment deadline |
| Terms | Payment terms |
| Bill number | Supplier invoice number |
| Currency | Bill currency |
| Exchange rate | Foreign-currency conversion rate |
| Category details | General-ledger coding |
| Item details | Product or service coding |
| Tax | Tax treatment |
| Memo | Internal notes |
| Attachment | Supplier invoice and evidence |

---

## 12. Bill Calculations

For each bill line:

```text
Line Amount = Quantity × Rate
```

Bill total:

```text
Subtotal
- Discount
+ Tax
= Bill Total
```

Outstanding amount:

```text
Bill Total
- Payments Applied
- Supplier Credits Applied
= Balance Due
```

---

## 13. Bill Statuses

Recommended status model:

```text
Draft
    ↓
Pending Review
    ↓
Approved
    ↓
Open
    ↓
Partially Paid
    ↓
Paid
```

Alternative outcomes:

```text
On Hold
Disputed
Overdue
Void
Cancelled
Written Off
```

### Status rules

- Draft bills do not enter the payable ledger.
- Approved bills may be posted to Accounts Payable.
- Bills on hold cannot be selected for payment.
- Paid bills cannot be edited without a controlled reversal or adjustment.
- Voids and cancellations remain in the audit history.

---

## 14. Three-Way Matching

Where purchase orders and goods receipts are used, a supplier bill should be compared with:

```text
Purchase Order
        +
Goods or Service Receipt
        +
Supplier Bill
```

This is known as three-way matching.

### Matching dimensions

- supplier;
- product or service;
- quantity;
- unit price;
- tax;
- freight;
- total;
- purchase-order reference;
- received quantity.

### Exception examples

```text
Quantity billed exceeds quantity received
Price differs from purchase order
Supplier differs from purchase order
Duplicate supplier invoice number
Missing receipt confirmation
```

---

## 15. Paying Bills

The source manual documents several ways to pay bills.

### Method 1 - Bank-feed match

When only one bill is paid, the bank feed may suggest a match to that bill or bill payment.

### Method 2 - Expense shortcut

Navigate to:

```text
New/Create > Expense
```

Then:

1. select the supplier in the Payee field;
2. use the right-side drawer;
3. select **Add** for the bills being paid;
4. verify the total;
5. save the payment.

### Method 3 - Supplier Centre

Navigate to the Supplier Centre and:

1. select the **Open Bills** area in the Money Bar;
2. locate the supplier;
3. select **Pay Bills**;
4. apply the payment to the supplier invoice.

### Method 4 - Pay Bills screen

Navigate to:

```text
New/Create > Suppliers > Pay Bills
```

Then select:

- payment account;
- payment date;
- reference number;
- bills to be paid;
- amount applied to each bill.

---

## 16. Multi-Bill Payments

One payment may settle several bills.

Example:

```text
Payment total: 4,500

Bill A: 1,200
Bill B: 2,000
Bill C: 1,300
```

Validation:

```text
Sum of Applied Amounts = Payment Amount
```

### Required controls

- payment cannot exceed the selected account's authorized limit;
- total applied cannot exceed the payment amount;
- application to each bill cannot exceed its open balance;
- supplier credits must be shown separately;
- currency must be compatible;
- payment date must be in an open accounting period.

---

## 17. Partial Bill Payments

A bill may be paid in part.

Example:

```text
Bill total: 10,000
Payment: 4,000
Remaining balance: 6,000
```

The bill status becomes:

```text
Partially Paid
```

The system should retain:

- original bill total;
- payment history;
- amount applied;
- remaining balance;
- payment references;
- bank-account link.

---

## 18. Supplier Credits

A supplier credit may reduce an open bill.

Examples:

- returned goods;
- pricing correction;
- overbilling correction;
- service adjustment;
- rebate.

Recommended workflow:

```text
Create Supplier Credit
        ↓
Approve Credit
        ↓
Apply to Open Bill
        ↓
Pay Remaining Balance
```

The credit should not be represented as an unexplained negative expense.

---

## 19. Payment Approval Workflow

Recommended workflow:

```text
Bill Entered
    ↓
Coding Review
    ↓
Business Approval
    ↓
Payment Proposal
    ↓
Payment Approval
    ↓
Payment Execution
    ↓
Bank Match
    ↓
Reconciliation
```

### Segregation of duties

| Responsibility | Recommended role |
|---|---|
| Create supplier | Authorized master-data user |
| Enter bill | Accounts Payable staff |
| Approve business expense | Department manager |
| Approve payment | Finance manager or authorized approver |
| Execute bank payment | Treasury or authorized banking user |
| Reconcile bank | Independent accounting reviewer |

A single user should not create a supplier, enter a bill, approve the bill, execute the payment, and reconcile the bank without independent review.

---

## 20. Payment Proposal

A controlled Accounts Payable system should support payment proposals based on:

- due date;
- supplier;
- currency;
- payment priority;
- cash availability;
- discount opportunity;
- disputed status;
- approval status;
- payment method.

### Example proposal statuses

```text
Draft
Pending Review
Approved
Scheduled
Processing
Paid
Failed
Cancelled
```

---

## 21. Bank Matching

After payment is recorded, the Banking Centre may import the corresponding bank withdrawal.

The bank transaction should match the existing bill payment rather than create a second expense.

Matching criteria may include:

- supplier;
- payment amount;
- payment date;
- reference number;
- bank account;
- currency;
- selected bills.

### Duplicate-prevention rule

```text
Existing bill payment found
        ↓
Match bank record
        ↓
Do not create another expense
```

---

## 22. Accounts Payable Ageing

Open bills should appear in supplier ageing reports.

Typical ageing buckets:

```text
Current
1-30 days overdue
31-60 days overdue
61-90 days overdue
More than 90 days overdue
```

### Useful payable reports

- Accounts Payable Ageing Summary;
- Accounts Payable Ageing Detail;
- Unpaid Bills;
- Bills by Supplier;
- Payments by Supplier;
- Upcoming Payments;
- Overdue Bills;
- Supplier Credits;
- Payment Exceptions.

---

## 23. Recurring Expenses and Bills

Repeated expenses or bills may be configured through recurring transactions.

Examples:

- monthly rent;
- subscriptions;
- software licenses;
- insurance;
- regular service contracts.

Recurring templates should have:

- start date;
- end date;
- frequency;
- supplier;
- account coding;
- tax treatment;
- amount;
- approval owner;
- next review date.

> **Control note**
>
> Recurring transactions should be reviewed regularly so that terminated contracts do not continue to generate expenses or bills.

---

## 24. Expense Reimbursements

Employee-paid business expenses should use a controlled reimbursement workflow.

```text
Employee Submits Claim
        ↓
Manager Reviews Business Purpose
        ↓
Finance Validates Receipt and Tax
        ↓
Claim Approved
        ↓
Payment Issued
        ↓
Bank Matched
```

Recommended fields:

- employee;
- expense date;
- merchant;
- business purpose;
- category;
- amount;
- currency;
- tax;
- receipt;
- project or department;
- approver.

---

## 25. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Duplicate bill | Supplier invoice entered twice | Supplier, invoice number, amount, and file-hash validation |
| Expense used instead of bill | Unpaid invoice recorded as already paid | Payment-status decision rule |
| Wrong payment account | Credit-card expense posted to bank | Account-type validation |
| Wrong coding | Asset purchase posted to office expense | Approval and account rules |
| Wrong tax code | Non-creditable tax claimed | Tax validation and review |
| Missing source document | Payment made without invoice | Required attachment or approved exception |
| Unauthorized payment | User pays unapproved bill | Approval workflow and role controls |
| Overpayment | Payment exceeds open balance | Application validation |
| Duplicate bank expense | Bank feed creates a second expense | Match existing payment |
| Payment to wrong supplier | Supplier data changed fraudulently | Supplier-change approval and bank-account verification |
| Early or late payment | Due date ignored | Payment proposal and ageing alerts |
| Historical edit | Paid bill changed after settlement | Locking and adjustment workflow |

---

## 26. Suggested Database Design

### `supplier_bills`

```text
id
bill_number
supplier_id
bill_date
due_date
terms_id
currency_code
exchange_rate
subtotal
tax_amount
total_amount
amount_paid
balance_due
status
purchase_order_id
approval_status
approved_by
posted_at
created_at
updated_at
```

### `supplier_bill_lines`

```text
id
bill_id
line_number
line_type
account_id
product_id
description
quantity
unit_price
tax_code_id
tax_amount
line_total
class_id
location_id
project_id
```

### `expenses`

```text
id
payee_id
payment_account_id
payment_date
payment_method
reference_number
currency_code
exchange_rate
subtotal
tax_amount
total_amount
status
approved_by
created_at
updated_at
```

### `expense_lines`

```text
id
expense_id
line_number
line_type
account_id
product_id
description
quantity
unit_price
tax_code_id
tax_amount
line_total
class_id
location_id
project_id
```

### `supplier_payments`

```text
id
supplier_id
payment_account_id
payment_date
payment_method
reference_number
currency_code
amount
status
approved_by
executed_by
bank_transaction_id
created_at
```

### `supplier_payment_applications`

```text
id
supplier_payment_id
bill_id
supplier_credit_id
applied_amount
created_at
```

### Supporting tables

```text
supplier_credits
bill_approval_requests
payment_proposals
payment_proposal_lines
supplier_bank_accounts
three_way_match_results
expense_reimbursements
payables_audit_history
```

---

## 27. Recommended Constraints

1. Supplier bill number should be unique per supplier where a number is provided.
2. Expense and bill totals must equal their line totals and tax.
3. Bill payment cannot exceed the payment amount.
4. Applied amount cannot exceed the bill's open balance.
5. Paid bills cannot be silently deleted or overwritten.
6. Payment account currency must match the payment currency or use a controlled conversion.
7. Bills on hold or disputed cannot be paid without approval.
8. High-risk supplier bank-detail changes require independent verification.
9. Posted transactions in locked periods require an adjustment workflow.
10. Every approval, payment, reversal, and bank match must be auditable.

---

## 28. Suggested Workflow

```text
Capture Receipt or Supplier Invoice
        ↓
Classify as Expense or Bill
        ↓
Validate Supplier and Duplicate Risk
        ↓
Code Accounts, Items, Dimensions, and Tax
        ↓
Attach Evidence
        ↓
Review and Approve
        ↓
Post Expense or Bill
        ↓
Prepare and Approve Payment
        ↓
Execute Payment
        ↓
Match Bank Transaction
        ↓
Reconcile Accounts Payable and Bank
```

---

## 29. AI Implementation Prompt

```text
Implement an Expenses and Accounts Payable module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Support immediate-payment Expenses and unpaid Supplier Bills as separate transaction types.
- Support category lines and product/service item lines.
- Store supplier, reference, dates, terms, currency, exchange rate, tax, dimensions, memo, and attachments.
- Detect duplicate expenses and bills using supplier, invoice number, date, amount, and file hash.
- Support draft, pending review, approved, open, partially paid, paid, on hold, disputed, void, and cancelled statuses.
- Support three-way matching between purchase order, receipt, and supplier bill.
- Support supplier credits and credit application.
- Support single-bill, multi-bill, and partial bill payments.
- Prevent payment application above the payment amount or bill balance.
- Support payment proposals, approval thresholds, scheduling, execution, and failure handling.
- Integrate with the Banking Centre to match existing payments and prevent duplicate expenses.
- Implement segregation of duties for supplier creation, bill entry, approval, payment execution, and reconciliation.
- Lock paid transactions and closed accounting periods.
- Preserve immutable approval, payment, reversal, and audit history.
- Add search, filters, pagination, sticky table headers, ageing views, exception queues, and export.
- Include unit and integration tests for calculations, duplicate detection, tax, payment application, credits, permissions, bank matching, and status transitions.
```

---

## 30. Internal System Checklist

- [ ] Expense and Bill are separate transaction types.
- [ ] Supplier master data is controlled.
- [ ] Duplicate detection is enabled.
- [ ] Category and item coding are validated.
- [ ] Tax treatment is reviewed.
- [ ] Source documents are attached.
- [ ] Approval thresholds are configured.
- [ ] Three-way matching is supported where required.
- [ ] Partial and multi-bill payments are supported.
- [ ] Supplier credits are handled separately.
- [ ] Payments cannot exceed open balances.
- [ ] Bank matching prevents duplicate expenses.
- [ ] Paid transactions are locked.
- [ ] Accounts Payable ageing reconciles to the general ledger.
- [ ] All actions are included in the audit log.

---

## Related Topics

- [05. Audit Log](05_Audit_Log.md)
- [06. Chart of Accounts](06_Chart_of_Accounts.md)
- [11. Products and Services](11_Products_and_Services.md)
- [12. Banking Centre](12_Banking_Centre.md)
- [14. Customising Invoices and Attachments](14_Customising_Invoices_and_Attachments.md)
- Recurring Transactions
- Purchase Orders
- Bank Reconciliation
- Accounts Payable Reports

---

## Keywords

Expenses, supplier bills, Accounts Payable, bill payment, supplier payment, category details, item details, tax inclusive, tax exclusive, attachment, three-way matching, supplier credit, partial payment, payment proposal, bank matching, ageing