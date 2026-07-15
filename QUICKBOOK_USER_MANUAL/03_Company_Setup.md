# 03 - Company File Setup: Account and Settings

## Chapter Scope

This chapter reorganizes Section 5 of the source manual, covering pages 18-19. It explains how the July 2022 Australian version of QuickBooks Online organized company-level configuration under **Account and Settings**.

The source section covers:

- opening company settings from the Gear icon;
- locating **Account and Settings** under **Your Company**;
- reviewing the available configuration categories;
- editing and saving company preferences;
- confirming that configuration matches the business's operational needs.

> **Historical interface note:** Menu names, settings, and subscription options may differ in current QuickBooks Online versions, countries, and plans. Use this chapter as a configuration-workflow reference and verify current behavior in the live product.

---

## 1. Purpose of Company File Setup

Company file setup defines how QuickBooks Online behaves for a specific business.

The source manual emphasizes that settings should be configured based on the best fit for the business and its operational requirements. These choices can affect:

- transaction-entry behavior;
- invoice and sales workflows;
- purchasing and expense workflows;
- time tracking;
- reporting;
- account numbering;
- tax and currency behavior;
- user experience across the company file.

> **Control recommendation:** Configuration decisions should be documented before data migration or live transaction entry. Some accounting settings can create long-term effects or may be difficult to reverse.

---

## 2. Open Account and Settings

The 2022 manual shows company configuration under the **Gear icon** in the upper-right area of QuickBooks Online.

Historical navigation path:

```text
Gear icon > Your Company > Account and Settings
```

### Steps

1. Sign in to the correct QuickBooks Online company file.
2. Confirm the company or business name shown in the interface.
3. Select the **Gear icon** in the upper-right corner.
4. Locate the **Your Company** section.
5. Select **Account and Settings**.
6. Review the configuration categories listed on the left side of the page.

> **Security note:** Access to company-level settings should be restricted to authorized administrators because changes may affect all users and accounting workflows.

---

## 3. Main Configuration Categories

The source manual identifies the following categories in **Account and Settings**.

| Category | General purpose |
|---|---|
| Company | Business identity and company information |
| Billing & Subscription | Subscription and billing information |
| Sales | Customer-facing sales and invoicing preferences |
| Expenses | Supplier, purchase, bill, and expense preferences |
| Time | Time-tracking preferences |
| Advanced | Additional accounting and operational configuration |

The exact fields available within each category depend on the product version, region, subscription, and enabled features.

---

## 4. Company Settings

The **Company** category generally contains identifying information about the business.

Typical fields may include:

- company name;
- legal name;
- business number or tax identifier;
- company type;
- industry;
- contact information;
- company email;
- customer-facing email;
- telephone number;
- website;
- business address;
- customer-facing address.

### Recommended Review

Before live use, verify that:

- the legal business name is correct;
- customer-facing information matches official documents;
- email addresses are monitored;
- the business address is appropriate for invoices and statements;
- tax identifiers are reviewed by the accounting team;
- the company file belongs to the correct legal entity.

> **Multi-entity warning:** Do not combine separate legal entities in one company file unless the accounting design and reporting requirements explicitly allow it.

---

## 5. Billing and Subscription

The **Billing & Subscription** category is used to review subscription-related information.

Depending on the product and region, this area may show:

- current subscription plan;
- billing frequency;
- payment method;
- subscription status;
- included features;
- user limits;
- payroll or add-on services.

### Governance Recommendations

- Assign a responsible subscription owner.
- Use a company-controlled billing email.
- Document renewal dates and recurring charges.
- Review whether the plan supports required users and features.
- Avoid using a former employee's personal card or email.
- Record any dependencies on paid add-ons.

> **Time-sensitive information:** Pricing, user limits, and plan features in the July 2022 manual should not be treated as current commercial information.

---

## 6. Sales Preferences

The **Sales** category controls how sales transactions are created and presented.

Potential settings may include:

- preferred invoice terms;
- custom transaction fields;
- product and service columns;
- quantity and rate fields;
- discounts;
- customer messages;
- progress invoicing;
- invoice reminders;
- online delivery or payment settings;
- default email content.

### Internal-System Design Questions

When benchmarking an internal accounting system, define:

- whether quotes can convert to invoices;
- whether partial or milestone invoicing is required;
- how discounts are approved;
- which invoice fields are mandatory;
- whether invoice numbers are automatic or controlled;
- how customer-facing templates are governed;
- how sales transactions connect to production orders or shipments.

---

## 7. Expense Preferences

The **Expenses** category controls purchasing and supplier-related behavior.

Potential areas include:

- bills and billable expenses;
- purchase orders;
- supplier settings;
- default payment terms;
- item or category details;
- customer rebilling;
- markup settings;
- purchase approvals where supported.

### Recommended Controls

- Separate purchase entry from payment approval where possible.
- Require supplier identification for material expenses.
- Attach supporting documents to transactions.
- Define when an expense, bill, purchase order, or supplier credit should be used.
- Restrict direct edits after reconciliation or period close.

---

## 8. Time Preferences

The **Time** category is used for time-tracking configuration where supported.

Possible uses include:

