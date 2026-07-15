# 07. Taxable Payments Annual Report (TPAR)

> Source scope: *QuickBooks Online Business User Manual*, Version 4 — July 2022, pages 32–34.

## Purpose

This chapter explains how QuickBooks Online supports preparation of the Australian **Taxable Payments Annual Report (TPAR)** for reportable contractor payments.

> **Important**
>
> This material reflects the Australian QuickBooks workflow documented in July 2022. It is provided as a product-workflow and system-design reference, not as current tax or legal advice. Reporting industries, deadlines, data fields, and ATO requirements may change.

---

## 1. What TPAR Is

A TPAR reports certain payments a business makes to contractors for services.

The manual identifies examples of industries that may be required to report contractor payments, including:

- building and construction;
- courier services;
- cleaning services.

The report is generally prepared for submission to the Australian Taxation Office (ATO).

> **Control note**
>
> Always verify the latest ATO rules before relying on the industry list, deadline, or reporting fields.

---

## 2. Key Workflow

The documented workflow is:

```text
Enable TPAR in Company Settings
        ↓
Mark Relevant Suppliers
        ↓
Review Supplier Transactions
        ↓
Exclude Non-reportable Transactions
        ↓
Run the TPAR Report
        ↓
Correct Missing or Invalid Supplier Data
        ↓
Download the Electronic TPAR File
        ↓
Submit Through the Approved ATO Channel
```

---

## 3. Enable TPAR Options

Navigate to:

```text
Account and Settings > Expenses > Suppliers
```

Enable the option that displays TPAR settings for suppliers, then save the configuration.

### Recommended implementation control

Only authorized accounting users should be able to enable or disable TPAR reporting.

Record:

- previous setting;
- new setting;
- user;
- date and time;
- reason;
- approver.

---

## 4. Mark a Supplier for TPAR

Navigate to:

```text
Expenses > Suppliers
```

Then:

1. Find the supplier.
2. Open the supplier record.
3. Select **Edit**.
4. Enable **Include this Supplier in my annual TPAR**.
5. Review the supplier information.
6. Save the record.

### Supplier data to verify

The exact fields required may change, but a controlled supplier master should normally include:

| Field | Purpose |
|---|---|
| Supplier legal name | Identifies the contractor |
| Trading name | Business display name |
| ABN | Australian Business Number |
| Address | Reporting and validation |
| Email / phone | Contact information |
| TPAR status | Included or excluded |
| Effective date | When TPAR treatment begins |
| Review status | Pending, verified, exception |
| Reviewer | Person who validated the supplier |

---

## 5. Retrospective Effect

The manual notes that enabling TPAR for a supplier may automatically mark existing transactions in the relevant financial year as TPAR-reportable.

This means the user must review historical transactions after changing the supplier setting.

> **Risk**
>
> Enabling TPAR at supplier level does not guarantee every transaction is reportable.

---

## 6. Exclude a Non-reportable Transaction

A transaction can be excluded from the annual TPAR when it should not be reported.

The documented control is to clear:

```text
Include the transaction in my annual TPAR
```

### Examples of transaction-level review questions

- Does the payment relate to contractor services?
- Is the supplier in a reportable category?
- Is the transaction within the reporting period?
- Is the amount already included elsewhere?
- Is the transaction a reimbursement, goods-only purchase, or another excluded type?
- Is the supplier information complete?

---

## 7. Run the TPAR Report

Navigate to:

```text
Reports
```

Search for:

```text
Taxable Payments Annual Report
```

The first time the report is opened, QuickBooks may ask whether reporting should be prepared on a cash or accrual basis.

### Report output

The report summarizes reportable totals by supplier.

Before downloading the electronic file, review:

- supplier names;
- ABNs;
- addresses;
- total reportable payments;
- reporting period;
- excluded transactions;
- missing or invalid fields.

The manual indicates that invalid supplier details are highlighted and must be corrected before the electronic file can be downloaded.

---

## 8. TPAR Review Checklist

Before generating the final electronic file:

- [ ] TPAR has been enabled in company settings.
- [ ] All potentially reportable suppliers have been reviewed.
- [ ] Supplier ABNs have been validated.
- [ ] Supplier legal names are correct.
- [ ] Addresses are complete.
- [ ] Reportable and non-reportable transactions have been distinguished.
- [ ] Retrospectively selected transactions have been reviewed.
- [ ] Duplicate payments have been checked.
- [ ] Credits and reversals have been reviewed.
- [ ] Cash/accrual basis is correct.
- [ ] Totals reconcile to the general ledger and supplier records.
- [ ] Exceptions have been resolved.
- [ ] A reviewer has approved the report.
- [ ] The exported file has been stored in a controlled location.

---

## 9. Suggested Status Model

```text
Not Reviewed
    ↓
Potentially Reportable
    ↓
Supplier Verified
    ↓
Transactions Reviewed
    ↓
Exception
    ↓
Approved
    ↓
Exported
    ↓
Submitted
```

