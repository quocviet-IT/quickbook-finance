---
document_id: PRD-2026-ACC-01
version: "1.1"
date: 2026-07-15
owner: "AI Team — CTYHP"
status: "DRAFT — pending Gate 0 legal verification before execution"
document_type: "Product Requirements Document"
language: "English"
source_file: "PRD_CTYHP_Accounting_Operations_Layer_EN.docx"
---

# CTYHP Accounting Operations Layer & Two-Track ERP Proof of Concept

> **CTYHP — AI TEAM · INTERNAL DOCUMENT**
>
> **Product Requirements Document**

| **Field**       | **Value**                                                           |
|-----------------|---------------------------------------------------------------------|
| Document ID     | PRD-2026-ACC-01                                                     |
| Version         | 1.1 — Formal review draft (English edition)                         |
| Date            | 15 July 2026                                                        |
| Owner           | AI Team — CTYHP                                                     |
| Approvers       | AI Team Lead · Chief Accountant · Leadership representative         |
| Source research | RR-2026-02 — CTYHP ERP Selection Academic Report (87 cited sources) |
| Status          | DRAFT — pending Gate 0 legal verification before execution          |

## 1. Executive Summary

Research report RR-2026-02 screened nine accounting/ERP platforms and evaluated four primary candidates in depth. Its conclusion: no commercial platform alone satisfies CTYHP's three requirement axes — (i) Vietnamese statutory compliance, (ii) international transaction capability, and (iii) deep integration with existing production systems. QuickBooks Online and Wave Apps were removed from the final shortlist.

This document defines the product requirements for two parallel workstreams: **(A) the Accounting Operations Layer** — an internally built orchestration layer on Supabase that serves as the system of record for order–invoice–payment–production mapping, independent of whichever accounting platform is ultimately selected; and **(B) a six-week, two-track proof of concept** — Track A evaluates integrated ERP options (Odoo Enterprise self-hosted, preferred; NetSuite OneWorld, alternative), Track B evaluates Vietnam-native statutory accounting options (FAST Accounting; MISA SME), governed by eight mandatory go/no-go gates.

**Blocking condition (Gate 0):** the entire compliance argument for both tracks rests on Decree 254/2026/ND-CP (effective 1 July 2026). This legal premise must be independently verified by CTYHP's legal/accounting function before any technical gate is executed.

## 2. Background & Problem Statement

### 2.1 Current state

- Internal stack: Next.js + TypeScript + Supabase (PostgreSQL) + Vercel + Google Apps Script; order management, BOM/pricing, production tracking, and warehouse applications are already in production.

- Accounting sits outside this integrated environment: production-order invoicing, bank reconciliation, and production-line reporting are manual or fragmented.

- Vietnam's e-invoicing legal framework changed on 1 July 2026 (Decree 254/2026/ND-CP superseding the Decree 123/2020 + 70/2025 framework) — every vendor's prior compliance evidence must be re-verified.

### 2.2 Problems to solve

| **ID** | **Problem**                                                                                                          | **Impact if unsolved**                                                                       |
|--------|----------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| P1     | No reliable source of raw bank data: no evaluated platform exposes unreconciled bank transactions through its API    | Reconciliation cannot be automated; the team stays dependent on manual work in the vendor UI |
| P2     | Invoices must link to production orders, BOM versions, batches, and warehouse releases — no SaaS models this lineage | Cost lineage by production line is lost; management reporting is distorted                   |
| P3     | Vietnam e-invoice/VAT compliance has not been proven live on any candidate under the new legal framework             | Legal exposure if a contract is signed before verification                                   |
| P4     | Five-year TCO of the candidates has not been formally quoted                                                         | A purchase decision would rest on incomplete list prices                                     |

## 3. Goals, Scope & Success Criteria

### 3.1 Goals

| **ID** | **Goal**                                                                                                                                                | **Metric**                                                                  |
|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| G1     | Stand up a Supabase control plane as the system of record for order↔invoice↔payment↔production mapping, independent of the selected accounting platform | Schema deployed to staging; one test invoice runs end-to-end                |
| G2     | Prove or disprove every go/no-go gate for at least one Track A and one Track B candidate within six weeks                                               | Complete pass/fail matrix of 8 gates × 2 candidates, with attached evidence |
| G3     | Deliver a one-page, evidence-based go/no-go memo to leadership                                                                                          | Memo received by leadership by end of Week 6                                |

### 3.2 Non-goals (this phase)

- NOT building the invoice-orchestration UI — schema and API contract only.

- NOT migrating historical accounting data.

