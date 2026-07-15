# 18. Purchase Orders

> Source scope: *QuickBooks Online Business User Manual*, Version 4 - July 2022, pages 80-82.

## Purpose

This chapter explains how QuickBooks Online creates purchase orders, converts received quantities into supplier bills, tracks partial receipts, keeps purchase orders open until completion, and reports outstanding or backordered items.

It also translates the documented workflow into design requirements for an internal purchasing and accounting system.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. The source states that purchase orders required QuickBooks Online Plus and had to be enabled in company settings. Current availability may differ by version and country.

---

## 1. Purchase Order Overview

A Purchase Order (PO) is a formal document issued to a supplier to request goods or services.

A purchase order normally contains:

- supplier;
- purchase order number;
- order date;
- expected delivery date;
- products or services;
- ordered quantity;
- unit price;
- tax treatment;
- delivery location;
- payment terms;
- notes and attachments;
- approval information.

A PO is not normally an accounting expense or payable by itself. The accounting impact generally begins when goods or services are received and a supplier bill is recorded.

---

## 2. Enable Purchase Orders

The source manual states that purchase orders must be enabled through:

```text
Company Settings > Expenses > Purchase Orders > On
```

### Recommended activation controls

Before enabling purchase orders, confirm:

- purchasing workflow owner;
- PO numbering format;
- approval thresholds;
- supplier master quality;
- item master quality;
- receiving process;
- bill-matching process;
- warehouse or delivery-location setup;
- tax configuration;
- user permissions.

---

## 3. Create a Purchase Order

Navigate to:

```text
New/Create > Suppliers > Purchase Order
```

Select the supplier and complete the order details.

Typical fields include:

| Field | Description |
|---|---|
| PO number | Unique purchase-order reference |
| Supplier | Vendor receiving the order |
| Order date | Date the PO is issued |
| Expected delivery date | Planned receipt date |
| Ship-to location | Delivery destination |
| Currency | Transaction currency |
| Product or service | Ordered item |
| Description | Item or service details |
| Ordered quantity | Quantity requested |
| Unit price | Agreed purchase rate |
| Tax code | Purchase tax treatment |
| Line total | Quantity multiplied by price |
| Memo | Internal or supplier-facing notes |
| Attachment | Quote, contract, specification, or approval |

After creation, the source manual shows the purchase order as **Open**.

---

## 4. Purchase Order Calculations

For each PO line:

```text
Line Total = Ordered Quantity × Unit Price
```

PO total:

```text
Subtotal
- Discount
+ Tax
+ Freight or Other Charges
= Purchase Order Total
```

Outstanding line quantity:

```text
Outstanding Quantity
= Ordered Quantity
- Received Quantity
- Cancelled Quantity
```

Outstanding line value:

```text
Outstanding Value
= Outstanding Quantity × Approved Unit Price
```

---

## 5. Recommended Purchase Order Statuses

```text
Draft
    ↓
Pending Approval
    ↓
Approved
    ↓
Sent to Supplier
    ↓
Open
    ↓
Partially Received
    ↓
Fully Received
    ↓
Closed
```

Alternative outcomes:

```text
Rejected
Cancelled
Expired
Manually Closed
Disputed
```

### Status rules

- Draft POs cannot be sent.
- Pending Approval POs cannot create receiving transactions.
- Approved POs may be sent to suppliers.
- Partially Received POs remain open.
- Fully Received POs may remain open until billing is complete.
- Cancelled or closed POs cannot receive new quantities without an approved reopening process.

---

## 6. Receive Stock and Create a Supplier Bill

The source manual describes receiving stock by creating a supplier bill and linking the purchase order.

Two documented methods are available.

### Method 1 - Copy Purchase Order to Bill

Open the PO and select:

```text
Copy to Bill
```

### Method 2 - Add Purchase Order from the Bill

Create a bill:

```text
New/Create > Suppliers > Bill
```

Then use the right-hand drawer to add the purchase order to the bill.

### Result

The bill is populated from the selected PO. The user can then adjust quantities to reflect what was actually received or billed.

---

## 7. Partial Purchase Orders

A partial purchase order occurs when only part of the ordered quantity is received or billed.

Example:

