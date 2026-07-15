# 10. Importing Data

> Source scope: *QuickBooks Online Business User Manual*, Version 4 — July 2022, pages 41–44.

## Purpose

This chapter explains how QuickBooks Online imports accounting data from another system and how opening balances should be prepared when starting a new company file.

It also translates the documented workflow into a controlled migration process for an internal accounting system.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. Supported file formats, import limits, field mappings, and conversion services may differ in current versions.

---

## 1. When Data Import Is Needed

Data import is commonly required when:

- moving from another accounting system;
- replacing spreadsheets with a web application;
- starting a clean accounting file;
- correcting an old file that cannot be cleaned efficiently;
- consolidating customer, supplier, product, and account data;
- migrating opening balances into a new ledger.

A migration may include:

- customers;
- suppliers;
- Chart of Accounts;
- products and services;
- opening balances;
- unpaid customer invoices;
- unpaid supplier bills;
- historical transactions;
- attachments and supporting documents.

---

## 2. Open the Import Area

Navigate to:

```text
Gear Icon > Tools > Import Data
```

Then select the type of data to import.

The manual notes that sample templates may be available after choosing an import type.

Supported template formats documented in the manual include:

```text
.xlsx
.csv
```

---

## 3. Recommended Import Order

The order of import matters because some records depend on others.

Recommended sequence:

```text
1. Chart of Accounts
2. Tax Codes and Configuration
3. Customers
4. Suppliers
5. Products and Services
6. Opening Balances
7. Open Customer Invoices
8. Open Supplier Bills
9. Historical Transactions
10. Attachments and Supporting Documents
```

The manual specifically notes that the Chart of Accounts should be imported before Products and Services.

---

## 4. Customer Import

The documented customer import process has three main stages:

```text
Upload
    ↓
Map Data
    ↓
Import
```

### Step 1 — Select Customers

Choose **Customers** from the Import Data area.

### Step 2 — Select the file

Browse for the `.xlsx` or `.csv` file.

### Step 3 — Upload

Select the file and continue.

### Step 4 — Map fields

Match each column from the source file to the corresponding QuickBooks field.

Example:

| Source column | Target field |
|---|---|
| Customer Name | Display Name |
| Company | Company Name |
| Email Address | Email |
| Phone Number | Phone |
| Billing Address | Billing Address |
| Shipping Address | Shipping Address |

### Step 5 — Review the preview

Check the import preview and correct errors.

### Step 6 — Import

Confirm the import.

After completion, customer records should appear in the customer list.

---

## 5. Supplier Import

Supplier import follows the same general workflow:

```text
Import Data > Suppliers
```

Typical supplier fields include:

| Field | Purpose |
|---|---|
| Supplier name | Display and transaction selection |
| Legal name | Contract and tax records |
| Email | Communication |
| Phone | Contact |
| Address | Billing and tax records |
| Tax registration number | Reporting and compliance |
| Payment terms | Payables management |
| Currency | Multi-currency transactions |
| Status | Active or inactive |

---

## 6. Chart of Accounts Import

Navigate to:

```text
Import Data > Chart of Accounts
```

Typical fields include:

| Field | Description |
|---|---|
| Account number | Unique account code |
| Account name | Ledger account name |
| Account type | Asset, liability, income, expense, etc. |
| Detail type | More specific category |
| Description | Account purpose |
| Parent account | Subaccount relationship |
| Default tax code | Default tax treatment |

### Controls

- prevent duplicate account numbers;
- validate account types;
- validate parent-child relationships;
- prevent circular account hierarchies;
- reject invalid tax-code mappings;
- require approval before activation.

---

## 7. Products and Services Import

Navigate to:

```text
Import Data > Products and Services
```

The manual states that the Chart of Accounts must be imported first because Products and Services may reference income, expense, or inventory accounts.

Typical fields include:

| Field | Description |
|---|---|
| Name | Product or service name |
| SKU | Stock-keeping unit |
| Type | Service, non-inventory, or inventory |
| Category | Product grouping |
| Description | Default transaction description |
| Sales price | Default selling rate |
| Purchase cost | Default purchase cost |
| Income account | Revenue posting account |
| Expense account | Cost or expense posting account |
| Inventory asset account | Inventory balance account |
| Tax code | Default tax treatment |
| Quantity on hand | Opening stock quantity |
| As-of date | Inventory opening date |

---

## 8. Data Mapping

Field mapping connects source columns to target fields.

Example:

```text
Source: Cust_Name
Target: Customer Display Name
```

