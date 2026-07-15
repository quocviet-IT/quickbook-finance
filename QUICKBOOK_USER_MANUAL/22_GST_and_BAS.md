# 22. GST and BAS Management

> Source scope: *QuickBooks Online Business User Manual*, Version 4 - July 2022, pages 107-116.

## Purpose

This chapter explains the documented QuickBooks Online workflow for managing GST, reviewing Business Activity Statement figures, preparing and lodging BAS, recording BAS payments, handling amendments to previously lodged periods, and preparing monthly Instalment Activity Statements.

It also translates the documented workflow into control, database, approval, reconciliation, and audit requirements for an internal accounting system.

> **Important**
>
> This chapter reflects the Australian QuickBooks workflow documented in July 2022. GST, BAS, IAS, PAYG, ATO connectivity, electronic lodgement, tax codes, reporting fields, due dates, and journal behavior are country-specific and may have changed. Treat this as a historical workflow reference, not as current tax or legal advice.

---

## 1. GST Centre Overview

The GST Centre consolidates GST-related transactions and reporting information in one location.

The source manual states that it can provide:

- GST collected;
- GST paid;
- estimated amount owed to or refundable by the ATO;
- access to GST and PAYG reports;
- BAS preparation;
- BAS lodgement workflow;
- GST amendment tracking;
- BAS and IAS history;
- payment recording.

A controlled system should separate these activities into clear stages:

```text
Record Transactions
        ↓
Validate Tax Codes
        ↓
Reconcile Control Accounts
        ↓
Review GST and PAYG Reports
        ↓
Prepare BAS or IAS
        ↓
Review and Approve
        ↓
Submit or Mark as Lodged
        ↓
Post Tax Journal
        ↓
Record and Match Payment
        ↓
Lock Period and Archive Evidence
```

---

## 2. Connect to the ATO

The source describes a **Connect the ATO** action that allows an eligible QuickBooks company file to connect and lodge directly.

Documented workflow:

```text
GST Centre > Connect the ATO
```

Then select the preferred connection method and follow the prompts.

### Recommended connection controls

Store:

- legal entity;
- tax registration identifier;
- connection status;
- connection method;
- authorized user;
- authorization date;
- authorization expiry;
- last successful communication;
- last failed communication;
- error message;
- consent and security evidence.

> **Security requirement**
>
> Government-portal credentials, tokens, and authorization secrets must not be stored in plain text or shared between employees.

---

## 3. Review Reports Before Preparing BAS

Navigate to:

```text
GST Centre > Run Reports
```

The source manual identifies reports that should be reviewed before BAS preparation, including:

- GST reports;
- GST Amendments Report;
- PAYG reports;
- Transactions with GST;
- Transactions by Tax Code;
- Profit and Loss;
- Balance Sheet;
- related tax control accounts.

### Recommended review objective

The reviewer should verify that transaction-level tax data agrees with the General Ledger and the proposed activity statement.

---

## 4. Tax Review Checklist

Before preparing the BAS:

- [ ] All bank accounts are reconciled.
- [ ] Sales transactions are complete.
- [ ] Purchase transactions are complete.
- [ ] Tax codes have been reviewed.
- [ ] Transactions without a tax code are resolved.
- [ ] GST collected agrees with sales records.
- [ ] GST paid agrees with purchase records.
- [ ] GST control accounts reconcile to the ledger.
- [ ] PAYG withholding agrees with payroll reports.
- [ ] PAYG instalment information is reviewed.
- [ ] GST amendments are reviewed.
- [ ] Duplicate transactions are removed.
- [ ] Foreign-currency transactions use approved rates.
- [ ] Supporting evidence is retained.
- [ ] Reviewer sign-off is recorded.

---

## 5. First-Time BAS Setup

The first BAS preparation in the documented workflow begins with:

```text
GST Centre > Get Started
```

The user selects the first period to be lodged from QuickBooks by entering:

- beginning date;
- ending date.

Then select:

```text
Continue
```

The source notes that this initial period selection is performed only the first time BAS lodgement is configured. Later periods use **Prepare BAS**.

