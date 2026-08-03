# Product Requirements Document: US Accounting Web App

**Product:** CTYHP Accounting  
**Market:** United States  
**Status:** Canonical product scope  
**Technology:** Next.js, TypeScript, Supabase/PostgreSQL, Ant Design  
**Accounting model:** Double-entry accounting with USD as the default base currency

## 1. Purpose

CTYHP Accounting is a secure web application for small and midsize US businesses. It provides a vendor-neutral accounting system of record for the general ledger, accounts receivable, accounts payable, banking, sales tax, financial reporting, documents, and audit history.

This PRD supersedes all earlier regional and ERP-selection scopes. Only requirements explicitly defined for the US product are active.

## 2. Product Principles

1. PostgreSQL is the authoritative accounting system of record.
2. Every financial event is represented by a balanced journal entry.
3. Posted accounting history is immutable. Corrections use linked reversal or adjusting entries.
4. Financial mutations and audit events commit in one database transaction.
5. Authorization is enforced in PostgreSQL as well as in the application.
6. Financial reports are derived from the ledger.
7. Document currency and base currency are preserved separately.
8. Closed periods cannot be changed without an authorized reopen workflow.
9. Country-specific behavior follows US terminology and configurable US business rules.
10. External integrations use stable adapters, idempotency, retries, and observable sync history.

## 3. Scope

### 3.1 Current foundation

The existing application includes:

- Email/password authentication.
- Basic roles: admin, accountant, and viewer.
- Chart of Accounts.
- Double-entry journal tables and posting functions.
- Customers, invoices, customer payments, and allocations.
- Vendors, bills, expenses, bill payments, and allocations.
- CSV bank-statement import and rule-based match suggestions.
- Trial Balance, Profit and Loss, and Balance Sheet.

These modules remain in scope but require the controls and extensions in this PRD.

### 3.2 Target modules

- Company and accounting settings.
- Users, permissions, approvals, and audit.
- Chart of Accounts and General Ledger.
- Customers, estimates, invoices, credit memos, refunds, and Accounts Receivable.
- Vendors, bills, vendor credits, payments, and Accounts Payable.
- Banking, bank rules, transaction review, and statement reconciliation.
- US sales-tax configuration, calculation, liability, filing-period support, and payments.
- Vendor tax information and 1099 preparation support.
- Products and services, with optional inventory.
- Purchase orders and receiving.
- Multi-currency and foreign-exchange accounting.
- Financial and operational reports.
- Documents, attachments, imports, exports, backup, and retention.
- Optional payroll-provider integration.

### 3.3 Excluded regional scope

Non-US statutory filings, tax-authority integrations, payroll rules, local accounting-software integrations, and legacy regional product behavior are not requirements. A country-specific feature may enter scope only through an approved US product requirement.

### 3.4 Deferred scope

- Native mobile applications; responsive web and PWA support may come first.
- Full in-house payroll calculation and tax filing.
- Advanced manufacturing, BOM, WIP, lot, or production-batch accounting unless separately approved.
- Consolidation of multiple legal entities.
- Public marketplace for third-party integrations.

## 4. Users and Roles

| Role | Primary responsibilities |
|---|---|
| Administrator | Company configuration, user administration, integration setup, and controlled period reopen |
| Controller | Accounting policy, approvals, close, reporting, and exception review |
| Accountant | Operational accounting, reconciliation, journals, receivables, payables, and reporting |
| Accounts Receivable | Customers, estimates, invoices, receipts, statements, and collections |
| Accounts Payable | Vendors, bills, credits, payment preparation, and 1099 review |
| Approver | Approval of configured transactions or master-data changes |
| Viewer/Auditor | Read-only reports, transactions, documents, and audit history |

The implementation may begin with coarse roles, but the target authorization model must support permissions and segregation of duties.

## 5. Functional Requirements

### 5.1 Company and accounting settings

| ID | Requirement | Acceptance criteria |
|---|---|---|
| US-FR-001 | Store legal business name, DBA name, EIN reference, addresses, contact information, fiscal-year start, base currency, time zone, and accounting basis | Authorized user can maintain versioned settings; sensitive identifiers are protected |
| US-FR-002 | Support Cash and Accrual reporting basis | Profit and Loss and other applicable reports reproduce expected test fixtures under each basis |
| US-FR-003 | Support accounting periods and close dates | Posting to a closed period is blocked; authorized reopen requires reason and audit |
| US-FR-004 | Support configurable document numbering | Numbers are unique, atomic, and never reused after posting or voiding |