- NOT committing to a single platform — the PoC may conclude that Track A and Track B should be combined.

- NOT a substitute for professional legal review — Gate 0 belongs to legal/accounting, not to the AI team.

## 4. Users & User Stories

| **ID** | **Role**             | **User story & value**                                                                                                                                                                                               |
|--------|----------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| US1    | Accountant           | As an accountant, I need every issued invoice automatically linked to its production order and batch, so I never have to trace it manually across three systems when a customer or auditor asks.                     |
| US2    | Chief Accountant     | As the chief accountant, I need the e-invoice issue/adjust/cancel workflow proven live under Decree 254/2026, so I can sign off compliance before go-live.                                                           |
| US3    | Reconciliation clerk | As the reconciliation clerk, I need raw bank transactions ingested directly into our internal system (not via a SaaS), so I can reconcile by order and payment schedule instead of line-by-line against a statement. |
| US4    | Production manager   | As a production manager, I need cost-and-revenue reporting by production line and batch, so I know which line is losing money before the quarter ends.                                                               |
| US5    | AI Team              | As the engineering team, we need a stable control-plane schema and a vendor-independent API contract, so we do not rewrite the integration if the platform changes after the PoC.                                    |
| US6    | Leadership           | As leadership, I need a pass/fail matrix across all eight gates with evidence and a five-year TCO, so the investment decision rests on data rather than vendor promises.                                             |

## 5. Functional Requirements

*Priority follows MoSCoW:* **M** *= Must have (required for the PoC) ·* **S** *= Should ·* **C** *= Could ·* **W** *= Won't (this phase)*

### 5.1 Control plane (Supabase)

| **ID** | **Priority** | **Requirement**                                                                                                                                                       | **Acceptance criteria**                                                              |
|--------|--------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| FR-01  | M            | Mapping schema: order_id, production_batch_id, bom_version_id, warehouse_release_id, invoice_id, e_invoice_id, payment_id, bank_transaction_ref, platform_sync_status | Migration runs cleanly on staging; FKs correctly reference existing tables           |
| FR-02  | M            | Internal invoice lifecycle: draft → issued → adjusted/replaced → cancelled, with status synchronized to the e-invoice provider                                        | All five transitions executed on one test invoice; audit log records every step      |
| FR-03  | M            | Bank ingestion: load statements (CSV / bank API) into a raw bank_transaction table — never sourced from the SaaS                                                      | One real statement file loaded; raw data preserved intact and immutable              |
| FR-04  | M            | Reconciliation engine v0: match bank_transaction ↔ payment ↔ invoice by rule (amount + reference + time window)                                                       | ≥80% of test transactions auto-matched; the remainder queued for manual review       |
| FR-05  | S            | Platform adapter interface: one shared TypeScript interface; each PoC candidate is one implementation                                                                 | Switching candidates requires no control-plane change — only a new adapter           |
| FR-06  | S            | Reporting mart v0: cost-and-revenue views by production line and batch                                                                                                | One dashboard query returns correct figures on a test dataset supplied by Production |
| FR-07  | C            | Idempotent sync with backoff retry on platform 429/5xx responses                                                                                                      | Throttling test creates no duplicate records                                         |
| FR-08  | W            | Invoice-orchestration UI for accountants                                                                                                                              | — (post-PoC phase)                                                                   |

### 5.2 Two-track PoC

| **ID** | **Priority** | **Requirement**                                                                                                                                   | **Acceptance criteria**                                     |
|--------|--------------|---------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------|
| FR-09  | M            | Track A — Odoo Enterprise self-hosted in Vietnam: stand up a sandbox, connect SInvoice, run the full e-invoice lifecycle                          | Gate 1 pass/fail with screenshot + log evidence             |
| FR-10  | M            | Track B — FAST or MISA (meInvoice + mTax): live e-invoice demo and VAT workflow                                                                   | Gate 1 + Gate 2 pass/fail confirmed by the Chief Accountant |
| FR-11  | M            | Load-test each candidate's API at CTYHP's realistic volume (invoices/payments per day)                                                            | Latency + throttling behaviour report; Gate 5 pass/fail     |
| FR-12  | S            | Track A fallback — NetSuite OneWorld: activate only if Odoo fails Gate 1 or Gate 7                                                                | Activation decision recorded in Week 3 minutes              |
| FR-13  | M            | Jewelry-manufacturing scenario on real (anonymized) data: precious-metal BOM, WIP, lot/serial traceability, gold-weight variance, multi-warehouse | Gate 7 pass/fail signed off by the Production Manager       |

