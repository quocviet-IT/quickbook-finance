# 11. Products and Services

> Source scope: *QuickBooks Online Business User Manual*, Version 4 — July 2022, pages 45–48.

## Purpose

This chapter explains how QuickBooks Online manages products and services used in sales, purchasing, invoicing, purchase orders, and inventory.

It also translates the documented workflow into design requirements for an internal accounting and operations system.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. Menu names, plan availability, and inventory behavior may differ in current versions.

---

## 1. What the Products and Services List Is

The Products and Services list contains the items a business sells or purchases.

Typical item types include:

- services;
- non-inventory products;
- inventory products;
- categories used to group items.

Products and services can be used in:

- customer invoices;
- quotes;
- sales receipts;
- purchase orders;
- supplier bills;
- inventory transactions;
- management reports.

---

## 2. Open Products and Services

Navigate to:

```text
Gear Icon > Lists > Products and Services
```

Alternatively, open the Products and Services page and select:

```text
New
```

The system then displays the available item types.

---

## 3. Item Types

A robust accounting system should distinguish between different item types.

| Item type | Purpose |
|---|---|
| Service | Work or services sold to customers |
| Non-inventory | Products bought or sold without stock tracking |
| Inventory | Products with quantity and value tracking |
| Category | Logical grouping of products and services |

> **QuickBooks note**
>
> The manual states that inventory items are available only in QuickBooks Online Plus and only when inventory tracking is enabled.

---

## 4. Create a Product or Service

Select **New**, then choose the item type.

Typical fields include:

| Field | Description |
|---|---|
| Name | Unique product or service name |
| SKU | Stock Keeping Unit |
| Category | Product grouping |
| Description | Default sales description |
| Sales price/rate | Default selling price |
| Inclusive of tax | Indicates whether the price includes tax |
| Income account | Revenue account used for sales |
| Tax code | Default tax treatment |
| Purchasing information | Indicates whether the item is also purchased |
| Purchase cost | Default supplier cost |
| Expense account | Purchase or expense account |
| Preferred supplier | Optional default supplier |

---

## 5. Name

The product or service name must be unique.

Examples:

```text
Consulting Services
Electrical Repair
Domestic Installation
Data Cabling
Gold Bar 9999
Scrap Gold 10–18K
Shipping Service
```

### Naming recommendations

Use names that are:

- clear;
- consistent;
- specific;
- searchable;
- understandable to accounting and operations users.

Avoid vague item names such as:

```text
Other
Misc
Item 1
New Service
General Product
```

---

## 6. SKU

SKU means **Stock Keeping Unit**.

A SKU is a unique code used to identify a product.

Example:

```text
GLD-9999-001
RING-18K-001
SVC-REPAIR-001
```

### Recommended SKU rules

- unique;
- no spaces;
- controlled format;
- stable after activation;
- searchable;
- consistent across accounting, inventory, and warehouse systems.

Example format:

```text
CATEGORY-MATERIAL-VARIANT-SEQUENCE
```

---

## 7. Categories

Categories group related products and services.

The manual gives examples such as:

- Admin;
- Electrical Commercial;
- Electrical Domestic;
- Data;
- Inventory Sales.

For an internal system, categories may include:

```text
Services
├── Consulting
├── Repair
└── Installation

Gold Products
├── 9999 Gold
├── Scrap Gold
├── Maple Leaf
└── American Eagle

Jewelry
├── Rings
├── Necklaces
├── Bracelets
└── Earrings
```

### Benefits

Categories improve:

- search;
- reporting;
- dropdown organization;
- sales analysis;
- inventory analysis;
- product maintenance.

---

## 8. Description

The description is automatically added to transaction forms when the item is selected.

Examples:

```text
Domestic electrical installation service.
24K gold bar, 9999 purity.
Repair and polishing service.
```

### Recommended control

Allow users to edit the transaction description without changing the master description.

---

## 9. Sales Price or Rate

The Sales Price/Rate is the default amount used in sales forms.

If no fixed price exists, the rate can be entered during transaction entry.

### Recommended fields

```text
default_sales_price
minimum_sales_price
currency
effective_from
effective_to
pricing_method
```

### Pricing controls

- validate price floors;
- record overrides;
- require approval for large discounts;
- retain historical price versions;
- support customer-specific prices;
- support quantity-based pricing;
- support multiple currencies.

---

## 10. Tax-Inclusive Pricing

When **Inclusive of Tax** is enabled, the entered price includes tax.

Example:

```text
Displayed price: 110.00
Tax included: 10.00
Net amount: 100.00
```

The system should clearly distinguish:

- tax-inclusive price;
- tax-exclusive price;
- tax code;
- calculated tax;
- net amount;
- gross amount.

---

## 11. Income Account

Each product or service should link to an income account.

Examples:

| Product/Service | Income account |
|---|---|
| Consulting Service | Service Revenue |
| Product Sale | Product Sales |
| Inventory Sale | Inventory Sales |
| Shipping Charge | Freight Revenue |

> **Important**
>
> The manual notes that income accounts should be created before setting up products and services.

### Recommended validation

The selected account must be:

- active;
- an income-type account;
- permitted for the legal entity;
- valid for the item’s tax treatment.

---

## 12. Tax Code

Select the default tax code applicable to the product or service.

The default tax code improves speed but should remain reviewable on each transaction.

Recommended controls:

- controlled tax-code list;
- account and tax-code compatibility rules;
- exception reporting;
- audit history for tax-code changes;
- approval for overrides.

---

## 13. Purchasing Information

Enable purchasing information when the product or service is also bought from suppliers.

Typical fields include:

| Field | Description |
|---|---|
| Purchase description | Default supplier-side description |
| Purchase cost | Default unit cost |
| Expense account | Cost or expense posting account |
| Preferred supplier | Default supplier |
| Purchase tax code | Default purchase tax treatment |

---

## 14. Save the Item

After reviewing the setup, select:

```text
Save and Close
```

Before saving, verify:

- [ ] Name is unique.
- [ ] SKU is valid.
- [ ] Category is correct.
- [ ] Sales description is complete.
- [ ] Sales price is correct.
- [ ] Income account is valid.
- [ ] Tax code is correct.
- [ ] Purchasing information is accurate.
- [ ] Expense account is valid.
- [ ] Inventory configuration is correct where applicable.

---

## 15. Adding Inventory

Inventory can be added:

- manually, one item at a time; or
- in bulk through Products and Services import.

For bulk import, download the sample file and select **Inventory** as the item type.

### Inventory-specific fields

| Field | Description |
|---|---|
| Initial quantity on hand | Opening stock quantity |
| As-of date | Date of opening stock |
| Inventory asset account | Balance Sheet account |
| Income account | Revenue account |
| Cost of Goods Sold account | Expense account |
| Purchase cost | Default purchase cost |
| Sales price | Default selling price |
| Reorder point | Optional replenishment trigger |

> **Important**
>
> The manual states that the initial quantity date cannot be changed later. Quantity errors should be corrected through an inventory quantity adjustment.

---

## 16. Inventory Quantity Adjustment

Navigate to:

```text
New/Create > Other > Inventory Quantity Adjustment
```

Use this when the recorded quantity differs from the physical quantity.

Typical adjustment reasons:

- stock count difference;
- damage;
- loss;
- data-entry correction;
- production consumption;
- scrap;
- return;
- warehouse transfer correction.

### Required controls

- adjustment reason;
- supporting document;
- item;
- warehouse/location;
- quantity before;
- adjustment quantity;
- quantity after;
- value impact;
- approver;
- audit log.

---

## 17. FIFO Costing

The manual notes that QuickBooks uses the FIFO method for inventory.

FIFO means:

```text
First In, First Out
```

The oldest available inventory cost is recognized first when inventory is sold.

Example:

```text
Purchase 1: 10 units @ 100
Purchase 2: 10 units @ 120
Sale: 12 units
```

FIFO cost:

```text
10 × 100 = 1,000
2 × 120 = 240
Total COGS = 1,240
```

Remaining inventory:

```text
8 units × 120 = 960
```

---

## 18. Inventory Reports

The manual indicates that inventory reports are available under:

```text
Reports > Sales and Customers
```

Typical reports may include:

- quantity on hand;
- inventory valuation;
- low-stock items;
- sales by product;
- purchase history;
- item profitability;
- stock adjustments.

---

## 19. Product Lifecycle

Recommended status model:

```text
Draft
    ↓
Pending Review
    ↓
Active
    ↓
Temporarily Unavailable
    ↓
Discontinued
    ↓
Archived
```

### Suggested rules

- Draft items cannot be used in transactions.
- Active items can be bought and sold.
- Discontinued items cannot be used in new transactions.
- Historical transactions remain visible.
- Items with transactions should not be deleted permanently.
- Price and account changes should be versioned.

---

