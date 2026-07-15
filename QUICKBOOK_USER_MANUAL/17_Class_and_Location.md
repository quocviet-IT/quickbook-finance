# 17. Class and Location Tracking

> Source scope: *QuickBooks Online Business User Manual*, Version 4 - July 2022, pages 78-79.

## Purpose

This chapter explains how QuickBooks Online uses **Class Tracking** and **Location Tracking** as management-reporting dimensions.

It also translates the documented workflow into design requirements for an internal accounting and operations system that needs reporting by department, business line, branch, store, warehouse, production line, or another organizational dimension.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. The source states that Class and Location Tracking were available to QuickBooks Online Plus users. Current plan availability and interface behavior may differ.

---

## 1. Why Class and Location Tracking Matter

Class and Location Tracking help a business analyze financial activity without creating excessive ledger accounts.

Typical use cases include reporting by:

- department;
- business unit;
- product line;
- sales channel;
- project type;
- branch;
- store;
- warehouse;
- office;
- production line;
- geographic region.

These dimensions support management reporting while keeping the Chart of Accounts focused on accounting classification.

---

## 2. Class Tracking

A **Class** is a management-reporting dimension that may be assigned to:

- an entire transaction; or
- individual detail lines within a transaction.

The source manual states that QuickBooks can be configured to assign one class to the whole transaction or one class to each transaction row.

### Example - one class for the entire transaction

```text
Supplier Bill: 10,000
Class: Retail Division
```

All lines inherit the same class.

### Example - one class per line

```text
Supplier Bill: 10,000

Line 1 - Marketing Expense: 6,000 - Class: Online Sales
Line 2 - Store Expense: 4,000 - Class: Retail Store
```

Line-level assignment provides more detailed reporting but requires stronger validation and more user effort.

---

## 3. Location Tracking

A **Location** is assigned to the entire transaction.

The source manual states that a transaction cannot have a different location for each detail line.

### Example

```text
Customer Invoice: 25,000
Location: New York Branch
```

All invoice lines belong to the New York Branch location.

### Typical location values

```text
Head Office
New York Branch
California Branch
Online Store
Warehouse A
Warehouse B
Vietnam Office
US Office
```

---

## 4. QuickBooks Comparison

| Capability | Class Tracking | Location Tracking |
|---|---|---|
| Whole-transaction assignment | Supported | Supported |
| Line-level assignment | Supported when configured | Not supported in the documented workflow |
| Missing-value warning | Optional warning available | No missing-location prompt documented |
| Deposit grouping | Cannot group deposits by class | Can group deposits by location |
| Main purpose | Department, division, line, activity | Branch, store, office, warehouse |

---

## 5. Supported Transactions

The source manual states that Class and Location Tracking apply to all account types and all transaction types except **Transfer**.

> **Design recommendation**
>
> A custom internal system may still retain a management dimension on transfer records for operational reporting, but the accounting impact and reporting rules must be defined explicitly.

---

## 6. Turn On Class and Location Tracking

Navigate to:

```text
Gear Icon > Account and Settings > Advanced > Categories
```

Then:

1. enable **Track classes**;
2. enable **Track locations** where required;
3. configure Class Tracking behavior;
4. select **Save**.

### Class configuration options documented in the manual

- Warn when a transaction has not been assigned a class.
- Assign one class to each row in a transaction.
- Assign one class to the entire transaction.

---

## 7. Recommended Class Design

Classes should represent a stable management-reporting structure.

Example:

```text
Business Division
├── Jewelry Sales
├── Gold Trading
├── Repair Services
├── Online Sales
└── Wholesale Sales
```

Another example:

```text
Production Function
├── Casting
├── Polishing
├── Stone Setting
├── Quality Control
└── Packaging
```

### Good class characteristics

- clearly defined;
- mutually understandable;
- not duplicated;
- stable over time;
- owned by a responsible department;
- linked to reporting requirements.

### Avoid

```text
Other
General
Temporary
Class 1
Miscellaneous
```

---

## 8. Recommended Location Design

Locations should represent real operational or reporting entities.

Example:

```text
Locations
├── US Head Office
├── New York Store
├── California Store
├── Online Channel
├── Vietnam Office
├── Warehouse US-01
└── Warehouse VN-01
```

### Location master fields

| Field | Description |
|---|---|
| Location code | Unique reference |
| Location name | Display name |
| Location type | Office, store, warehouse, online, plant |
| Parent location | Optional hierarchy |
| Legal entity | Owning company |
| Address | Physical address |
| Currency | Default operating currency |
| Manager | Responsible person |
| Status | Draft, active, inactive |
| Effective dates | Validity period |