```text
Ordered: 100 units
Received and billed: 60 units
Remaining open: 40 units
```

The source manual states that the PO remains open until:

- the remaining items are received; or
- the PO is manually closed.

### Partial receipt calculation

```text
Remaining Quantity
= Ordered Quantity
- Total Received Quantity
```

Example:

```text
100 ordered
- 60 first receipt
- 25 second receipt
= 15 remaining
```

---

## 8. Separate Receiving and Billing

The source workflow converts the PO directly to a bill. For stronger operational control, a custom system should separate:

1. Purchase Order;
2. Goods Receipt or Service Receipt;
3. Supplier Bill.

Recommended workflow:

```text
Purchase Order
        ↓
Goods or Service Receipt
        ↓
Supplier Bill
        ↓
Three-Way Match
        ↓
Approval
        ↓
Accounts Payable
        ↓
Payment
```

This separation improves control when goods arrive before the invoice or when the supplier invoice differs from the delivery.

---

## 9. Goods Receipt

A Goods Receipt should record:

| Field | Description |
|---|---|
| Receipt number | Unique receiving reference |
| PO number | Source purchase order |
| Supplier | Supplier delivering goods |
| Receipt date | Actual receipt date |
| Warehouse/location | Delivery destination |
| Product | Received item |
| Quantity received | Actual quantity |
| Quantity accepted | Quantity passing inspection |
| Quantity rejected | Damaged or incorrect quantity |
| Lot/serial number | Traceability information |
| Receiver | Employee confirming receipt |
| Attachment | Delivery note, photo, or inspection record |

### Receipt controls

- cannot receive more than the remaining PO quantity without approval;
- rejected quantity must include a reason;
- receipt date must be within an open operational period;
- warehouse and product must be valid;
- duplicate supplier delivery references should be detected.

---

## 10. Service Receipt

For service POs, receipt may be based on:

- milestone completion;
- approved timesheets;
- work completion certificate;
- project manager confirmation;
- percentage completed;
- accepted deliverable.

Example:

```text
Consulting PO: 100 hours
Approved this period: 35 hours
Remaining: 65 hours
```

A service receipt should not update physical inventory but should support bill matching and accrual accounting.

---

## 11. Three-Way Matching

Three-way matching compares:

```text
Purchase Order
        ↕
Goods/Service Receipt
        ↕
Supplier Bill
```

### Match dimensions

| Dimension | Comparison |
|---|---|
| Supplier | Same supplier across documents |
| Product/service | Same item or approved substitute |
| Quantity | Billed quantity does not exceed accepted quantity |
| Price | Bill price agrees with PO price |
| Tax | Tax treatment is consistent |
| Currency | Currency matches |
| Terms | Payment terms agree |
| References | PO, receipt, and bill links exist |

### Match outcomes

```text
Matched
Within Tolerance
Exception
Rejected
Approval Required
```

---

## 12. Tolerance Rules

A system may support approved tolerances.

Examples:

| Rule | Example |
|---|---|
| Price tolerance | Up to 2% variance |
| Quantity tolerance | Up to 1 unit overage |
| Freight tolerance | Up to an approved amount |
| Tax tolerance | Rounding-only difference |
| Total tolerance | Maximum monetary threshold |

Any difference outside the permitted tolerance should enter an exception queue.

---

## 13. Purchase Order Approval

Recommended approval thresholds:

| PO value | Approval |
|---:|---|
| Low value | Department manager |
| Medium value | Department manager and finance |
| High value | Finance director or executive |
| Capital expenditure | Budget owner and finance |
| Precious materials | Specialized purchasing and finance approval |

Other approval conditions may include:

- new supplier;
- price above contract;
- non-budgeted purchase;
- foreign currency;
- advance payment;
- related party;
- restricted item;
- emergency purchase.

---

## 14. Change Orders

After a PO is approved or sent, material changes should create a new version or change order.

Controlled changes include:

- quantity;
- price;
- delivery date;
- currency;
- supplier;
- item;
- tax;
- delivery location;
- terms.

Recommended versioning:

```text
PO-10025-V1
PO-10025-V2
PO-10025-V3
```

The system should preserve:

- original version;
- change reason;
- changed fields;
- changed by;
- approval;
- effective date;
- supplier notification status.