- employee or contractor time entry;
- billable time;
- customer or project allocation;
- timesheet workflows;
- linking time to payroll or invoicing.

### Workflow Questions

- Who may enter time?
- Who approves time?
- Can time be edited after approval?
- Is time linked to a customer, project, order, or production stage?
- Does approved time affect payroll, job costing, invoicing, or all three?

---

## 9. Advanced Settings

The **Advanced** category may contain accounting and system-level options.

Depending on the product version, settings can include:

- accounting method;
- financial-year settings;
- closing the books;
- account numbers;
- classes;
- locations;
- multi-currency;
- date and number formats;
- automation preferences;
- default accounts.

> **High-risk configuration:** Changes to the accounting method, financial year, home currency, tax settings, or opening-balance structure should be reviewed by a qualified accountant before implementation.

---

## 10. Save and Complete Changes

The source manual instructs users to save each configuration area and then finish the setup.

Historical workflow:

1. Select a category from the left side.
2. Open the setting that needs to be changed.
3. Enter or update the required information.
4. Select **Save** for that section.
5. Continue reviewing the remaining categories.
6. Select **Done** in the lower-right area after completing the review.

### Verification After Saving

After configuration changes:

- reopen the settings to confirm the saved value;
- create a test transaction where appropriate;
- verify that new fields or options appear as expected;
- review the audit log if configuration changes are recorded;
- document the approved configuration baseline.

---

## 11. Recommended Setup Sequence

A controlled implementation should use an ordered setup process.

```text
Confirm legal entity
  -> Confirm subscription and user requirements
  -> Enter company identity and contact information
  -> Configure accounting period and financial year
  -> Configure tax requirements
  -> Review Chart of Accounts
  -> Configure sales workflows
  -> Configure purchasing and expense workflows
  -> Configure time, class, location, and currency options
  -> Set permissions
  -> Import opening data
  -> Test transactions and reports
  -> Approve the configuration baseline
```

> The source manual introduces GST setup immediately after Account and Settings. GST is covered separately in `04_GST_Setup.md` because tax setup has permanent and compliance-sensitive implications.

---

## 12. Configuration Register

For an internal implementation, maintain a configuration register rather than relying only on the values visible in the application.

| Field | Example documentation requirement |
|---|---|
| Setting name | Exact setting or preference |
| Category | Company, Sales, Expenses, Time, Advanced, or another area |
| Approved value | Final selected value |
| Business reason | Why the value was selected |
| Owner | Person responsible for approval |
| Effective date | Date the configuration becomes active |
| Evidence | Screenshot, ticket, meeting note, or approval record |
| Change history | Previous value and reason for change |

### Why a Register Matters

A configuration register helps with:

- implementation review;
- troubleshooting;
- user training;
- audit preparation;
- migration between systems;
- regression testing after product updates;
- separating approved design from accidental changes.

---

## 13. Internal-System Implementation Checklist

When using QuickBooks company setup as a benchmark, confirm that the internal system provides:

- [ ] a clearly identified legal entity or company context;
- [ ] controlled access to system settings;
- [ ] separate configuration sections for company, sales, expenses, time, and accounting;
- [ ] field-level validation;
- [ ] save and cancel behavior that is clear to users;
- [ ] audit history for configuration changes;
- [ ] effective dates for accounting-sensitive settings where needed;
- [ ] a documented approval process;
- [ ] test-environment validation before production changes;
- [ ] exportable configuration documentation;
- [ ] protections against changing irreversible settings without warning;
- [ ] clear ownership of billing, subscription, and administrative access.

---

## 14. Common Configuration Risks

| Risk | Recommended control |
|---|---|
| Wrong company file | Display company name prominently and confirm before setup |
| Shared administrator account | Use individual administrator accounts |
| Undocumented changes | Record changes in an audit log and configuration register |
| Incorrect financial-year settings | Require accounting approval before activation |
| Incorrect tax setup | Complete tax review before importing transactions |
| Uncontrolled feature activation | Use change approval and test environment |
| Inconsistent invoice settings | Maintain approved templates and required fields |
| Wrong default accounts | Validate with test transactions and reports |
| Subscription owned by an individual | Use company-controlled billing and recovery details |
| Settings changed after go-live | Apply role restrictions and periodic configuration reviews |

---

## Related Topics

- [01 - Getting Started](01_Getting_Started.md)
- [02 - Navigation](02_Navigation.md)
- [04 - GST Setup](04_GST_Setup.md)
- [05 - Audit Log](05_Audit_Log.md)
- [06 - Chart of Accounts](06_Chart_of_Accounts.md)
- [08 - Managing Users](08_Managing_Users.md)
- [09 - Multi-Currency](09_Multi_Currency.md)

## Keywords

`QuickBooks company setup`, `Account and Settings`, `Gear icon`, `Your Company`, `Company`, `Billing and Subscription`, `Sales settings`, `Expense settings`, `Time tracking`, `Advanced settings`, `configuration register`, `accounting configuration`, `company file`, `administrator`, `setup checklist`.

## Source Pages

QuickBooks Online Business User Manual, Version 4, July 2022, pages 18-19.