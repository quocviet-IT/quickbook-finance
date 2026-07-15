# STEP 2 — Research Findings by Question

The findings in this section record information that was verified from official or primary sources during the research period.

> **Evidence rule**
>
> “Could not be determined” means that no clear confirmation was found in the reviewed official sources. It does not prove that the feature does not exist.

---

## 2.1 Wave Apps

| ID | Research finding |
|---:|---|
| W-A1 | Wave allows accounts to be added or edited within standard account types, but it does not support custom tabs, custom account types, or subaccounts. The official account-count limit could not be determined. [W5] |
| W-A2 | Wave creates a sales-tax liability account and supports inclusive or exclusive tax by invoice line, together with a Sales Tax Report. Vietnam VAT, e-invoicing, and filing support could not be determined. [W6][W7][W2] |
| W-A3 | The Pro plan includes automatic import, merge, and categorization. Automated connections use Plaid and are officially documented for the United States and Canada. Reconciliation compares statements with the ledger and helps resolve differences. [W1][W4][W8] |
| W-A4 | Wave provides owner and collaborator roles such as Admin, Editor, and Viewer. No enterprise-style custom granular role model was confirmed. Immutable audit logging and password-based period locking could not be determined. |
| W-P1 | An estimate can be converted into a draft invoice. Deposits, partial payments, and recurring invoices are supported. Milestone or percentage-based progress invoicing could not be determined. [W9] |
| W-P2 | Payment reminders can be scheduled before, on, and after the due date. Eligible online payments include card, bank, and Apple Pay. Reminder automation depends on plan and payment eligibility. [W10][W1] |
| W-P3 | The Starter plan includes mobile invoicing and a dashboard. Pro adds unlimited receipt OCR. Reports include Profit and Loss, Balance Sheet, Cash Flow, tax, payroll, Accounts Receivable, Accounts Payable, and tag comparison. [W1][W11] |
| W-P4 | Invoice and estimate API objects include `poNumber`, line items, memo, and currency. Native production-order, BOM, routing, work-center, and warehouse-movement entities could not be determined. [W12] |
| W-I1 | Wave provides a GraphQL API and OAuth 2.0 covering Account, Customer, Vendor, Product, Estimate, Invoice, Payment, Tax, and Money Transaction entities. Production OAuth entitlement should be confirmed because the official pages reviewed were not fully consistent. [W12][W13] |
| W-I2 | No official public endpoint was found for the raw pending bank-feed queue. The MoneyTransaction API creates accounting transactions but does not confirm access to unreviewed bank-feed data. [W12] |
| W-I3 | Wave provides invoice, estimate, and checkout webhooks with HTTPS/TLS, signatures, and retries. Wave Connect integrates with Google Sheets for import and export. [W14][W15] |
| W-I4 | Foreign-currency invoices and bills, estimated conversion, and unrealized foreign-exchange gains and losses are supported. No advanced treasury or multi-entity currency module was confirmed. [W16] |
| W-B1 | Wave Starter is USD 0. Wave Pro is USD 19 per month or USD 190 per year. Pro adds automatic bank import, auto-categorization, receipt OCR, and reminders. [W1] |
| W-B2 | Wave targets small businesses but currently supports businesses only in the United States and Canada. Compliance outside supported regions is not guaranteed. [W2][W3] |
| W-B3 | Standalone receipt OCR is USD 8 per month or USD 72 per year. Pro includes receipt capture. Payroll and payment processing depend on region and transaction fees. [W1][W17] |
| W-B4 | There is no verified basis for selecting Wave as CTYHP’s production accounting system in Vietnam because current official availability is limited to the United States and Canada. [W2] |

### Wave Apps — Key Interpretation

- Wave is useful as a reference for simplified invoicing, reminders, receipt capture, and small-business UX.
- Its official regional availability is the primary disqualifier for CTYHP’s Vietnam production environment.
- The platform does not provide verified manufacturing entities for BOM, routing, work centers, or warehouse movement lineage.
- Raw pending bank-feed data was not confirmed as accessible through the public API.

---

## 2.2 QuickBooks Online