---

## 15. Manual Closure

A purchase order may be manually closed when the remaining balance will not be received.

Examples:

- supplier cannot fulfill the balance;
- project is cancelled;
- remaining quantity is no longer needed;
- substitute PO is issued;
- commercial dispute is resolved.

### Manual-close requirements

- reason is mandatory;
- remaining quantity and value are displayed;
- approver is recorded;
- open commitments are released;
- history remains visible;
- reports distinguish fully received from manually closed POs.

---

## 16. Backorders and Outstanding Purchase Orders

The source manual identifies reports for outstanding supplier orders.

### Open Purchase Orders Detail

Provides a summary of:

- open purchase orders;
- supplier;
- PO value;
- outstanding value.

### Open Purchase Order Detailed Report

Provides line-level information about:

- items ordered;
- received quantity;
- remaining quantity;
- backordered items.

### Recommended additional reports

- overdue purchase orders;
- partially received POs;
- open commitments by supplier;
- open commitments by department;
- supplier delivery performance;
- price variance;
- quantity variance;
- unbilled receipts;
- bills without purchase orders;
- PO ageing.

---

## 17. Inventory and Financial Impact

### At PO creation

Normally:

```text
No General Ledger entry
```

The PO creates a purchasing commitment, not an expense or payable.

### At goods receipt

Depending on accounting policy:

```text
Debit Inventory or Expense/Accrual
Credit Goods Received Not Invoiced
```

### At supplier bill

```text
Debit Goods Received Not Invoiced or Expense
Debit Recoverable Tax
Credit Accounts Payable
```

### At payment

```text
Debit Accounts Payable
Credit Bank
```

The exact entries depend on the organization’s accounting policies and system design.

---

## 18. Purchase Commitments

Even when the PO does not post to the General Ledger, its outstanding value should be available for budget control.

```text
Available Budget
= Approved Budget
- Actual Spend
- Open Purchase Commitments
```

This helps prevent departments from exceeding budgets through unreceived purchase orders.

---

## 19. Supplier Performance

PO and receipt data can support supplier metrics.

| Metric | Calculation |
|---|---|
| On-time delivery rate | On-time receipts / total receipts |
| Fill rate | Received quantity / ordered quantity |
| Price variance | Actual price - PO price |
| Rejection rate | Rejected quantity / received quantity |
| Average delivery delay | Actual receipt date - expected date |
| PO exception rate | POs with exceptions / total POs |

---

## 20. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Unauthorized purchase | PO issued without approval | Approval workflow |
| Duplicate PO | Same request ordered twice | Duplicate detection |
| Over-receipt | Receipt exceeds ordered quantity | Quantity validation |
| Overbilling | Bill exceeds received quantity | Three-way match |
| Price variance | Supplier bill price differs from PO | Tolerance and approval |
| Hidden commitment | Open PO omitted from budget view | Commitment reporting |
| Wrong supplier | Bill linked to another supplier's PO | Supplier validation |
| Manual closure misuse | Outstanding order closed without reason | Mandatory reason and approval |
| Duplicate receipt | Delivery note entered twice | Supplier-reference uniqueness |
| Backorder not monitored | Old open items remain unresolved | Ageing and alert rules |
| PO edited after approval | Price changed without review | Versioning and reapproval |
| Inventory updated incorrectly | Services treated as stock | Item-type validation |

---

## 21. Recommended Database Design

### `purchase_orders`

```text
id
po_number
version
supplier_id
order_date
expected_delivery_date
currency_code
ship_to_location_id
subtotal
discount_amount
tax_amount
total_amount
status
approval_status
created_by
approved_by
sent_at
closed_at
close_reason
created_at
updated_at
```

### `purchase_order_lines`

```text
id
purchase_order_id
line_number
product_id
description
ordered_quantity
received_quantity
cancelled_quantity
billed_quantity
unit_price
tax_code_id
line_total
expected_delivery_date
status
```

### `goods_receipts`

```text
id
receipt_number
purchase_order_id
supplier_id
receipt_date
warehouse_id
supplier_delivery_reference
status
received_by
approved_by
created_at
updated_at
```

### `goods_receipt_lines`