## 20. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Duplicate products | Same product created twice | Duplicate name and SKU validation |
| Wrong account mapping | Product points to expense instead of income | Account-type validation |
| Wrong tax code | Product uses incorrect tax treatment | Tax compatibility rules |
| Incorrect opening quantity | Inventory overstated | Approval and stock-count reconciliation |
| Date error | Opening inventory date is wrong | Review before activation |
| Unauthorized price override | User sells below allowed price | Approval threshold |
| Negative inventory | Sale exceeds quantity on hand | Warning or blocking rule |
| Missing SKU | Warehouse cannot identify product | Required SKU policy |
| Historical deletion | Reports no longer reconcile | Deactivate instead of delete |
| Wrong costing | Incorrect COGS | Controlled costing method |

---

## 21. Suggested Database Design

### `products`

```text
id
sku
name
item_type
category_id
sales_description
purchase_description
default_sales_price
default_purchase_cost
income_account_id
expense_account_id
inventory_asset_account_id
cogs_account_id
sales_tax_code_id
purchase_tax_code_id
preferred_supplier_id
currency_code
status
created_at
updated_at
```

### `product_categories`

```text
id
name
parent_category_id
status
created_at
updated_at
```

### `product_prices`

```text
id
product_id
price_type
currency_code
price
effective_from
effective_to
customer_id
minimum_quantity
approved_by
created_at
```

### `inventory_balances`

```text
id
product_id
warehouse_id
quantity_on_hand
quantity_reserved
quantity_available
average_cost
updated_at
```

### `inventory_adjustments`

```text
id
product_id
warehouse_id
adjustment_date
quantity_before
adjustment_quantity
quantity_after
reason_code
reference_number
approved_by
created_at
```

---

## 22. Recommended Constraints

1. SKU must be unique.
2. Product name must be unique within its category where required.
3. Inventory items require asset and COGS accounts.
4. Service items do not require inventory accounts.
5. Income account must be an active income account.
6. Expense and COGS accounts must be valid posting accounts.
7. Opening quantity requires an as-of date.
8. Inventory adjustment quantity cannot be zero.
9. Items with transaction history cannot be deleted.
10. Price overrides below threshold require approval.

---

## 23. Suggested Workflow

```text
Create Product or Service
        ↓
Assign Type and Category
        ↓
Assign SKU
        ↓
Configure Sales and Purchase Details
        ↓
Map Ledger Accounts and Tax Codes
        ↓
Configure Inventory
        ↓
Review
        ↓
Approve
        ↓
Activate
        ↓
Monitor Usage and Stock
        ↓
Discontinue or Archive
```

---

## 24. AI Implementation Prompt

```text
Implement a Products and Services module for an accounting and inventory web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Support service, non-inventory, inventory, and category records.
- Require unique SKU and item name validation.
- Support hierarchical categories.
- Store sales and purchase descriptions separately.
- Support default sales price, purchase cost, and multiple currencies.
- Map each item to income, expense, inventory asset, and COGS accounts as applicable.
- Validate account types.
- Support separate sales and purchase tax codes.
- Support preferred suppliers.
- Support inventory opening quantity and as-of date.
- Support inventory quantity adjustments with reason, approval, and audit history.
- Support FIFO costing.
- Prevent deletion of items with transaction history.
- Add draft, active, discontinued, and archived statuses.
- Add price history and approval-controlled price overrides.
- Add search, filters, pagination, categories, bulk import, export, and sticky table headers.
- Include unit and integration tests for SKU uniqueness, account mapping, tax validation, inventory adjustments, FIFO costing, and permissions.
```

---

## 25. Internal System Checklist

- [ ] Item types are standardized.
- [ ] SKU format is documented.
- [ ] Duplicate validation is enabled.
- [ ] Categories are controlled.
- [ ] Income and expense accounts are valid.
- [ ] Tax codes are reviewed.
- [ ] Inventory accounts are configured.
- [ ] Opening quantities are approved.
- [ ] Inventory adjustments require a reason.
- [ ] Costing method is documented.
- [ ] Price overrides are controlled.
- [ ] Discontinued items remain available historically.
- [ ] Inventory reports reconcile to the ledger.

---

## Related Topics

- [06. Chart of Accounts](06_Chart_of_Accounts.md)
- [10. Importing Data](10_Importing_Data.md)
- Quotes and Invoices
- Purchase Orders
- Inventory
- Expenses and Bills
- Reports Centre

---

## Keywords

Products and Services, SKU, item type, service, non-inventory, inventory, category, sales price, purchase cost, income account, expense account, inventory asset, COGS, FIFO, inventory adjustment, item master