## 6. Non-Functional Requirements

| **ID** | **Category**       | **Requirement**                                                                                                                                                                                                                                     |
|--------|--------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| NFR-01 | Data residency     | Accounting data and raw bank statements remain in CTYHP's current Supabase region; each candidate platform must supply a data-flow map, data-center location, DPA, and subprocessor list (Gate 3), assessed against PDPL 91/2025 and Decree 13/2023 |
| NFR-02 | Security           | Platform OAuth tokens/API keys stored in Supabase Vault or Vercel environment variables — never hardcoded, never committed; every write on the control plane is audit-logged                                                                        |
| NFR-03 | Document retention | Archive/export/restore mechanisms satisfy Decree 174/2016 (Gate 4); vendor backup does NOT count as a legally adequate retention policy                                                                                                             |
| NFR-04 | Performance        | Near-real-time invoice/payment sync: target latency \<5 minutes from creation in the control plane to appearance on the platform, within the vendor's rate limits                                                                                   |
| NFR-05 | Portability        | No vendor lock-in: all source-of-truth business data lives in the control plane; the platform receives only the minimal projection required for the ledger                                                                                          |
| NFR-06 | Language           | Technical documentation bilingual (Vietnamese/English); source code, table names, and comments in English per the AI Team coding convention                                                                                                         |

## 7. Control-Plane Data Model

Design principle (RR-2026-02 §6): raw bank data is ingested by CTYHP directly (bank API / statements) and never sourced from the accounting SaaS — no evaluated platform reliably exposes unreconciled bank transactions via API. Production lineage (orders, BOM versions, batches, warehouse movements) remains in Supabase as the system of record; only summarized financial effects are posted to the ledger.

| **Table**            | **Purpose**                                                            | **Key relations**                                                                  |
|----------------------|------------------------------------------------------------------------|------------------------------------------------------------------------------------|
| acc_invoice          | Internal invoice (pre e-invoice issuance); lifecycle state per FR-02   | → order_id, production_batch_id, bom_version_id                                    |
| acc_e_invoice        | Issued e-invoice record (number, series, tax-authority code, provider) | → acc_invoice (1-1, or 1-n on replacement/adjustment)                              |
| acc_payment          | Customer payments received                                             | → acc_invoice (n-n via allocation)                                                 |
| acc_bank_transaction | Raw, immutable bank transactions loaded from statements / bank API     | → acc_payment (via reconciliation)                                                 |
| acc_reconciliation   | Match results: rule applied, confidence, approval state                | → acc_bank_transaction, acc_payment                                                |
| acc_platform_sync    | Per-record sync state to each candidate platform (per adapter)         | → all acc_* tables; a platform_code column allows both tracks to run in parallel |
| acc_audit_log        | Write-operation journal for the control plane (NFR-02)                 | → all acc_* tables                                                               |

*Column-level detail, data types, and indexes will be specified in the SQL migration — the first deliverable of the build phase, after this PRD is approved.*

## 8. Go/No-Go Gates

**Gate 0 is a non-technical blocking condition:** no other gate may be executed before Gate 0 is signed off. Rationale: the entire compliance argument in RR-2026-02 §5.1 rests on a legal instrument issued after the knowledge horizon of the AI models used in the research, supported by a single cited source (the Government legal portal).

| **Gate** | **Name**              | **Mandatory pass condition**                                                                                                                                                       | **Sign-off**             |
|----------|-----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------|
| 0        | Legal verification    | Legal/accounting independently confirm: Decree 254/2026/ND-CP exists, is effective from 1 July 2026, and applies as described in RR-2026-02 §5.1 — including transition provisions | Legal + Chief Accountant |
| 1        | E-invoicing           | Live demonstration in a real environment: issue, adjust, replace, cancel, and error handling under Decree 254/2026                                                                 | Chief Accountant         |
| 2        | VAT                   | Demonstrate preparation, review, export, and submission of VAT data to the Chief Accountant's satisfaction                                                                         | Chief Accountant         |
| 3        | Data residency        | Receive in full: data-flow map, data-center location, DPA, subprocessor list; assessed against PDPL 91/2025 + Decree 13/2023                                                       | Legal                    |
| 4        | Document retention    | Demonstrate archive, export, audit, backup, restore, and legal presentation per Decree 174/2016                                                                                    | Chief Accountant         |
| 5        | Integration           | API/interface sustains CTYHP's actual invoice/payment volume; throttling and idempotent retry verified                                                                             | AI Team Lead             |
| 6        | Commercials           | Complete five-year TCO quotation: licenses, modules, hosting, localization, migration, support, exit/export                                                                        | Leadership               |
| 7        | Jewelry manufacturing | Proven on real data: precious-metal BOM, WIP, lot/serial traceability, gold-weight variance, multi-warehouse                                                                       | Production Manager       |