```text
id
goods_receipt_id
purchase_order_line_id
quantity_received
quantity_accepted
quantity_rejected
rejection_reason
lot_number
serial_number
```

### `purchase_order_changes`

```text
id
purchase_order_id
from_version
to_version
change_reason
change_summary
requested_by
approved_by
created_at
```

### Supporting tables

```text
purchase_requisitions
purchase_approvals
service_receipts
purchase_match_results
purchase_match_exceptions
purchase_order_attachments
supplier_performance_metrics
purchase_order_audit_history
```

---

## 22. Recommended Constraints

1. PO number and version must be unique.
2. A PO must have at least one line.
3. Ordered quantity must be positive.
4. Received plus cancelled quantity cannot exceed ordered quantity without approval.
5. Billed quantity cannot exceed accepted quantity outside tolerance.
6. Supplier must match across PO, receipt, and bill.
7. Currency must match across linked purchasing documents.
8. Closed or cancelled POs cannot receive new activity.
9. Approved POs cannot be overwritten directly.
10. Manual closure requires a reason.
11. Duplicate delivery references must be blocked or warned.
12. Financial postings must remain balanced and auditable.

---

## 23. Suggested Workflow

```text
Create Purchase Requisition
        ↓
Review Budget
        ↓
Select Supplier
        ↓
Create Purchase Order
        ↓
Approve
        ↓
Send to Supplier
        ↓
Receive Goods or Services
        ↓
Record Partial or Full Receipt
        ↓
Receive Supplier Bill
        ↓
Three-Way Match
        ↓
Resolve Exceptions
        ↓
Approve Bill
        ↓
Pay Supplier
        ↓
Close Purchase Order
```

---

## 24. AI Implementation Prompt

```text
Implement a purchase-order and partial-receipt module for an accounting and inventory web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Support purchase requisitions, purchase orders, approvals, supplier sending, receipts, bills, and closure.
- Support partial receipts and partial supplier bills.
- Keep a PO open until all quantities are received/cancelled or the PO is manually closed.
- Require a reason and approval for manual closure.
- Support PO versioning and change orders.
- Preserve original approved versions.
- Support goods receipts and service receipts.
- Track ordered, received, accepted, rejected, cancelled, billed, and outstanding quantities.
- Implement three-way matching across PO, receipt, and supplier bill.
- Support configurable price, quantity, tax, and total tolerances.
- Route mismatches to an exception queue.
- Support budget commitments based on outstanding PO value.
- Support supplier, currency, item, account, tax, and warehouse validation.
- Prevent duplicate PO numbers, duplicate receipts, over-receipts, and overbilling.
- Provide Open PO Detail, line-level backorder, overdue PO, unbilled receipt, and supplier-performance reports.
- Maintain immutable approval and audit history.
- Add search, filters, pagination, sticky headers, bulk actions, export, and role-based permissions.
- Include unit and integration tests for partial receipts, tolerances, matching, closure, versioning, permissions, and duplicate prevention.
```

---

## 25. Internal System Checklist

- [ ] Purchase Orders are enabled and governed.
- [ ] PO numbering is controlled.
- [ ] Approval thresholds are documented.
- [ ] Supplier and item masters are validated.
- [ ] PO versions are preserved.
- [ ] Partial receipts are supported.
- [ ] Rejected quantities require reasons.
- [ ] Three-way matching is implemented.
- [ ] Tolerances require explicit configuration.
- [ ] Manual closure requires approval.
- [ ] Outstanding commitments affect budget reports.
- [ ] Backorders and overdue POs are monitored.
- [ ] Duplicate deliveries are detected.
- [ ] Supplier bills cannot exceed approved quantities without exception handling.
- [ ] Inventory, Accounts Payable, and purchasing reports reconcile.

---

## Related Topics

- [05. Audit Log](05_Audit_Log.md)
- [11. Products and Services](11_Products_and_Services.md)
- [15. Expenses and Bills](15_Expenses_and_Bills.md)
- Inventory Management
- Supplier Management
- Approval Workflows
- Budget Control
- Accounts Payable

---

## Keywords

Purchase Order, PO, partial purchase order, partial receipt, goods receipt, service receipt, supplier bill, three-way matching, backorder, outstanding quantity, purchase commitment, approval workflow, change order, supplier performance