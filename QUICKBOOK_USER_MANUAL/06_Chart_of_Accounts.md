# 06. Chart of Accounts

> Source scope: *QuickBooks Online Business User Manual*, Version 4 — July 2022, pages 29–31.

## Purpose

The Chart of Accounts is the structured list of ledger accounts used to classify transactions and produce financial reports such as the Balance Sheet and Profit and Loss Statement.

This chapter explains how to:

- open the Chart of Accounts;
- review and filter accounts;
- create a new account;
- configure account type, detail type, tax code, and subaccounts;
- manage accounts in batches;
- apply control rules when designing an internal accounting system.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. Menu labels and plan features may have changed.

---

## 1. Open the Chart of Accounts

QuickBooks provides two common navigation paths:

```text
Gear Icon > Your Company > Chart of Accounts
```

or:

```text
Accounting > Chart of Accounts
```

When opening the area for the first time, select **See your Chart of Accounts**.

---

## 2. Purpose of the Chart of Accounts

The Chart of Accounts supports:

- transaction classification;
- Balance Sheet reporting;
- Profit and Loss reporting;
- bank and credit-card registers;
- accounts receivable and payable;
- tax coding;
- financial controls;
- audit and reconciliation.

A poorly designed Chart of Accounts can create:

- duplicate accounts;
- inconsistent posting;
- unclear reporting;
- incorrect tax treatment;
- excessive manual adjustments;
- difficult migrations and integrations.

---

## 3. Review and Filter Accounts

The manual recommends filtering accounts by clicking the top of a column.

A useful filter is **Account Type**, because it groups accounts into Balance Sheet and Profit and Loss categories.

Typical review columns include:

| Column | Purpose |
|---|---|
| Name | Account display name |
| Type | Main accounting category |
| Detail Type | More specific classification |
| Number | Optional account number |
| Description | Additional explanation |
| Balance | Current account balance |
| Action | Edit, deactivate, or run a report |

---

## 4. Add a New Account

Select **New** in the upper-right corner of the Chart of Accounts page.

Complete the account configuration and then select **Save and Close**.

### Required and optional fields

| Field | Description |
|---|---|
| Account Type | Identifies the financial-statement category |
| Detail Type | Provides a more specific classification |
| Name | The account name displayed in the Chart of Accounts |
| Number | Optional account code when account numbering is enabled |
| Description | Optional explanatory text |
| Is sub-account | Makes the new account a child of a parent account |
| Default GST Code | Default tax code for transactions posted to the account |

---

## 5. Account Type

**Account Type** determines whether the account is presented on the:

- Balance Sheet; or
- Profit and Loss Statement.

Examples include:

- Bank
- Accounts Receivable
- Current Assets
- Fixed Assets
- Accounts Payable
- Credit Card
- Current Liabilities
- Equity
- Income
- Cost of Goods Sold
- Expenses
- Other Income
- Other Expenses

> **Note**
>
> The manual states that **Cash and cash equivalents** is used when setting up bank accounts.

---

## 6. Detail Type

**Detail Type** provides further classification under the selected Account Type.

According to the manual:

- it is a compulsory field;
- it does not directly change financial reporting;
- users should select the closest available detail type.

### Design principle

Use the Detail Type to improve consistency, but do not rely on it as the only reporting dimension.

For more complex reporting, use:

- account hierarchy;
- departments;
- classes;
- locations;
- projects;
- tags;
- custom dimensions.

---

## 7. Account Name

The account name is displayed in the Chart of Accounts and transaction forms.

### Naming recommendations

Use names that are:

- clear;
- unique;
- consistent;
- understandable to accountants and non-accountants;
- aligned with the company’s reporting structure.

### Example naming standard

```text
1000 - Cash and Cash Equivalents
1100 - Accounts Receivable
1200 - Inventory
2000 - Accounts Payable
4000 - Sales Revenue
5000 - Cost of Goods Sold
6100 - Office Expenses
```

Avoid vague names such as:

```text
Other
General
Misc
New Account
Temporary
```

---

## 8. Account Numbers

Account numbers are optional.

They can be enabled through:

```text
Account and Settings > Advanced > Chart of Accounts > Enable account numbers
```

### Recommended numbering structure

| Range | Category |
|---|---|
| 1000–1999 | Assets |
| 2000–2999 | Liabilities |
| 3000–3999 | Equity |
| 4000–4999 | Revenue |
| 5000–5999 | Cost of Goods Sold |
| 6000–6999 | Operating Expenses |
| 7000–7999 | Other Income and Expenses |

The exact structure should match company reporting requirements.

---

## 9. Subaccounts

Select **Is sub-account** to make an account part of a parent account.

Example:

```text
Cash and Cash Equivalents
├── Operating Bank Account
├── Payroll Bank Account
├── Savings Account
└── Petty Cash
```

Another example:

```text
Sales Revenue
├── Product Sales
├── Service Revenue
├── Online Sales
└── Export Sales
```

### Benefits

Subaccounts improve:

- reporting clarity;
- account grouping;
- drill-down analysis;
- financial-statement presentation.

### Risks

Too many levels may create:

- complex posting;
- inconsistent selection;
- long dropdown lists;
- duplicate or overlapping accounts.

Use a controlled hierarchy and limit unnecessary depth.

---

## 10. Default GST Code

Select the appropriate default GST code for the account.

This default can improve data-entry speed, but users must still verify whether the code is correct for each transaction.

### Recommended controls

- restrict tax-code configuration;
- validate incompatible account and tax-code combinations;
- record tax-code changes;
- create exception reports;
- allow override only for authorized roles.

---

## 11. Save the Account

After reviewing the setup, select:

```text
Save and Close
```

Before saving, verify:

- [ ] Account Type is correct.
- [ ] Detail Type is appropriate.
- [ ] Account name is unique.
- [ ] Account number follows the numbering standard.
- [ ] Parent account is correct.
- [ ] Default GST code is correct.
- [ ] Description is sufficient.
- [ ] The account is not a duplicate.

---

## 12. Batch Actions

The manual describes batch operations that can be applied to multiple accounts.

Examples include:

- setting a default GST code;
- making multiple accounts inactive.

Batch actions should require confirmation because they can affect many records at once.

### Recommended safeguards

1. Show the number of selected accounts.
2. Display the proposed change before saving.
3. Require a reason for material changes.
4. Record the user and timestamp.
5. Allow export of the affected account list.
6. Prevent changes to protected system accounts.

---

## 13. Action Menu

The **Action** column can provide options such as:

- Edit
- Make inactive
- Run report

The page may also include icons to:

- bulk edit;
- print the account list;
- customize visible columns.

> **Important**
>
> Making an account inactive is usually safer than deleting it because historical transactions may still depend on the account.

---

## 14. Account Lifecycle

A controlled account lifecycle can use these statuses:

```text
Draft
  ↓
Pending Review
  ↓
Active
  ↓
Restricted
  ↓
Inactive
  ↓
Archived
```

### Suggested rules

- Draft accounts cannot receive postings.
- New accounts require approval.
- Active accounts can receive transactions.
- Restricted accounts require elevated permission.
- Inactive accounts remain available for historical reports.
- Accounts with transactions cannot be permanently deleted.

---

## 15. Chart of Accounts Governance

Maintain an Account Register with:

| Field | Description |
|---|---|
| Account code | Unique number |
| Account name | Standardized name |
| Account type | Asset, liability, income, expense, etc. |
| Parent account | Hierarchy reference |
| Default tax code | Default tax treatment |
| Currency | Account currency where applicable |
| Effective date | Activation date |
| Status | Draft, active, inactive |
| Owner | Responsible finance role |
| Approval | Reviewer and approver |
| Purpose | Business use |
| Integration mapping | External-system mapping |

---

## 16. Risks and Controls

| Risk | Example | Control |
|---|---|---|
| Duplicate accounts | Two accounts for the same expense | Duplicate-name and similarity validation |
| Wrong account type | Expense configured as an asset | Approval workflow |
| Incorrect tax code | Revenue account mapped to purchase tax | Account-tax validation |
| Excessive subaccounts | Hundreds of narrowly defined accounts | Governance and hierarchy limits |
| Unauthorized account creation | User creates an unapproved ledger account | Role-based permissions |
| Historical account deletion | Reports no longer reconcile | Deactivate instead of delete |
| Broken integrations | External mapping points to the wrong account | Mapping table and integration tests |
| Unclear names | Users post to the wrong account | Naming standard and descriptions |

---

## 17. Suggested Database Design

```sql
chart_of_accounts
- id
- account_code
- account_name
- account_type
- detail_type
- parent_account_id
- description
- default_tax_code_id
- currency_code
- is_posting_account
- status
- effective_from
- effective_to
- created_by
- approved_by
- created_at
- updated_at
```

Additional supporting tables:

```text
account_types
account_mappings
account_change_history
account_approval_requests
tax_codes
currencies
```

### Recommended constraints

- unique account code;
- unique account name within the same parent;
- no circular parent-child relationships;
- inactive parent cannot receive new active children without approval;
- system accounts cannot be deleted;
- posting accounts and summary accounts must be distinguished.

---

## 18. Suggested Workflow

```text
Request New Account
        ↓
Validate Name and Code
        ↓
Check for Duplicates
        ↓
Assign Type and Parent
        ↓
Assign Tax Code
        ↓
Finance Review
        ↓
Approval
        ↓
Activate
        ↓
Monitor Usage
        ↓
Restrict or Deactivate
```

---

## 19. AI Implementation Prompt

```text
Implement a Chart of Accounts module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Support account code, name, type, detail type, description, tax code, currency, and status.
- Support parent-child subaccounts with hierarchy validation.
- Prevent circular account hierarchies.
- Distinguish summary accounts from posting accounts.
- Prevent duplicate account codes.
- Detect similar account names and warn users.
- Require approval before a new account becomes active.
- Use inactive status instead of deleting accounts with transaction history.
- Provide filtering, sorting, search, pagination, and sticky table headers.
- Provide batch actions with confirmation and audit history.
- Restrict account creation and tax-code changes by role.
- Maintain immutable account-change history.
- Support external accounting-system mappings.
- Provide export to CSV and Google Sheets.
- Include unit tests for hierarchy, duplicates, permissions, and deactivation.
```

---

## 20. Internal Accounting System Checklist

- [ ] Account numbering standard is documented.
- [ ] Account types align with financial statements.
- [ ] Subaccount depth is limited.
- [ ] Duplicate checks are implemented.
- [ ] Tax-code mappings are controlled.
- [ ] New accounts require approval.
- [ ] Historical accounts are deactivated, not deleted.
- [ ] External-system mappings are documented.
- [ ] Changes are included in the audit log.
- [ ] Reports can group parent and child accounts.
- [ ] Import/export templates are standardized.

---

## Related Topics

- [03. Company Setup](03_Company_Setup.md)
- [04. GST Setup](04_GST_Setup.md)
- [05. Audit Log](05_Audit_Log.md)
- Products and Services
- Opening Balances
- Banking Centre
- Reports Centre
- Class and Location Tracking

---

## Keywords

Chart of Accounts, COA, account type, detail type, account number, subaccount, parent account, GST code, ledger account, posting account, financial reporting, account hierarchy, account governance, account mapping