---

## 9. Class vs Chart of Accounts

Do not create separate ledger accounts merely to obtain management reporting when a dimension is more appropriate.

### Poor design

```text
Office Expense - New York
Office Expense - California
Office Expense - Vietnam
Office Expense - Online
```

### Better design

```text
Account: Office Expense
Location: New York / California / Vietnam / Online
```

This approach reduces Chart of Accounts growth and improves reporting consistency.

---

## 10. Class vs Location vs Other Dimensions

| Dimension | Recommended purpose |
|---|---|
| Account | Accounting nature of the amount |
| Class | Division, department, product line, activity |
| Location | Branch, store, warehouse, office |
| Customer | External customer or debtor |
| Supplier | External supplier or creditor |
| Project | Specific project or engagement |
| Product | Item or service sold or purchased |
| Cost center | Organizational cost responsibility |
| Production line | Manufacturing process or line |

A custom system should define each dimension once and prevent overlapping meanings.

---

## 11. Transaction-Level vs Line-Level Dimensions

### Transaction-level dimensions

Apply to the full document.

Examples:

- legal entity;
- location;
- transaction currency;
- customer;
- supplier.

### Line-level dimensions

May vary by detail row.

Examples:

- class;
- department;
- cost center;
- project;
- product line;
- production line.

### Validation rule

If line-level classes are enabled, every posting line should either:

- contain a valid class; or
- inherit a permitted transaction-level default.

---

## 12. Missing-Dimension Controls

The source manual documents an optional warning for missing classes but no missing-location warning.

For an internal accounting system, use configurable enforcement levels:

| Level | Behavior |
|---|---|
| Optional | User may leave the dimension blank |
| Warning | User is warned but may continue |
| Required | Transaction cannot be posted without the dimension |
| Conditional | Required only for selected accounts or modules |

### Recommended conditional rules

- require location for bank deposits;
- require class for operating expenses;
- require production line for manufacturing costs;
- require project for project-related revenue;
- do not require class for balance-sheet opening entries unless needed.

---

## 13. Deposit Grouping

The source manual states:

- deposits cannot be grouped by Class;
- deposits can be grouped by Location.

This is useful when separate branches deposit funds into different banking locations or accounts.

### Internal-system recommendation

Store both:

- operational source location; and
- destination bank account.

Example:

```text
Source location: New York Store
Deposit account: Bank of America - New York Deposits
```

---

## 14. Dimension Governance

Every class and location should have:

- a unique code;
- a clear name;
- a documented purpose;
- an owner;
- an effective date;
- an active/inactive status;
- reporting mappings;
- approval history.

### Recommended lifecycle

```text
Draft
    ↓
Pending Approval
    ↓
Active
    ↓
Restricted
    ↓
Inactive
    ↓
Archived
```

Historical dimensions should normally be deactivated rather than deleted.

---

## 15. Dimension Hierarchies

A custom system may support hierarchies.

### Class hierarchy

```text
Sales
├── Retail
├── Wholesale
└── Online
```

### Location hierarchy

```text
United States
├── New York
│   ├── Store 01
│   └── Warehouse 01
└── California
    ├── Store 02
    └── Warehouse 02
```

### Constraints

- prevent circular hierarchies;
- limit hierarchy depth;
- preserve historical parent relationships;
- distinguish summary dimensions from posting dimensions.

---

## 16. Management Reports

Class and Location dimensions can support reports such as:

- Profit and Loss by Class;
- Profit and Loss by Location;
- Sales by Class;
- Expense by Department;
- Revenue by Branch;
- Gross Profit by Sales Channel;
- Deposit Summary by Location;
- Budget vs Actual by Class;
- Inventory Movement by Location;
- Production Cost by Line.

### Example matrix

| Account | Online Sales | Retail Store | Wholesale | Total |
|---|---:|---:|---:|---:|
| Revenue | 100,000 | 80,000 | 120,000 | 300,000 |
| Cost of Sales | 55,000 | 48,000 | 70,000 | 173,000 |
| Gross Profit | 45,000 | 32,000 | 50,000 | 127,000 |

---

## 17. Budgeting by Dimension

A custom system may support budgets by:

```text
Account + Class
Account + Location
Account + Class + Location
```

Example:

```text
Account: Marketing Expense
Class: Online Sales
Location: US Head Office
Monthly Budget: 20,000
```

Budget combinations should use controlled dimension values and effective dates.

---

