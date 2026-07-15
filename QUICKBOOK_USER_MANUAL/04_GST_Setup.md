# 04. GST Setup

> **Source scope:** QuickBooks Online Business User Manual, Version 4 - July 2022, pages 20-25.

## Purpose

This chapter explains how to configure the GST Centre in QuickBooks Online, review GST settings, and use the GST and BAS reports before lodging a Business Activity Statement.

> **Important**
>
> This workflow is based on the Australian edition of QuickBooks Online documented in July 2022. It is useful as a process and system-design reference. It is not current tax, legal, or Vietnam-compliance guidance.

---

## 1. Why GST Setup Matters

Australian businesses may need to lodge:

- Business Activity Statements (BAS)
- Instalment Activity Statements (IAS)
- Pay As You Go Withholding (PAYG Withholding)
- Pay As You Go Instalments (PAYGI)

Correct GST configuration is important because some settings affect the whole company file and may be difficult or impossible to change later.

### Core controls

1. Confirm whether the business is registered for GST.
2. Configure GST before importing or entering accounting data.
3. Validate the GST period start date.
4. Confirm the reporting frequency for GST, PAYG Withholding, and PAYGI.
5. Record who reviewed and approved the setup.

> **Warning**
>
> The source manual states that the GST period start date cannot be changed after setup. Verify the date carefully before saving.

---

## 2. When GST Should Not Be Enabled

Do not activate the GST feature when the business is not registered for GST.

Unnecessary activation may:

- create incorrect tax liabilities;
- add tax codes to transactions;
- affect reports;
- complicate later corrections;
- create permanent company-file configuration changes.

---

## 3. Open the GST Centre

From the left navigation menu, use:

```text
GST > Get Started
```

The first-time setup opens the BAS configuration screen.

---

## 4. Configure the GST Centre

### Step 1 - Select GST

Choose **GST** from the left navigation menu.

### Step 2 - Start setup

Select **Get Started**.

### Step 3 - Select reporting frequencies

Configure the correct frequency for:

- BAS and GST;
- PAYG Withholding;
- PAYG Instalments.

When additional tax types are required, select **Show other taxes** and enable the relevant options.

Examples shown in the source manual include:

- Fringe Benefits;
- Fuel Tax Credits;
- Wine Equalisation;
- Luxury Car Tax.

### Step 4 - Save configuration

Select **Save and Finish**.

### Step 5 - Complete setup

Select **Done**.

---

## 5. Recommended Configuration Record

Maintain an external configuration register so the setup can be reviewed and audited.

| Configuration item | Example value | Approved by | Effective date |
|---|---|---|---|
| GST registration status | Registered | Finance Manager | YYYY-MM-DD |
| GST accounting method | Cash or Accrual | Accountant | YYYY-MM-DD |
| GST lodging frequency | Monthly, Quarterly, or Annual | Accountant | YYYY-MM-DD |
| PAYG Withholding frequency | Monthly or Quarterly | Accountant | YYYY-MM-DD |
| PAYGI frequency | Monthly or Quarterly | Accountant | YYYY-MM-DD |
| GST period start date | YYYY-MM-DD | Accountant | YYYY-MM-DD |
| Other taxes enabled | Description or None | Accountant | YYYY-MM-DD |

This record improves:

- auditability;
- implementation review;
- troubleshooting;
- change management;
- migration planning.

---

## 6. Change GST Settings

The GST Centre provides an **Edit Settings** or **Settings** option near the top-right area.

Depending on the company file, available changes may include:

- GST lodging frequency;
- PAYG Withholding frequency;
- PAYGI frequency;
- additional tax types;
- GST accounting method.

### Examples in the manual

- Change GST frequency to monthly.
- Change PAYGI frequency to monthly.
- Change the GST method from cash to accrual.

Select **Save** after completing the change.

> **Warning**
>
> QuickBooks may display a warning when a setting change will create automatic adjustments. Review the impact before confirming the change.

---

## 7. Cash Method vs Accrual Method

| Method | General concept |
|---|---|
| Cash method | GST is generally recognized when payment is received or made. |
| Accrual method | GST is generally recognized when the invoice or bill is recorded. |

The appropriate method depends on the business registration and accounting requirements.

> **Control requirement**
>
> Ordinary users should not be allowed to change the GST method. The system should record the previous value, new value, user, date, reason, and resulting adjustment.

---

## 8. GST Centre Summary

After setup, the GST Centre may display:

- GST Due;
- GST Collected;
- GST Paid;
- the current reporting period;
- settings access;
- GST and BAS reports.