| ID | Research finding |
|---:|---|
| Q-A1 | QuickBooks Online supports subaccounts and account numbers. Simple Start, Essentials, and Plus allow up to 250 Chart of Accounts line items; Advanced is listed as unlimited in the reviewed plan matrix. [Q4][Q1] |
| Q-A2 | QuickBooks Online Global supports tax setup and tax reports. Vietnam e-invoicing, VAT filing, and direct tax-authority integration could not be determined. [Q5] |
| Q-A3 | QuickBooks Online documents automatic bank feeds and reconciliation in more than 33 countries. Vietnam is not in the published bank-feed country list. Each CTYHP bank must therefore be validated through a Proof of Concept. [Q2] |
| Q-A4 | The audit log records transactions, sign-ins, settings changes, and app-originated changes. Books can be locked by date and password. [Q6][Q7] |
| Q-P1 | QuickBooks Online supports estimate-to-invoice conversion, status tracking, and progress invoicing by milestone, stage, or percentage. [Q3] |
| Q-P2 | Recurring invoices, automatic reminders, and due, overdue, and paid statuses are supported. Vietnam payment-rail availability could not be determined. [Q3] |
| Q-P3 | QuickBooks Online provides a business feed or dashboard, standard reports, and mobile invoicing. The exact layout depends on market and product rollout. [Q1][Q3] |
| Q-P4 | Plus includes inventory, purchase orders, project profitability, and class/location tracking. Advanced adds custom roles, a report builder, and workflows. Native BOM, routing, work-center, and production-batch capabilities could not be determined. [Q1] |
| Q-I1 | The Accounting API supports REST/JSON and GraphQL with OAuth 2.0 and `realmID`. It covers Account, Customer, Vendor, Item, Invoice, Bill, Payment, Purchase, and reports. A Node.js SDK is available. [Q9][Q10] |
| Q-I2 | The QuickBooks Online v3 API does not expose raw transactions that are still in **Bank transactions — For Review**. Accounting entities become queryable only after the transaction is added, matched, or accepted into the register. [Q13][Q14] |
| Q-I3 | OAuth, sandbox environments, webhooks, and an app ecosystem are available. Advanced includes workflow automation and Excel synchronization. [Q10][Q11][Q12][Q1] |
| Q-I4 | Multicurrency supports foreign customers, vendors, and accounts. Once multicurrency is enabled, it cannot be disabled, and the home currency cannot be changed. [Q8] |
| Q-B1 | The reviewed Global pricing page lists Simple Start at USD 38, Essentials at USD 75, Plus at USD 115, and Advanced at USD 275 per month, with user limits of 1, 3, 5, and 25 respectively. Prices vary by country and promotion. [Q1] |
| Q-B2 | Plus is the first plan with inventory, projects, and class/location tracking. Advanced increases customization, permissions, reporting, and automation. Selecting a manufacturing industry does not prove native BOM or MRP capability. [Q1] |
| Q-B3 | Native Vietnam payroll, statutory filing, and Vietnam-specific payroll pricing could not be determined. |
| Q-B4 | Plus is the closest functional baseline for CTYHP. Advanced is stronger when permissions, reporting, and automation are critical. Vietnam availability, bank support, and compliance must be validated before purchase. [Q1][Q2] |

### Note on the 2022 QuickBooks Manual

The **QuickBooks Online Business User Manual — Version 4, July 2022** documents the historical workflow for:

- Direct bank feeds and file upload
- **For Review**, **Categorised**, and **Excluded** transaction states
- Matching by amount, date, and payee
- Bank reconciliation
- Audit history
- Class and location tracking

This manual is supporting UX and workflow evidence only. It does not confirm current QuickBooks bank support or compliance availability in Vietnam. [Q15]

### QuickBooks Online — Key Interpretation

- QBO has stronger accounting control than Wave through hierarchical accounts, audit history, book locking, and broader permission options.
- Its API and TypeScript/Node.js ecosystem are more suitable for integration with CTYHP’s current stack.
- The API limitation around raw **For Review** bank-feed transactions means CTYHP should not depend on QBO as the source of raw bank data.
- QBO is an accounting-core candidate, not a verified manufacturing ERP.
- Vietnam commercial availability, tax compliance, payroll, payment rails, and bank connections remain mandatory PoC items.

---

## 2.3 Preliminary Platform Comparison

| Evaluation area | Wave Apps | QuickBooks Online | Preliminary implication for CTYHP |
|---|---|---|---|
| Vietnam availability | Officially limited to US/Canada businesses | Global product, but Vietnam-specific availability must be validated | Wave is excluded; QBO remains conditional |
| Accounting controls | Basic account structure and collaboration roles | Subaccounts, audit log, book locking, broader permissions | QBO is stronger |
| Banking | Automated feeds documented for US/Canada | Feeds available in many countries, but Vietnam not listed | Build a controlled bank-ingestion fallback |
| Raw bank-feed API | Not confirmed | For Review data is not exposed | Internal reconciliation store is required |
| Invoicing | Estimates, invoices, deposits, recurring transactions, reminders | Estimates, progress invoices, recurring transactions, reminders | QBO is closer to CTYHP progress billing |
| Manufacturing context | No confirmed BOM or production entities | Inventory/projects available, but no confirmed BOM/MRP | Keep production lineage in CTYHP systems |
| Integration | GraphQL, OAuth, webhooks, Google Sheets | REST/GraphQL, OAuth, sandbox, webhooks, Node.js SDK | QBO fits the current stack better |
| Vietnam compliance | Not supported | Not verified | Local compliance assessment remains mandatory |

---

## Related Topics

- [Executive Summary](01_Executive_Summary.md)
- [Research Perspectives](02_Research_Perspectives.md)
- Structured knowledge base
- Comparative feature report
- Recommended CTYHP integration architecture
- Build-vs-buy assessment

## Keywords

Wave Apps, QuickBooks Online, QBO, research findings, Chart of Accounts, tax compliance, Vietnam VAT, bank feeds, reconciliation, For Review API, progress invoicing, inventory, BOM, OAuth 2.0, GraphQL, REST API, webhooks, Node.js SDK, multi-currency, audit log, book lock, accounting platform selection