### 5.2 Security, approval, and audit

| ID | Requirement | Acceptance criteria |
|---|---|---|
| US-FR-010 | Manage users, roles, permissions, invitations, suspension, and offboarding | Access changes take effect promptly and are auditable |
| US-FR-011 | Require MFA for privileged users when supported by the identity provider | Privileged access policy is testable and documented |
| US-FR-012 | Support configurable maker-checker approval | A user cannot approve their own controlled transaction when segregation is enabled |
| US-FR-013 | Maintain an immutable audit log | Every protected write records actor, role, source, action, entity, reason, and before/after state atomically |
| US-FR-014 | Provide entity-level audit history and filters | Auditor can find all changes for a transaction, user, date range, or request ID |

### 5.3 Chart of Accounts and General Ledger

| ID | Requirement | Acceptance criteria |
|---|---|---|
| US-FR-020 | Maintain hierarchical accounts with type, detail type, status, currency, and posting/summary designation | Cycles and duplicate codes are rejected; inactive or summary accounts cannot receive new postings |
| US-FR-021 | Create balanced manual journal entries | Unbalanced transaction or base-currency totals cannot persist |
| US-FR-022 | Support opening balances through controlled journals | Opening Trial Balance matches the approved import control total |
| US-FR-023 | Correct posted entries with linked reversal or adjusting entries | Prior-period reports remain reproducible; original history remains visible |
| US-FR-024 | Provide General Ledger and Journal reports | User can filter by account, date, source, document, and status and drill down to source records |

### 5.4 Customers and Accounts Receivable

| ID | Requirement | Acceptance criteria |
|---|---|---|
| US-FR-030 | Maintain customer master data, payment terms, currency, tax treatment, contacts, and addresses | Changes are authorized and audited |
| US-FR-031 | Create versioned estimates and convert accepted estimates to invoices | Conversion is traceable and cannot create duplicate invoices |
| US-FR-032 | Create, approve, issue, send, and void invoices | Issued invoices are immutable; totals and tax are calculated server-side |
| US-FR-033 | Record credit memos, write-offs, and customer refunds | Ledger and customer balances remain reconciled |
| US-FR-034 | Record and allocate customer payments | Allocation requires matching customer, currency, valid invoice state, and sufficient balance |
| US-FR-035 | Provide customer statements, AR ageing, and overdue workflow | AR ageing ties to the Accounts Receivable control account |

### 5.5 Vendors and Accounts Payable

| ID | Requirement | Acceptance criteria |
|---|---|---|
| US-FR-040 | Maintain vendors, payment terms, currency, remittance details, and secured tax information | Sensitive values are masked and access-controlled; changes are audited |
| US-FR-041 | Create, approve, post, and void bills | Duplicate vendor/reference combinations are detected; posted bills are immutable |
| US-FR-042 | Record expenses and attach supporting evidence | Ledger posting, document link, and audit event are atomic |
| US-FR-043 | Record vendor credits and apply them to bills | AP subledger and control account remain reconciled |
| US-FR-044 | Prepare, approve, and record bill payments | Payment cannot exceed eligible open balances; approval can be separated from preparation |
| US-FR-045 | Provide AP ageing and vendor statements/reconciliation | AP ageing ties to the Accounts Payable control account |

### 5.6 US vendor information reporting support

| ID | Requirement | Acceptance criteria |
|---|---|---|
| US-FR-050 | Track vendor tax-form status and 1099 eligibility | Authorized staff can identify missing or expired documentation |
| US-FR-051 | Classify reportable transactions and exclusions | Overrides require a reason and appear in audit history |
| US-FR-052 | Produce a review worksheet and export dataset for the selected tax year | Totals reconcile to eligible ledger transactions and blocked errors are visible |

The application must not claim filing compliance without product-owner and professional tax review. Tax identifiers must not be stored in general audit payloads.

### 5.7 Banking and reconciliation

