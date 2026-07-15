# 02 - Navigating QuickBooks Online

## Chapter Scope

This chapter reorganizes Section 4 of the source manual, covering pages 14-17. It explains the historical QuickBooks Online interface used in the July 2022 Australian training guide, including:

- signing in;
- understanding the Home Page;
- opening company settings;
- using Help and Notifications;
- searching transactions;
- viewing recent transactions;
- creating records from the **New/Create** menu;
- collapsing the left navigation menu.

> **Interface note:** QuickBooks Online changes its navigation and labels over time and may show different menus by country, subscription, user role, and product rollout. Use this chapter as a workflow reference rather than a guarantee of the current interface.

---

## 1. Sign In to QuickBooks Online

The source manual recommends Google Chrome for the best experience, while also noting that other supported browsers may work.

### Historical Sign-In Steps

1. Open a supported browser.
2. Open the QuickBooks or Intuit website.
3. Select **Log in** in the upper-right area.
4. Select **QuickBooks Online**.
5. Enter the QuickBooks Online user ID.
6. Enter the password.
7. Select **Sign In**.

> **Security recommendation:** Each employee should use an individual account. Avoid shared credentials because shared access weakens auditability and makes it difficult to determine who created or changed a transaction.

### Recommended Access Controls

- Enable multi-factor authentication when available.
- Use a password manager instead of storing passwords in unsecured notes.
- Review user access periodically.
- Remove access promptly when a user changes role or leaves the company.
- Use separate browser profiles when working with multiple company files.
- Confirm the company name before entering transactions.

---

## 2. Home Page Overview

The QuickBooks Online Home Page presents a summary of key business information. The exact cards and layout depend on the company configuration, subscription, permissions, and current product design.

The 2022 manual shows a Home Page containing areas such as:

- setup guidance;
- shortcuts for common actions;
- bank-account summaries;
- business information and reminders;
- navigation to accounting functions.

### Home Page Purpose

The Home Page is intended to help users:

- identify setup tasks;
- review key balances;
- access common transactions;
- open banking, invoicing, expense, payroll, tax, and reporting functions;
- navigate to company configuration.

> **Design lesson for internal systems:** A financial dashboard should prioritize actionable information, exceptions, overdue items, unreconciled transactions, and tasks requiring approval rather than displaying every available metric with equal emphasis.

---

## 3. Company Settings

The source manual places company configuration under the **Gear icon** in the upper-right corner.

Historical navigation path:

```text
Gear icon > Your Company > Account and Settings
```

Company settings are covered in greater detail in the next chapter.

### Typical Configuration Areas

Depending on the version and market, company settings may include:

- company information;
- billing and subscription;
- sales preferences;
- expense preferences;
- time tracking;
- advanced accounting options;
- account numbering;
- tax settings;
- classes and locations;
- currency settings.

> **Control recommendation:** Changes to accounting configuration should be restricted to authorized users and recorded in the audit log.

---

## 4. Help and Notifications

### Help

The 2022 interface places **Help** behind a question-mark icon near the top-right area of the application.

Help may provide:

- product guidance;
- setup instructions;
- support articles;
- access to assistance options;
- contextual information for the current screen.

### Notifications

The manual identifies a bell icon for notifications.

Notifications may be used to surface:

- system messages;
- product updates;
- workflow alerts;
- account or subscription information;
- tasks requiring attention.

> **Operational recommendation:** Do not rely on in-product notifications as the only control for critical events. Important accounting exceptions should also appear in reports, dashboards, approval queues, or scheduled reviews.

---

## 5. Search

The **Search** function helps users locate previously recorded QuickBooks transactions.

The manual states that users can search using information such as:

- transaction number;
- date;
- amount.

The historical interface also provides an **Advanced Search** option with additional filters.

### Recommended Search Fields for an Internal Accounting System

A comparable internal system should support searching by:

- transaction ID;
- invoice number;
- purchase-order number;
- payment reference;
- bank reference;
- date or date range;
- amount or amount range;
- customer;
- supplier;
- account;
- transaction type;
- status;
- creator or approver;
- production order or batch reference.

### Search-Control Requirements

- Search results should respect user permissions.
- Sensitive payroll or personal information should not appear to unauthorized users.
- Search should distinguish active, voided, deleted, and reversed records.
- A user should be able to open the full transaction and its audit history from the result.

---

## 6. Recent Transactions

The **Recent Transactions** function displays a list of recently recorded transactions.

According to the manual, a user can select a transaction from the recent list to open it.

### Benefits

- faster return to recently edited work;
- easier review after data entry;
- reduced need to repeat searches;
- convenient navigation during reconciliation or correction.

### Risks and Controls

Recent-item lists should not expose records outside the user's permission scope. They should also clearly show:

- transaction type;
- reference number;
- date;
- customer or supplier;
- amount;
- status;
- last modification time where useful.

---

## 7. The New/Create Menu

The source manual describes a **Create** or **New** button near the top of the left navigation bar. Selecting it opens shortcuts for creating transactions and records.

The 2022 screenshot groups actions into categories similar to the following.

| Category | Example actions shown in the historical interface |
|---|---|
| Customers | Invoice, receive payment, quote, sales receipt, refund receipt, delayed credit, delayed charge |
| Suppliers | Expense, cheque, bill, pay bills, purchase order, supplier credit, credit-card credit |
| Employees | Pay run, single time activity, weekly timesheet |
| Other | Bank deposit, transfer, journal entry, statement, inventory quantity adjustment, pay-down credit card |

> **Availability note:** Some actions require a particular QuickBooks subscription, payroll service, regional product, or configuration setting.

### Show Less

The manual shows a **Show less** option in the lower-right corner of the create window. It changes the menu to a simplified view.

### Transaction-Creation Design Principles

When building a similar menu for an internal system:

- group actions by business process;
- show the most-used actions first;
- hide or disable actions the user cannot perform;
- avoid duplicate labels for the same workflow;
- distinguish sales, purchasing, banking, payroll, inventory, and journal functions;
- prevent direct journal entry by users who do not have accounting authority;
- preserve a clear path from source document to accounting transaction.

---

## 8. Left Navigation Menu

The left navigation menu provides access to the main QuickBooks Online work areas. The exact labels and order may vary.

The historical screenshots in the manual show areas such as:

| Navigation area | General purpose |
|---|---|
| Dashboard | Business overview and key information |
| Transactions / Banking | Bank feeds, transaction review, rules, tags, and receipts |
| Invoicing / Sales | Invoices, sales records, customers, products, and services |
| Cash flow | Cash-flow overview and planning |
| Expenses | Purchase transactions and supplier records |
| Employees / Payroll | Employee and payroll workflows |
| Reports | Financial and management reports |
| GST / Taxes | GST Centre and tax workflows |
| Mileage | Business-mileage tracking where available |
| Accounting | Chart of Accounts, registers, and reconciliation tools |
| My accountant | Accountant collaboration and document exchange |
| Apps | Connected applications and integrations |

> **Terminology note:** Newer QuickBooks interfaces may use different menu names such as **Transactions**, **Sales**, **Expenses**, or **Business overview**.

---

## 9. Hamburger Menu and Screen Space

The manual shows a **Hamburger icon** represented by three horizontal lines next to the business name.

Selecting this icon collapses or expands the left navigation menu.

### Why This Matters

Collapsing the navigation provides more horizontal space for:

- long transaction tables;
- invoices with many columns;
- reconciliation screens;
- reports;
- smaller laptop displays.

### UI/UX Recommendation for Financial Web Apps

A collapsible menu should:

- preserve recognizable icons when collapsed;
- show tooltips for icons;
- remember the user's preference where appropriate;
- avoid hiding critical workflow status;
- remain keyboard accessible;
- support responsive layouts;
- not reduce table readability.

---

## 10. Navigation Workflow Summary

```text
Sign in
  -> Confirm the correct company file
  -> Review the Home Page
  -> Use the left navigation for a functional area
  -> Use New/Create to add a transaction
  -> Use Search or Recent Transactions to reopen work
  -> Use the Gear icon for authorized configuration
  -> Use Help and Notifications when required
```

---

## 11. Internal-System Implementation Checklist

When using QuickBooks navigation as a benchmark for an internal accounting application, confirm that the system provides:

- [ ] clear company or entity identification;
- [ ] role-based menus;
- [ ] global search;
- [ ] advanced filters;
- [ ] recently viewed transactions;
- [ ] a consistent create-action menu;
- [ ] collapsible navigation;
- [ ] visible help and notifications;
- [ ] auditability for configuration changes;
- [ ] permission-aware search results;
- [ ] responsive tables and sticky headers;
- [ ] direct links from records to their source documents and audit history.

---

## Related Topics

- [01 - Getting Started](01_Getting_Started.md)
- [03 - Company Setup](03_Company_Setup.md)
- [05 - Audit Log](05_Audit_Log.md)
- [12 - Banking Centre](12_Banking_Centre.md)
- [13 - Quotes and Invoices](13_Quotes_and_Invoices.md)

## Keywords

`QuickBooks navigation`, `Home Page`, `dashboard`, `Gear icon`, `Account and Settings`, `Help`, `Notifications`, `Search`, `Advanced Search`, `Recent Transactions`, `New`, `Create`, `Show less`, `hamburger menu`, `left navigation`, `transaction menu`, `role-based navigation`.

## Source Pages

QuickBooks Online Business User Manual, Version 4, July 2022, pages 14-17.