## 18. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Missing class | Expense cannot be included in divisional report | Warning or required validation |
| Wrong location | Revenue assigned to the wrong branch | Role and location validation |
| Duplicate dimensions | Online and Online Sales represent the same class | Duplicate detection and governance |
| Excessive dimensions | Hundreds of unused classes | Approval and periodic cleanup |
| Overlapping meaning | Location used as department | Dimension dictionary |
| Historical deletion | Prior reports change | Deactivate instead of delete |
| Line inconsistency | Mixed classes on a document without review | Line-level validation and summary preview |
| Unauthorized changes | User reorganizes class hierarchy | Role-based permission and audit log |
| Broken integrations | External class no longer maps correctly | Mapping table and synchronization checks |

---

## 19. Suggested Database Design

### `dimensions`

```text
id
code
name
dimension_type
parent_id
legal_entity_id
status
effective_from
effective_to
owner_user_id
created_at
updated_at
```

### `dimension_types`

```text
id
code
name
assignment_level
is_required
supports_hierarchy
```

### `transaction_dimensions`

```text
id
transaction_id
dimension_id
dimension_type_id
source
created_at
```

### `transaction_line_dimensions`

```text
id
transaction_line_id
dimension_id
dimension_type_id
source
created_at
```

### Supporting tables

```text
dimension_mappings
dimension_change_history
dimension_approval_requests
dimension_validation_rules
dimension_budgets
```

---

## 20. Recommended Constraints

1. Dimension code must be unique within the legal entity and type.
2. Parent and child dimensions must share the same type.
3. Circular hierarchies are prohibited.
4. Inactive dimensions cannot be assigned to new transactions.
5. Historical assignments cannot be deleted silently.
6. Required dimensions must be present before posting.
7. Location is transaction-level unless the system explicitly supports line-level locations.
8. Class assignment level must follow the configured policy.
9. Dimension changes must be captured in the audit log.
10. External mappings must be unique and versioned.

---

## 21. Suggested Workflow

```text
Define Reporting Requirement
        ↓
Select Dimension Type
        ↓
Create Class or Location
        ↓
Review Hierarchy and Code
        ↓
Approve
        ↓
Activate
        ↓
Assign to Transactions
        ↓
Validate Before Posting
        ↓
Report and Reconcile
        ↓
Deactivate When No Longer Used
```

---

## 22. AI Implementation Prompt

```text
Implement a management-dimensions module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Support Class and Location dimensions.
- Support additional configurable dimensions such as department, cost center, project, warehouse, and production line.
- Support transaction-level and line-level assignment policies.
- Configure each dimension as optional, warning, required, or conditionally required.
- Support hierarchical dimension values and prevent circular relationships.
- Distinguish summary values from posting values.
- Prevent inactive values from being used in new transactions.
- Preserve historical assignments after deactivation.
- Add approval and immutable change history for dimension master data.
- Support external-system mappings.
- Support Profit and Loss, revenue, expense, deposit, and budget reports by dimension.
- Provide search, filters, pagination, hierarchy views, bulk import, and export.
- Validate missing or incompatible dimensions before posting.
- Use Supabase Row Level Security to limit users to permitted locations or departments.
- Include unit and integration tests for hierarchy, assignment level, required rules, deactivation, permissions, and reporting aggregation.
```

---

## 23. Internal System Checklist

- [ ] Class purpose is documented.
- [ ] Location purpose is documented.
- [ ] Dimension codes are standardized.
- [ ] Transaction-level and line-level rules are defined.
- [ ] Required-field behavior is configured.
- [ ] Hierarchies are controlled.
- [ ] Duplicate dimensions are prevented.
- [ ] Inactive dimensions remain available historically.
- [ ] User access is restricted by location where needed.
- [ ] External mappings are documented.
- [ ] Budgeting uses controlled dimensions.
- [ ] Reports reconcile to the general ledger.
- [ ] Dimension changes are auditable.

---

## Related Topics

- [05. Audit Log](05_Audit_Log.md)
- [06. Chart of Accounts](06_Chart_of_Accounts.md)
- [12. Banking Centre](12_Banking_Centre.md)
- [13. Quotes and Invoices](13_Quotes_and_Invoices.md)
- [15. Expenses and Bills](15_Expenses_and_Bills.md)
- Reports Centre
- Budgeting
- Production Reporting

---

## Keywords

Class Tracking, Location Tracking, management dimensions, department, branch, business unit, cost center, production line, line-level class, transaction-level location, dimensional reporting, Profit and Loss by Class, Profit and Loss by Location