## 9. Six-Week Timeline & RACI

### 9.1 Timeline

| **Week** | **Focus**                                                                                                             | **Deliverable**                                   |
|----------|-----------------------------------------------------------------------------------------------------------------------|---------------------------------------------------|
| 0        | Gate 0 — legal verification of Decree 254/2026; in parallel: prepare the Supabase staging environment                 | Signed legal confirmation; staging ready          |
| 1        | Commercial outreach: Odoo VN partner, FAST, MISA — scoping calls, sandbox access; deploy control-plane schema (FR-01) | Sandbox access ×3; migration v1 on staging        |
| 2        | Track A: stand up Odoo self-host, test the SInvoice connector (Gate 1); begin bank ingestion (FR-03)                  | Gate 1 result for Track A; bank ingestion working |
| 3        | Track B: FAST/MISA e-invoice + mTax (Gates 1, 2); decide whether to activate the NetSuite fallback (FR-12)            | Gate 1+2 results for Track B; decision minutes    |
| 4        | API load tests on both tracks (Gate 5); collect data-residency documentation (Gate 3); reconciliation v0 (FR-04)      | Gate 3+5 reports; reconciliation demo             |
| 5        | Jewelry-manufacturing scenario on both tracks (Gate 7); document-retention test (Gate 4)                              | Gate 4+7 results with sign-offs                   |
| 6        | TCO quotations (Gate 6); consolidate the 8-gate pass/fail matrix; write the one-page go/no-go memo                    | Memo to leadership + evidence pack                |

### 9.2 RACI

| **Item**                             | **AI Team** | **Accounting** | **Legal** | **Leadership** |
|--------------------------------------|-------------|----------------|-----------|----------------|
| Gate 0 — legal verification          | C           | A              | R         | I              |
| Control plane (FR-01→07)             | R/A         | C              | I         | I              |
| Gates 1, 2, 4 — accounting workflows | R           | A              | C         | I              |
| Gate 3 — data residency              | R           | C              | A         | I              |
| Gate 5 — integration / load test     | R/A         | I              | I         | I              |
| Gate 6 — TCO / commercials           | R           | C              | C         | A              |
| Gate 7 — manufacturing scenario      | R           | I              | I         | C (PM signs)   |
| Final go/no-go memo                  | R           | C              | C         | A              |

*R = Responsible · A = Accountable · C = Consulted · I = Informed*

## 10. Risks & Mitigations

| **ID** | **Risk**                                                                              | **Severity** | **Mitigation**                                                                                               |
|--------|---------------------------------------------------------------------------------------|--------------|--------------------------------------------------------------------------------------------------------------|
| R1     | Decree 254/2026 is misdescribed in the research, or changes again before the PoC ends | High         | Gate 0 blocks first; re-check in Week 6 before the memo is issued                                            |
| R2     | Both tracks fail Gate 1 despite vendor claims                                         | High         | Escalate to leadership in Week 3; interim option: a controlled semi-manual e-invoice workflow                |
| R3     | Vendor delays on sandbox/quotation slip the timeline                                  | Medium       | Both tracks run fully in parallel with separate owners; response deadlines stated in the scoping invitations |
| R4     | Load test volume is unrepresentative (false Gate 5 pass)                              | Medium       | Obtain real volume figures from Accounting before Week 4; test at peak, not average                          |
| R5     | The control plane is unconsciously designed around the first candidate tested         | Medium       | FR-05 adapter interface is mandatory; cross-review of the schema inside the AI team before Week 2            |
| R6     | Real production data used for Gate 7 leaks through a vendor sandbox                   | High         | Mandatory anonymization before any data enters a sandbox; no real customer names                             |

## 11. References

- **RR-2026-02 —** Selecting an Accounting and ERP Platform for an Export-Oriented Jewelry Manufacturer in Vietnam (CTYHP ERP Selection Academic Report), 14 July 2026 — 87 cited sources; the evidentiary basis of this PRD.

- **CTYHP Leadership Package —** decision summary for leadership (Wave vs QBO), 14 July 2026.

- **Legal instruments to be verified at Gate 0:** Decree 254/2026/ND-CP (e-invoicing); Personal Data Protection Law 91/2025/QH15; Decree 13/2023/ND-CP; Decree 174/2016/ND-CP (accounting-document retention).

*— End of document —*