### Suggested transaction-level statuses

- Included
- Excluded
- Pending Review
- Missing Supplier Data
- Invalid ABN
- Duplicate Suspected
- Adjustment Required

---

## 10. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Missing supplier | Contractor is not marked for TPAR | Annual supplier review |
| Incorrect inclusion | Goods-only transaction is reported | Transaction-level override |
| Incorrect exclusion | Reportable contractor payment is omitted | Exception report |
| Invalid ABN | File rejected or data is incorrect | ABN validation |
| Retrospective over-selection | All supplier transactions are automatically included | Mandatory historical review |
| Duplicate payment | Same payment is reported twice | Duplicate detection |
| Unapproved changes | User changes supplier TPAR status | Role-based access and audit log |
| Weak reconciliation | TPAR total differs from ledger | Reconciliation and sign-off |
| Missing evidence | No supporting invoice or contract | Attachment requirements |

---

## 11. Suggested Database Design

### `suppliers`

```text
id
legal_name
trading_name
abn
address
email
phone
tpar_enabled
tpar_effective_from
verification_status
verified_by
verified_at
created_at
updated_at
```

### `supplier_transactions`

```text
id
supplier_id
transaction_date
transaction_type
reference_number
gross_amount
tax_amount
net_amount
tpar_status
tpar_exclusion_reason
reporting_year
source_document_id
created_by
created_at
updated_at
```

### `tpar_reports`

```text
id
reporting_year
reporting_basis
status
total_suppliers
total_reportable_amount
prepared_by
reviewed_by
approved_by
exported_at
submitted_at
created_at
updated_at
```

### `tpar_report_lines`

```text
id
tpar_report_id
supplier_id
reportable_amount
adjustment_amount
final_amount
validation_status
exception_message
```

### Supporting tables

```text
tpar_supplier_reviews
tpar_transaction_reviews
tpar_exceptions
tpar_exports
tpar_audit_history
```

---

## 12. Recommended Validation Rules

1. A reportable supplier must have a legal name.
2. ABN must pass format validation.
3. Transactions must belong to the selected reporting year.
4. Excluded transactions require a reason.
5. Report lines must reconcile to approved transactions.
6. Export is blocked while validation errors remain.
7. Submitted reports become read-only.
8. Corrections create adjustment records rather than overwriting history.
9. Every change must be captured in the audit log.

---

## 13. Suggested Internal Workflow

```text
Import or Enter Supplier
        ↓
Classify Supplier
        ↓
Validate ABN and Legal Details
        ↓
Import or Record Transactions
        ↓
Apply TPAR Rules
        ↓
Review Included and Excluded Items
        ↓
Resolve Exceptions
        ↓
Reconcile to Ledger
        ↓
Reviewer Approval
        ↓
Generate Export
        ↓
Submit and Archive
```

---

## 14. AI Implementation Prompt

```text
Implement a TPAR preparation module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Add TPAR eligibility fields to supplier records.
- Support supplier-level inclusion and transaction-level override.
- When a supplier is enabled, identify historical transactions in the reporting year for review.
- Do not automatically approve retrospectively selected transactions.
- Validate supplier legal name, ABN, and address.
- Provide included, excluded, pending, and exception transaction queues.
- Require an exclusion reason.
- Detect duplicate transactions.
- Reconcile report totals to supplier transactions and general-ledger accounts.
- Support cash and accrual reporting basis.
- Block export while validation errors remain.
- Add prepare, review, approve, export, submit, and locked statuses.
- Maintain immutable audit history.
- Support CSV export and a configurable electronic-file adapter.
- Add filters, search, pagination, bulk review, and sticky table headers.
- Include unit and integration tests for inclusion rules, exclusions, validation, reconciliation, and permissions.
```

---

## 15. Internal System Checklist

- [ ] Supplier master contains TPAR status.
- [ ] ABN validation is implemented.
- [ ] Transaction-level inclusion can override supplier defaults.
- [ ] Exclusions require a reason.
- [ ] Retrospective transactions enter a review queue.
- [ ] Duplicate detection is active.
- [ ] Report totals reconcile to the ledger.
- [ ] Export is blocked when errors exist.
- [ ] Approval and submission are recorded.
- [ ] Submitted reports are locked.
- [ ] Corrections retain the original history.
- [ ] Exported files are archived securely.

---

## Related Topics

- [05. Audit Log](05_Audit_Log.md)
- [06. Chart of Accounts](06_Chart_of_Accounts.md)
- Suppliers and Purchases
- Expenses and Bills
- Bank Reconciliation
- Reports Centre
- Tax Configuration

---

## Keywords

TPAR, Taxable Payments Annual Report, contractor payments, supplier reporting, ABN, ATO, supplier validation, transaction inclusion, transaction exclusion, reporting year, tax report, audit trail, reconciliation