### Critical control

The initial lodgement period must be checked carefully because it establishes the starting point for tax-period management.

---

## 6. Confirm GST

The documented workflow presents a GST confirmation step.

Users can review whether:

- GST codes are correct;
- transactions have missing GST codes;
- GST on sales is reasonable;
- GST on purchases is reasonable;
- the GST due amount is supported by reports.

### Recommended validation rules

1. Every taxable transaction must have an approved tax code.
2. Tax code must be valid on the transaction date.
3. Tax rate must match the tax code and effective date.
4. Tax amount must reconcile to net and gross values.
5. Transfers and balance-sheet movements must not receive inappropriate tax.
6. Submitted-period changes must enter an amendment workflow.

---

## 7. PAYG Withholding Review

The source states that PAYG Withholding appears as the next step where configured.

The amount can be checked against:

- Detailed Activity Report from Payroll Centre Reports;
- PAYG Withholding Summary under Run Reports.

### Reconciliation

```text
PAYG Withholding from Payroll
= PAYG Withholding Liability in General Ledger
= PAYG Amount Included in BAS or IAS
```

Differences must be investigated before submission.

---

## 8. PAYG Instalment Review

When PAYG instalments are enabled in GST settings, the documented workflow displays a PAYGI step.

The user should:

1. verify the PAYGI amount;
2. enter or confirm the required value;
3. select **Next**.

### Recommended controls

- store the calculation method;
- record whether the amount was system-derived or manually entered;
- require a reason for override;
- retain supporting tax notices;
- require approval for material changes.

---

## 9. BAS Summary

A BAS summary appears before completion.

The source manual states that users can:

- review the summary;
- revise values where permitted;
- print the summary.

The summary may show:

- amount owed to the ATO;
- amount refundable by the ATO;
- payment amount;
- GST components;
- PAYG components;
- adjustments.

### Final review checklist

- [ ] Reporting period is correct.
- [ ] Legal entity is correct.
- [ ] GST amounts agree with reviewed reports.
- [ ] PAYG withholding agrees with payroll.
- [ ] PAYGI is correct.
- [ ] Amendments are understood.
- [ ] Net payable or refundable amount is correct.
- [ ] Approver has reviewed the summary.
- [ ] Submission evidence is ready to be retained.

---

## 10. Lodge or Mark BAS as Lodged

The documented workflow includes:

```text
Mark as Lodged
```

and, where the ATO connection is available, direct lodgement.

> **Current-product caution**
>
> Direct electronic lodgement availability must be verified against current official QuickBooks and ATO documentation before implementation or operational use.

### Recommended status model

```text
Draft
    ↓
Prepared
    ↓
Under Review
    ↓
Approved
    ↓
Submitted
    ↓
Accepted
    ↓
Payment Due or Refund Due
    ↓
Paid or Refunded
    ↓
Closed
```

Exception statuses:

```text
Rejected
Amendment Required
Submission Failed
Payment Overdue
Cancelled
```

---

## 11. Automatic BAS Journal

The source states that **Mark as Lodged** automatically produces a BAS journal.

The journal closes relevant control-account balances for the period and transfers the payable or refund balance to an **ATO Clearing account**.

Conceptual example:

```text
Debit GST Collected or Tax Liability Control
Credit GST Paid or Tax Credit Control
Debit or Credit PAYG-related Control Accounts
Debit or Credit ATO Clearing
```

The exact journal depends on the tax position and accounting configuration.

### Journal controls

- journal must balance;
- journal must link to the BAS period;
- source control-account values must be stored;
- duplicate journal generation must be prevented;
- posting date must follow policy;
- journal must retain the tax configuration version;
- reversal or amendment must not overwrite the original journal.

---

## 12. ATO Clearing Account

The ATO Clearing account represents the net payable to or refundable from the tax authority after BAS or IAS lodgement.

### Payment example

When paying the tax authority:

```text
Debit ATO Clearing
Credit Bank
```

### Refund example

When receiving a refund:

```text
Debit Bank
Credit ATO Clearing
```

### Reconciliation rule

```text
ATO Clearing Closing Balance
= Lodged Amounts
- Payments Made
- Refunds Received
+ Approved Adjustments
```

The account should be reconciled after every tax payment or refund.

---

## 13. GST Amendments

The source states that QuickBooks can track changes made to transactions from previously lodged BAS periods.

These changes appear in the **GST Amendments Report** and are included as adjustments in a later BAS period.

Documented concept:

```text
Change to Previously Lodged Transaction
        ↓
Confirmation Warning
        ↓
GST Amendment Recorded
        ↓
Adjustment Included in Next BAS
```

### Important control principle

A lodged period should not be silently rewritten. Prior-period corrections should create explicit adjustment records that preserve:

- original transaction;
- original tax amount;
- amended transaction;
- amended tax amount;
- difference;
- affected lodged period;
- adjustment period;
- reason;
- user;
- approval.

---

## 14. GST Amendments Report

The GST Amendments Report should show transactions changed after the related BAS was lodged.

Recommended fields:

| Field | Description |
|---|---|
| Original BAS period | Period already lodged |
| Adjustment BAS period | Period receiving the correction |
| Transaction reference | Source transaction |
| Original tax code | Tax code before change |
| New tax code | Tax code after change |
| Original GST | Original tax amount |
| Revised GST | Updated tax amount |
| Adjustment | Difference included later |
| Change reason | Explanation |
| Changed by | User making the change |
| Approved by | Reviewer or approver |

---

## 15. GST Centre Tabs

The source manual describes three GST Centre tabs:

```text
To do
History
Payments
```

### To do

May contain:

- next BAS to lodge;
- BAS to pay;
- IAS to prepare;
- outstanding tax actions.

### History

Contains completed or lodged periods and their status history.

### Payments

Contains recorded tax payments or refunds.

---

## 16. Record BAS Payment

After lodgement, the BAS moves to a payment-related section.

The source workflow uses:

```text
Record Payment
```

The user records:

- payment amount;
- bank account;
- payment date.

After recording, the payment should be available in the Payments tab and should match the related bank-feed transaction when the amount, bank account, and date agree.

---

## 17. Bank Matching for Tax Payments

Recommended matching conditions:

- exact or tolerated amount match;
- correct bank account;
- compatible payment date;
- tax-period reference;
- authority payment reference;
- same currency;
- payment is not already matched.

### Control

The Banking Centre should match the imported bank transaction to the existing tax payment rather than creating a duplicate expense.

---

## 18. Instalment Activity Statement

The source describes IAS processing when PAYG Withholding is lodged monthly.

Workflow:

```text
GST Centre > To do > Prepare IAS
```

Then:

1. review the populated PAYG withholding amount;
2. reconcile it to payroll and PAYG reports;
3. select **Next**;
4. mark the IAS as lodged when correct.

The source states that the IAS process closes the period and creates an automatic journal that debits the PAYG withholding account and credits the ATO Clearing account.

---

## 19. IAS Controls

- IAS frequency must agree with tax settings.
- PAYG amount must reconcile to payroll.
- The period must be complete.
- Required payroll amendments must be processed first.
- Submission or lodgement evidence must be retained.
- Journal must balance.
- Closed IAS periods must not be edited silently.
- Payment must reconcile through the ATO Clearing account.

---

## 20. Tax Period Locking

After a BAS or IAS is lodged, the period should be protected.

Recommended behavior:

- ordinary users cannot edit tax-impacting transactions in the period;
- authorized corrections create amendments;
- period reopening requires approval;
- all attempts are logged;
- amendment impact is shown before confirmation;
- source and adjustment periods remain linked.

### Statuses

```text
Open
Under Review
Approved
Lodged
Payment Due
Paid
Locked
Amended
```

---

## 21. Approval Workflow

Recommended segregation:

| Activity | Role |
|---|---|
| Enter transactions | Accounting staff |
| Review tax coding | Senior accountant |
| Reconcile GST controls | Accountant/controller |
| Prepare BAS/IAS | Authorized preparer |
| Approve BAS/IAS | Finance manager or authorized agent |
| Submit or mark lodged | Authorized declarer |
| Release payment | Banking approver |
| Reconcile clearing account | Independent reviewer |

A single user should not control transaction entry, BAS preparation, submission, payment release, and final reconciliation for a material tax period.

---

## 22. Tax Exception Queue

Recommended exception categories:

```text
Missing Tax Code
Invalid Tax Code
Unexpected Tax Rate
Tax Amount Mismatch
Prior-Period Change
Unreconciled Control Account
Missing Payroll Reconciliation
Duplicate Adjustment
Submission Error
Unmatched Tax Payment
```

Each exception should store:

- entity;
- tax period;
- source transaction;
- severity;
- assigned user;
- due date;
- resolution;
- reviewer;
- closure timestamp.

---

## 23. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Incorrect reporting period | BAS starts or ends on the wrong date | Initial-period approval |
| Missing tax code | Purchase omitted from GST calculation | Missing-code report |
| Wrong tax treatment | Transfer coded as taxable expense | Transaction-type validation |
| Unreconciled GST | BAS differs from ledger | Mandatory control-account reconciliation |
| PAYG mismatch | Payroll and BAS amounts differ | Payroll-to-tax reconciliation |
| Silent prior-period edit | Lodged transaction is overwritten | Amendment workflow and period lock |
| Duplicate BAS journal | Mark-as-lodged process runs twice | Unique period journal constraint |
| Duplicate payment | Bank feed creates another tax expense | Match existing ATO payment |
| Unauthorized submission | User lodges without authority | Role-based permission and MFA |
| Clearing account imbalance | Payment posted to wrong account | ATO Clearing reconciliation |
| Missing evidence | No BAS summary or receipt retained | Required attachment and archive controls |
| Submission failure | BAS status remains unclear | Submission response tracking |

---

## 24. Recommended Database Design

### `tax_periods`

```text
id
entity_id
tax_type
period_start
period_end
status
filing_frequency
accounting_method
prepared_by
reviewed_by
approved_by
submitted_at
accepted_at
locked_at
created_at
updated_at
```

### `tax_returns`

```text
id
tax_period_id
return_type
version
status
gst_collected
gst_paid
payg_withholding
payg_instalment
adjustment_amount
net_payable
net_refundable
submission_reference
journal_entry_id
created_at
updated_at
```

### `tax_return_lines`

```text
id
tax_return_id
field_code
description
source_amount
adjustment_amount
final_amount
validation_status
```

### `tax_amendments`

```text
id
source_transaction_id
original_tax_period_id
adjustment_tax_period_id
original_tax_code_id
new_tax_code_id
original_tax_amount
revised_tax_amount
adjustment_amount
reason
changed_by
approved_by
created_at
```

### `tax_payments`

```text
id
tax_return_id
payment_date
amount
bank_account_id
payment_reference
status
bank_transaction_id
created_by
approved_by
created_at
```

### Supporting tables

```text
tax_connections
tax_submission_attempts
tax_control_reconciliations
tax_validation_exceptions
tax_return_approvals
tax_journal_mappings
tax_documents
tax_audit_history
```

---

## 25. Recommended Constraints

1. Entity, tax type, start date, and end date must uniquely identify a tax period.
2. Period start date must be before or equal to period end date.
3. A submitted version must be immutable.
4. Amendment records must reference an original and adjustment period.
5. Tax return lines must reconcile to the return total.
6. BAS or IAS journal must balance.
7. One active lodgement journal is allowed per return version.
8. Payment cannot exceed the open tax liability without approval.
9. ATO Clearing entries must link to a return or payment.
10. Locked periods cannot receive direct tax-impacting edits.
11. Submission attempts and responses must be retained.
12. Tax-return version numbers must be unique within the period.

---

## 26. Suggested Reconciliation Model

```text
GST Collected Control
- GST Paid Control
+ PAYG Withholding
+ PAYG Instalment
+ Prior-Period Adjustments
= Net BAS Payable or Refundable
```