### Mapping checklist

- [ ] Every required target field is mapped.
- [ ] Date formats are consistent.
- [ ] Currency codes use a controlled list.
- [ ] Numeric fields contain only numbers.
- [ ] Boolean values are standardized.
- [ ] Duplicate records are identified.
- [ ] Blank required fields are resolved.
- [ ] Parent-child references are valid.
- [ ] Tax codes are valid.
- [ ] Special characters display correctly.

---

## 9. Data Cleansing Before Import

Do not import unreviewed source data directly into production.

Recommended cleansing steps:

1. Remove duplicate records.
2. Standardize names.
3. Standardize addresses.
4. Normalize phone numbers.
5. Validate emails.
6. Validate tax identifiers.
7. Normalize dates.
8. Normalize currency codes.
9. Map old account codes to new account codes.
10. Mark inactive records.
11. Identify missing mandatory fields.
12. Separate invalid records into an exception file.

---

## 10. Import Preview and Validation

Before committing an import, display:

- total rows;
- valid rows;
- warning rows;
- rejected rows;
- duplicates;
- unmapped fields;
- missing mandatory fields;
- invalid references.

Recommended status model:

```text
Uploaded
    ↓
Mapped
    ↓
Validated
    ↓
Ready for Import
    ↓
Imported
    ↓
Reconciled
```

Exception statuses:

```text
Rejected
Needs Review
Duplicate Suspected
Missing Mapping
Invalid Reference
```

---

## 11. Opening Balances

When migrating to a new accounting system, opening balances establish the financial position at the migration date.

The manual recommends reviewing reports from the previous system, including:

- Trial Balance;
- Balance Sheet;
- Profit and Loss;
- General Ledger;
- Customer Ageing Detail;
- Supplier Ageing Detail;
- Last Bank Reconciliation.

A new file may begin at any appropriate date. The manual suggests that starting at the beginning of a financial year is ideal where practical.

---

## 12. Two Opening-Balance Approaches

### Option 1 — Single Journal Including Receivables and Payables

Create one journal containing:

- Balance Sheet accounts;
- customer balances;
- supplier balances.

### Limitation

All customer and supplier balances may share the same journal date, reducing the usefulness of aged receivable and aged payable reporting.

---

### Option 2 — Journal Plus Open Invoices and Bills

Create:

1. one opening journal for Balance Sheet accounts, excluding individual receivables and payables;
2. individual open customer invoices;
3. individual open supplier bills.

This approach preserves:

- invoice dates;
- bill dates;
- invoice numbers;
- bill numbers;
- aged receivable reporting;
- aged payable reporting;
- transaction-level settlement.

> **Recommended**
>
> Option 2 is generally better when aged receivable and payable reporting must remain accurate.

---

## 13. Opening Journal

A journal can be created through:

```text
New/Create > Other > Journal Entry
```

Typical journal fields include:

- journal date;
- account;
- debit;
- credit;
- description;
- customer or supplier;
- tax code;
- reference number.

### Opening-balance rule

The opening journal must balance:

```text
Total Debits = Total Credits
```

---

## 14. Migration Cutover Date

A migration requires a clearly defined cutover date.

Example:

```text
Old system closes: 30 June 2026
New system begins: 1 July 2026
```

### Cutover checklist

- [ ] Final transactions are posted in the old system.
- [ ] Bank accounts are reconciled.
- [ ] Customer and supplier balances are confirmed.
- [ ] Inventory is counted.
- [ ] Tax balances are confirmed.
- [ ] Fixed assets are reconciled.
- [ ] Trial Balance is approved.
- [ ] Data export is archived.
- [ ] Opening balances are loaded.
- [ ] New-system reports reconcile to the approved source.

---

## 15. Migration Reconciliation

After import, compare the new system with the old system.

Required reconciliations may include:

| Area | Comparison |
|---|---|
| Trial Balance | Old vs new |
| Bank balances | Old vs new |
| Accounts Receivable | Customer ageing totals |
| Accounts Payable | Supplier ageing totals |
| Inventory | Quantity and value |
| Fixed assets | Cost and accumulated depreciation |
| Tax accounts | Tax payable and receivable |
| Revenue and expenses | Where historical data is migrated |
| Customer count | Source vs target |
| Supplier count | Source vs target |
| Product count | Source vs target |

### Acceptance criterion

The migration should not be approved until all material differences are:

- corrected;
- explained;
- approved;
- documented.

---