| ID | Requirement | Acceptance criteria |
|---|---|---|
| US-FR-060 | Import immutable statement transactions with cryptographic deduplication | Reimport creates no duplicates and distinct transactions are not dropped by weak hash collisions |
| US-FR-061 | Review, categorize, split, transfer, match, exclude, and document bank transactions | Review actions are reversible through controlled workflows and audited |
| US-FR-062 | Configure bank rules with approval and performance history | Rules do not auto-post until approved; false matches can be measured |
| US-FR-063 | Reconcile an account to a statement ending date and balance | Completion requires zero unexplained difference or an explicitly approved adjustment |
| US-FR-064 | Lock completed reconciliations and support controlled reopen | Reopen requires permission, reason, approval, and audit history |
| US-FR-065 | Produce a reconciliation report and discrepancy report | Reports remain reproducible after later activity |

### 5.8 Products, services, purchasing, and inventory

| ID | Requirement | Acceptance criteria |
|---|---|---|
| US-FR-070 | Maintain products and services with SKU, type, sales account, purchase account, price, cost, taxability, and status | Historical transactions preserve the item version used |
| US-FR-071 | Support purchase orders, partial receipt, closure, and bill conversion | Duplicate receipts are prevented and PO-to-bill traceability is retained |
| US-FR-072 | Support optional inventory quantity and valuation | Inventory subledger reconciles to the ledger using the approved costing method |
| US-FR-073 | Support configurable three-way matching | Quantity and price variances outside tolerance require exception approval |

### 5.9 US sales tax

| ID | Requirement | Acceptance criteria |
|---|---|---|
| US-FR-080 | Maintain tax agencies, jurisdictions, rates, effective dates, and tax codes | Overlapping or invalid effective periods are rejected |
| US-FR-081 | Determine customer and item taxability and calculate invoice sales tax | Server calculation matches approved fixtures and preserves calculation detail |
| US-FR-082 | Maintain sales-tax liability by agency, jurisdiction, and period | Liability report reconciles to sales-tax control accounts |
| US-FR-083 | Support return-period preparation, review, status, adjustment, and payment recording | Filed/closed periods are locked; later corrections create linked adjustments |

Tax rules must be configuration-driven. Current filing obligations and jurisdiction rules require professional review before production use.

### 5.10 Multi-currency

| ID | Requirement | Acceptance criteria |
|---|---|---|
| US-FR-090 | Maintain currencies, dated rates, sources, and approved overrides | Every override has actor, reason, and effective date |
| US-FR-091 | Preserve transaction currency and base-currency values | Every journal balances in both representations |
| US-FR-092 | Calculate realized foreign-exchange gain or loss at settlement | Settlement fixture posts the expected gain or loss |
| US-FR-093 | Run controlled period-end revaluation | Duplicate runs are blocked and reversal behavior is defined |

### 5.11 Reports and dashboard

| ID | Requirement | Acceptance criteria |
|---|---|---|
| US-FR-100 | Provide Trial Balance, Profit and Loss, Balance Sheet, Cash Flow Statement, General Ledger, and Journal reports | Reports reconcile to the same ledger dataset |
| US-FR-101 | Provide AR ageing, AP ageing, sales-tax liability, and bank-reconciliation reports | Each report ties to its control account or reconciliation session |
| US-FR-102 | Support visible filters, drill-down, and CSV/PDF export | Export stores report parameters and can be reproduced |
| US-FR-103 | Provide actionable dashboard metrics | Dashboard surfaces overdue receivables, due payables, unreconciled items, approval tasks, and close exceptions |
| US-FR-104 | Support saved and scheduled reports in a later phase | Permissions, timezone, retry, and delivery history are preserved |

### 5.12 Documents, import, export, and retention

| ID | Requirement | Acceptance criteria |
|---|---|---|
| US-FR-110 | Store attachments in private object storage | File type, size, access, hash, and malware-scan status are enforced |
| US-FR-111 | Version document templates and preserve the version used by issued documents | Re-rendering does not silently change an issued invoice |
| US-FR-112 | Run structured imports through staging, validation, exception review, and approval | Invalid rows do not partially post; control totals reconcile |
| US-FR-113 | Export company data and supporting documents in a portable format | Restore/export exercise is documented and testable |
| US-FR-114 | Apply configurable retention and legal-hold controls | Protected records cannot be silently deleted by application users |