After lodgement:

```text
Net BAS Payable or Refundable
= Movement to ATO Clearing
```

After payment or refund:

```text
ATO Clearing
= Zero for the settled return
```

Any remaining amount should be explained by:

- partial payment;
- refund pending;
- amendment;
- interest or penalty;
- payment timing;
- posting error.

---

## 27. Suggested Workflow

```text
Open Tax Period
        ↓
Complete Bookkeeping
        ↓
Reconcile Banks and Control Accounts
        ↓
Run GST, PAYG, Tax-Code, P&L, and Balance-Sheet Reports
        ↓
Resolve Exceptions
        ↓
Prepare BAS or IAS
        ↓
Review Summary
        ↓
Approve
        ↓
Submit or Mark as Lodged
        ↓
Generate Tax Journal
        ↓
Lock Period
        ↓
Record Payment or Refund
        ↓
Match Bank Transaction
        ↓
Reconcile ATO Clearing
        ↓
Archive Evidence
```

---

## 28. AI Implementation Prompt

```text
Implement a GST, BAS, and IAS management module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Support configurable tax periods, GST methods, BAS frequencies, PAYG withholding, and PAYG instalments.
- Provide GST Centre tabs for To Do, History, and Payments.
- Generate reports for GST, GST amendments, PAYG, transactions with tax, transactions by tax code, and control-account reconciliation.
- Detect transactions with missing or invalid tax codes.
- Support first-time BAS period setup and recurring Prepare BAS workflows.
- Support BAS and IAS preparation, review, approval, submission status, and evidence retention.
- Use an adapter architecture for government-authority integration; do not hard-code a specific live submission provider.
- Generate balanced BAS and IAS journals that transfer liabilities or refunds to a configurable tax-authority clearing account.
- Prevent duplicate return journals.
- Support tax-payment and refund recording with Banking Centre matching.
- Lock lodged periods and route later transaction changes into an amendment workflow.
- Maintain a GST Amendments Report linking original and adjustment periods.
- Support immutable return versions and submission-attempt history.
- Implement role-based permissions, MFA for declarers, approval workflow, and segregation of duties.
- Provide tax exception queues, search, filters, exports, printable summaries, and audit history.
- Include unit and integration tests for tax calculations, period setup, amendments, journal balancing, duplicate prevention, payment matching, permissions, and period locking.
```

---

## 29. Internal System Checklist

- [ ] Tax registration and accounting method are configured.
- [ ] BAS and IAS frequencies are correct.
- [ ] Initial tax period is approved.
- [ ] Banks are reconciled before preparation.
- [ ] GST control accounts reconcile.
- [ ] PAYG agrees with payroll reports.
- [ ] Missing and invalid tax codes are resolved.
- [ ] GST Amendments Report is reviewed.
- [ ] BAS or IAS summary is approved.
- [ ] Submission status and receipt are retained.
- [ ] Tax journal balances and is not duplicated.
- [ ] Lodged periods are locked.
- [ ] Prior-period changes create amendments.
- [ ] ATO Clearing reconciles to payments and refunds.
- [ ] Bank-feed payments match existing tax payments.
- [ ] Submission, payment, and approval access is separated.
- [ ] Tax records and documents follow retention requirements.

---

## Related Topics

- [04. GST Setup](04_GST_Setup.md)
- [05. Audit Log](05_Audit_Log.md)
- [06. Chart of Accounts](06_Chart_of_Accounts.md)
- [12. Banking Centre](12_Banking_Centre.md)
- [19. Payroll](19_Payroll.md)
- [21. Bank Reconciliation](21_Bank_Reconciliation.md)
- Reports Centre
- Accounting Period Close
- Tax Payments and Refunds

---

## Keywords

GST Centre, GST, BAS, IAS, PAYG withholding, PAYG instalment, ATO, BAS lodgement, GST Amendments Report, ATO Clearing, tax control account, tax period, tax journal, tax payment, tax reconciliation