## 16. Import Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Duplicate records | Same customer imported twice | Duplicate detection |
| Wrong mapping | Supplier name mapped to email | Mapping preview and approval |
| Missing records | Rows rejected silently | Exception report |
| Invalid dates | Mixed DD/MM and MM/DD | Date-format normalization |
| Incorrect balances | Opening journal does not reconcile | Trial Balance comparison |
| Broken references | Product references missing account | Dependency validation |
| Wrong currency | USD record imported as AUD | ISO currency validation |
| Incomplete AR/AP | Only summary balance imported | Import individual open documents |
| Unauthorized import | User imports production data | Role-based access |
| Partial failure | Some records import before error | Transactional import and rollback |
| Repeated import | Same file imported twice | File hash and idempotency key |

---

## 17. Recommended Database Design

### `import_jobs`

```text
id
import_type
source_filename
source_file_hash
status
total_rows
valid_rows
warning_rows
rejected_rows
created_by
approved_by
started_at
completed_at
created_at
```

### `import_mappings`

```text
id
import_job_id
source_column
target_field
transformation_rule
is_required
created_at
```

### `import_rows`

```text
id
import_job_id
row_number
source_data
normalized_data
validation_status
error_messages
target_record_id
created_at
```

### `migration_reconciliations`

```text
id
migration_id
reconciliation_type
source_total
target_total
difference
status
reviewed_by
approved_by
created_at
```

### Supporting tables

```text
migration_projects
migration_checklists
import_exceptions
import_audit_history
opening_balance_batches
opening_balance_lines
```

---

## 18. Recommended Technical Controls

1. Calculate a file hash before import.
2. Prevent the same file from being processed twice.
3. Use staging tables.
4. Validate all rows before production insert.
5. Import within a database transaction where practical.
6. Support partial exception handling without silent data loss.
7. Store original and normalized values.
8. Keep an immutable import audit trail.
9. Require approval for opening balances.
10. Provide rollback or compensating transactions.
11. Reconcile imported totals automatically.
12. Archive source files and mapping templates.

---

## 19. Suggested Import Workflow

```text
Create Migration Project
        ↓
Upload Source File
        ↓
Select Import Type
        ↓
Map Fields
        ↓
Normalize Data
        ↓
Validate
        ↓
Review Exceptions
        ↓
Approve Import
        ↓
Import to Staging
        ↓
Commit to Production
        ↓
Reconcile
        ↓
Approve and Lock
```

---

## 20. AI Implementation Prompt

```text
Implement a controlled data-import and accounting-migration module.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Support CSV and XLSX uploads.
- Support customers, suppliers, Chart of Accounts, products/services, opening balances, open invoices, and open bills.
- Provide reusable field-mapping templates.
- Store original source rows and normalized rows.
- Validate required fields, dates, currencies, tax codes, and references.
- Detect duplicates using exact and fuzzy matching.
- Use staging tables before production import.
- Generate valid, warning, rejected, and duplicate queues.
- Calculate file hashes and prevent duplicate imports.
- Require approval before production commit.
- Make imports idempotent.
- Record immutable import audit history.
- Support opening-balance batches with debit/credit validation.
- Support individual open invoices and bills to preserve ageing.
- Automatically reconcile imported totals to source totals.
- Provide rollback or compensating actions.
- Add search, filters, pagination, downloadable exception reports, and progress status.
- Include unit and integration tests for mapping, validation, duplicates, idempotency, balance checks, and permissions.
```

---

## 21. Internal System Checklist

- [ ] Migration scope is documented.
- [ ] Cutover date is approved.
- [ ] Import order is defined.
- [ ] Source files are archived.
- [ ] Mapping templates are approved.
- [ ] Duplicate detection is enabled.
- [ ] Invalid rows enter an exception queue.
- [ ] Imports use staging tables.
- [ ] Opening journal balances.
- [ ] Open invoices and bills preserve ageing.
- [ ] Trial Balance reconciles.
- [ ] Bank balances reconcile.
- [ ] AR and AP reconcile.
- [ ] Inventory quantity and value reconcile.
- [ ] Migration is approved and locked.

---

## Related Topics

- [06. Chart of Accounts](06_Chart_of_Accounts.md)
- [09. Multi-Currency](09_Multi_Currency.md)
- Customers
- Suppliers
- Products and Services
- Opening Balances
- Bank Reconciliation
- Audit Log

---

## Keywords

Importing Data, data migration, CSV import, XLSX import, field mapping, customer import, supplier import, Chart of Accounts import, Products and Services import, opening balances, Trial Balance, data cleansing, migration reconciliation, staging table, idempotency