The source manual notes that the figures shown relate to the current period displayed in the GST Centre. They may not represent an earlier BAS period that has not yet been lodged.

---

## 9. GST and BAS Reports

Before lodging a BAS, review the available GST and BAS reports.

The source screen shows reports such as:

- GST Summary;
- GST Details;
- GST Amendments;
- PAYG Withholding Summary;
- GST Liability;
- Transactions without GST;
- Transactions by Tax Code;
- Profit and Loss;
- Balance Sheet.

### Review objectives

- Verify GST collected.
- Verify GST paid.
- Identify incorrect or missing tax codes.
- Check transactions changed after an earlier BAS.
- Reconcile tax balances to general-ledger accounts.
- Confirm the correct reporting period.

### GST Amendments Report

The GST Amendments Report identifies GST transactions changed after the previous BAS was lodged.

According to the manual:

- amended GST amounts may be added into a later BAS lodgement workflow;
- those amounts may not appear in the GST Summary for the original BAS period;
- the amendments report should therefore be reviewed separately.

---

## 10. Pre-Lodgement Checklist

Before starting BAS lodgement, verify:

- [ ] GST registration settings are correct.
- [ ] The reporting period is correct.
- [ ] The GST accounting method is correct.
- [ ] GST collected agrees with sales records.
- [ ] GST paid agrees with purchases and expenses.
- [ ] Uncategorised transactions have been resolved.
- [ ] Bank-feed transactions have been reviewed.
- [ ] Duplicate transactions have been removed.
- [ ] The GST Amendments Report has been reviewed.
- [ ] Tax control accounts have been reconciled to the general ledger.
- [ ] Supporting documents are attached where required.
- [ ] A reviewer has approved the BAS preparation.

---

## 11. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Incorrect GST start date | Wrong reporting periods | Require review before activation |
| Incorrect accounting method | Tax recognized in the wrong period | Restrict changes to authorized roles |
| Incorrect tax code | A taxable purchase is coded as GST-free | Validation rules and exception reports |
| Unreviewed amendments | Prior-period changes are omitted | Mandatory amendments-report review |
| Duplicate bank transactions | GST is reported twice | Duplicate detection and reconciliation |
| Unauthorized setup change | User changes the tax method or frequency | Role-based access and audit history |
| Missing supporting evidence | Invoice or receipt is unavailable | Attachment rules and exception queue |

---

## 12. Application to an Internal Accounting System

A custom accounting platform should separate tax configuration from normal transaction entry.

### Suggested entities

```text
tax_registrations
tax_periods
tax_codes
tax_configuration_history
tax_returns
tax_return_lines
tax_adjustments
tax_documents
tax_approvals
```

### Suggested workflow

```text
Configure Tax Registration
        |
        v
Approve Configuration
        |
        v
Open Tax Period
        |
        v
Record Transactions
        |
        v
Validate Tax Codes
        |
        v
Run Tax Reports
        |
        v
Review Amendments and Exceptions
        |
        v
Approve Return
        |
        v
Lock Period
        |
        v
Export, Submit, and Archive
```

### Recommended rules

1. Tax configuration changes require elevated permissions.
2. Every configuration change creates an immutable history record.
3. Submitted periods cannot be edited directly.
4. Prior-period corrections create adjustment records.
5. Tax reports must reconcile to general-ledger control accounts.
6. Attachments must remain linked to source transactions.
7. Period close must block unauthorized posting.

---

## 13. AI Implementation Prompt

```text
Implement a tax configuration and reporting module for an accounting web application.

Requirements:
- Support configurable tax registration status.
- Support cash and accrual tax methods.
- Support monthly, quarterly, and annual reporting periods.
- Store an immutable history of configuration changes.
- Restrict configuration changes using role-based permissions.
- Create tax periods with open, review, approved, submitted, and locked statuses.
- Prevent direct edits to submitted or locked periods.
- Handle prior-period corrections as adjustment entries.
- Provide tax collected, tax paid, tax due, and amendment reports.
- Reconcile tax reports to general-ledger control accounts.
- Record reviewer and approver identities with timestamps.
- Use TypeScript, Next.js, Supabase/PostgreSQL, and auditable database constraints.
```

---

## 14. Related Topics

- [03. Company Setup](03_Company_Setup.md)
- Audit Log
- Chart of Accounts
- Banking Centre
- Bank Reconciliation
- GST and BAS Management
- Reports Centre

---

## Keywords

GST, BAS, IAS, PAYG Withholding, PAYGI, cash method, accrual method, GST Centre, GST Amendments Report, tax configuration, tax period, period lock, tax reconciliation, audit history