## 6. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| US-NFR-001 | Security | Least privilege, RLS, safe server-side authorization, secret management, MFA for privileged access, and secure handling of taxpayer and bank information |
| US-NFR-002 | Integrity | Database constraints and transactional RPCs enforce accounting invariants and atomic audit |
| US-NFR-003 | Availability | Defined backup, restore, recovery-point, and recovery-time targets with periodic restore tests |
| US-NFR-004 | Performance | Normal interactive pages return promptly; large reports and imports run asynchronously with visible status |
| US-NFR-005 | Accessibility | Target WCAG 2.2 AA for primary accounting workflows |
| US-NFR-006 | Observability | Structured logs, request IDs, job history, integration metrics, and alerts without leaking sensitive data |
| US-NFR-007 | Portability | Data can be exported in documented, machine-readable formats without dependence on a single external vendor |
| US-NFR-008 | Testing | Unit, database integration, concurrency, authorization, migration, and end-to-end tests protect critical financial workflows |
| US-NFR-009 | Documentation | Product, schema, operations, recovery, and user documentation are maintained in English as the canonical implementation language |

## 7. Core Data Model Direction

The existing `acc_*` tables remain the foundation. Expected additions include:

- `acc_company`, `acc_company_setting_version`
- `acc_accounting_period`, `acc_period_event`
- `acc_role`, `acc_permission`, `acc_user_role`, `acc_approval_request`
- `acc_journal_reversal_link`
- `acc_estimate`, `acc_estimate_line`
- `acc_credit_memo`, `acc_credit_memo_line`, `acc_customer_refund`
- `acc_vendor_credit`, `acc_vendor_tax_profile`
- `acc_bank_rule`, `acc_bank_rule_version`
- `acc_statement_reconciliation`, `acc_reconciliation_line`, `acc_reconciliation_exception`
- `acc_item`, `acc_item_version`, `acc_item_category`
- `acc_purchase_order`, `acc_purchase_order_line`, `acc_goods_receipt`
- `acc_tax_agency`, `acc_tax_jurisdiction`, `acc_tax_rate`, `acc_tax_period`, `acc_tax_return`
- `acc_fx_revaluation`, `acc_fx_revaluation_line`
- `acc_document`, `acc_document_link`, `acc_document_template_version`
- `acc_import_job`, `acc_import_row`, `acc_export_job`
- `acc_integration`, `acc_outbox_event`, `acc_sync_attempt`

Names may change during detailed design, but the business invariants must remain explicit.

## 8. Delivery Priorities

### Phase 0: Production safety

- Correct RLS bypasses.
- Harden journal posting.
- Correct payment-allocation validation.
- Make reconciliation atomic and one-to-one.
- Implement historically correct reversals.
- Make auditing atomic.
- Add database integration tests.

### Phase 1: Complete accounting core

- Company settings and periods.
- Manual journals and opening balances.
- User administration and approvals.
- Full bank reconciliation sessions.
- AR/AP ageing and General Ledger reports.
- Credit memos, vendor credits, refunds, and attachments.
- Report drill-down and exports.

### Phase 2: US operational compliance support

- US sales tax.
- Vendor tax profile and 1099 preparation support.
- Close workflow and retained evidence.
- Backup, restore, and portable company export.

### Phase 3: Operational breadth

- Products and services.
- Purchase orders, receiving, and optional inventory.
- Recurring transactions.
- Cash-flow forecasting.
- Saved and scheduled reports.
- External provider integrations.

## 9. Release Gates

The application is not production-ready until:

1. Critical accounting mutations are atomic and covered by database tests.
2. Direct client writes cannot bypass financial workflows.
3. Trial Balance remains balanced after every supported workflow.
4. AR and AP ageing reconcile to their control accounts.
5. Reconciliation completion and reopen controls pass concurrency tests.
6. Closed-period and reversal behavior preserves historical reports.
7. Audit history is immutable, searchable, and complete.
8. Backup restoration and company-data export are demonstrated.
9. Sensitive data handling receives a security review.
10. US tax-related calculations and outputs receive professional accounting/tax review.

## 10. Success Metrics

- Zero persisted unbalanced journal entries.
- Zero unaudited protected financial mutations.
- Zero duplicate bank imports, payments, or integration postings under retry tests.
- 100% of completed reconciliations have a reproducible report and zero unexplained difference.
- AR, AP, bank, sales-tax, and inventory control reports reconcile to the ledger where applicable.
- Critical workflows pass automated authorization, rollback, concurrency, and historical-report tests.
