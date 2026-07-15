# Structured Knowledge Base

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)

Condensed evidence organized by banking, invoicing, payroll, compliance, integration, manufacturing, data residency, pricing, and platform classification.

## Wave Apps and QuickBooks Online knowledge base

| **Category**    | **Platform** | **Verified evidence**                                                                         | **Limits / undetermined**                                                                   |
|-----------------|--------------|-----------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| Banking         | Wave         | Pro automatic import/categorization and reconciliation. **[W1][W8]**                      | Bank connections documented for US/Canada; raw bank-feed API not confirmed. **[W4]**      |
| Banking         | QBO          | Automatic feeds, categorization, matching, and reconciliation. **[Q2][Q15]**              | Vietnam absent from published feed list; API does not expose For Review. **[Q13][Q14]** |
| Invoicing       | Wave         | Unlimited estimates/invoices; estimate→draft invoice, recurring, reminders. **[W9][W10]** | Progress invoicing and native production-order model not confirmed.                         |
| Invoicing       | QBO          | Estimate→invoice, progress invoicing, recurring, reminders. **[Q3]**                        | Vietnam merchant/payment availability not determined.                                       |
| Payroll         | Wave         | Employee/contractor payroll in supported markets. **[W17]**                                 | Not a native Vietnam payroll solution.                                                      |
| Payroll         | QBO          | Payroll exists in selected markets and through ecosystem add-ons.                             | Native Vietnam statutory payroll not determined.                                            |
| Multi-currency  | Wave         | Foreign invoices/bills and unrealized FX gains/losses. **[W16]**                            | Advanced treasury/multi-entity capability not confirmed.                                    |
| Multi-currency  | QBO          | Foreign customers/vendors/accounts and home-currency conversion. **[Q8]**                   | Cannot be disabled; home currency is locked after activation.                               |
| Reporting       | Wave         | P&L, Balance Sheet, Cash Flow, tax, AR/AP, customer/vendor, and tags. **[W11]**             | No production-line or BOM variance reporting.                                               |
| Reporting       | QBO          | Standard reports; Plus adds class/location/projects; Advanced custom reporting. **[Q1]**    | Production-line reporting still requires custom build.                                      |
| API/Integration | Wave         | GraphQL/OAuth, accounting entities, webhooks, Google Sheets. **[W12][W14][W15]**        | Raw bank feed not confirmed; regional constraint.                                           |
| API/Integration | QBO          | REST/GraphQL, OAuth 2, sandbox, webhooks, SDK/app ecosystem. **[Q9]**-**[Q12]**           | No access to raw For Review bank items.                                                     |
| Pricing         | Wave         | Starter USD 0; Pro USD 19/month. **[W1]**                                                   | No official plan for a Vietnam business. **[W2]**                                         |
| Pricing         | QBO          | Global snapshot: USD 38/75/115/275; 1/3/5/25 users. **[Q1]**                                | Vietnam contract price and availability not determined.                                     |

---

## Vietnam and international platform market scan

Purpose: rapidly filter accounting and ERP platforms that could operate in Vietnam while also supporting international transactions and foreign customers for an export-oriented jewelry manufacturer. This is a disqualifier scan only; it does not assess deep manufacturing functionality, implementation effort, pricing, security, APIs, or total cost of ownership.

| **Screening rule:** a platform is retained only when there is evidence of a Vietnam compliance path and international transaction capability. Where official evidence is incomplete, the result is “Needs further verification.” |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

### Global platforms assessed for Vietnam deployment

| **Platform**          | **Vietnam compliance**                                                                                                                                                                                                            | **International capability**                                                                                                                                                          | **Classification**             |
|-----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------|
| **QuickBooks Online** | No Vietnam-native Decree 123 e-invoicing or VAT filing module was identified in the reviewed official materials. QuickBooks describes general e-invoicing compliance integrations, but Vietnam coverage was not confirmed. [M1] | Supports multicurrency and invoicing for foreign customers. Native multi-entity or multi-country consolidation was not verified for standard QBO plans. [M2]                        | **Needs further verification** |
| **Wave Apps**         | Officially available only to businesses in the United States and Canada; Wave states that compliance is not guaranteed outside supported regions. No verified Vietnam VAT or Decree 123 path was identified. [M3]               | Supports foreign-currency invoices, bills, payments, exchange rates, and currency conversion. [M4]                                                                                  | **Disqualified**               |
| **Xero**              | Supports e-invoicing in selected countries and provides APIs and an app ecosystem, but no verified Vietnam-specific Decree 123 and VAT-filing connector was identified in this scan. [M5]                                       | Supports invoicing and payments in more than 160 currencies, including foreign-currency transactions and exchange-rate handling. [M6]                                               | **Needs further verification** |
| **Zoho Books**        | Provides country-specific VAT and e-invoicing features in several markets, but the reviewed official material did not establish a Vietnam edition or verified Decree 123/Vietnam VAT connector. [M7]                            | Supports multicurrency transactions, foreign-customer invoicing, multiple branches, and multiple organizations. Native cross-organization consolidation requires verification. [M8] | **Needs further verification** |
| **Oracle NetSuite**   | Provides Vietnam VAT Return functionality. A Vietnam e-invoicing integration path through local implementation partners/providers was identified, but scope and certification must be contractually verified. [M9][M10]       | NetSuite OneWorld supports subsidiary base currencies, foreign-currency customer/vendor transactions, and consolidated financial reporting across subsidiaries and countries. [M11] | **Primary candidate**          |
| **Odoo**              | Has an official Vietnam fiscal localization and official SInvoice integration for Vietnamese e-invoices; the localization also includes tax-reporting support. [M12]                                                            | Supports foreign-currency accounting, multi-company operation, and consolidated financial reporting. [M13]                                                                          | **Primary candidate**          |

### Vietnam-native platforms with international transaction capability

| **Platform**        | **Vietnam compliance**                                                                                                                                                                                           | **International capability**                                                                                                                            | **Classification**             |
|---------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------|
| **MISA SME.VN**     | Connects with MISA meInvoice for electronic invoices under Decree 123 and supports VAT declarations/submission through MISA mTax or export to HTKK. [M14]                                                      | Supports export sales, foreign-currency accounting, exchange-rate processing, and consolidated statements for independently accounted branches. [M15] | **Primary candidate**          |
| **FAST Accounting** | FAST accounting/ERP products integrate with Fast e-Invoice and include VAT return and related tax-reporting functions. [M16]                                                                                   | Supports export transactions, foreign-currency invoices and receivables, and exchange-rate accounting. [M17]                                          | **Primary candidate**          |
| **BRAVO 8**         | Supports integration with Vietnamese e-invoice providers and documents Decree 123-related functionality. Current VAT filing scope and full compliance with later amendments require vendor verification. [M18] | Documentation covers export invoices, import transactions, foreign-exchange revaluation, and consolidated financial statements. [M19]                 | **Needs further verification** |

### Screening outcome

- Primary candidates for the next evaluation round: Oracle NetSuite, Odoo, MISA SME.VN, and FAST Accounting.

- Needs further verification: QuickBooks Online, Xero, Zoho Books, and BRAVO 8.

- Disqualified from the Vietnam production shortlist: Wave Apps.

The next evaluation round should validate jewelry-manufacturing requirements rather than repeat broad accounting research: BOM and precious-material costing, work-in-progress, lot/serial traceability, gold-weight variance, multi-warehouse operations, production-order invoicing, local e-invoice compliance, and integration APIs.

---

## Regulatory and evaluation context for primary candidates

*Oracle NetSuite, Odoo, MISA SME, and FAST Accounting — benchmarked against QuickBooks Online*

Research date: 14 July 2026

Business context: accounting and ERP selection for an export-oriented jewelry manufacturer requiring Vietnam compliance, international transactions, production integration, and strong data governance.

Baseline: the QuickBooks Online findings in Sections 1–5 of this document are reused as the benchmark. The four platforms classified as Primary Candidates in the market scan are evaluated through the full five-step STORM methodology.

### Important legal and regulatory update

The earlier screening referenced Decree 123/2020/ND-CP and Decree 70/2025/ND-CP. From 1 July 2026, Decree 254/2026/ND-CP became the current framework implementing the 2025 Tax Administration Law for electronic invoices and electronic documents. A platform’s historical compliance with Decree 123 or Decree 70 does not, by itself, prove current compliance with Decree 254. [S1]

For personal-data protection, Decree 13/2023/ND-CP remains relevant background, but new projects must also be assessed against the Personal Data Protection Law 91/2025/QH15 and its 2025 implementing framework, effective from 1 January 2026. [S2]

Accounting-document retention must be governed by Vietnamese accounting law and Decree 174/2016/ND-CP. Vendor backup or disaster recovery is not equivalent to a legally adequate retention, integrity, access, and presentation policy. [S3]

---

## Consolidated primary-candidate knowledge base

| **Knowledge area**             | **NetSuite**                                                    | **Odoo**                                                                      | **MISA SME**                                                   | **FAST Accounting**                                                                          |
|--------------------------------|-----------------------------------------------------------------|-------------------------------------------------------------------------------|----------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| **Vietnam e-invoice**          | BTM/local connector to providers such as SInvoice or meInvoice. | Official Viettel SInvoice integration.                                        | Direct MISA SME → meInvoice integration.                       | Direct Fast Accounting → Fast e-Invoice integration.                                         |
| **Decree 254/2026 evidence**   | Not verified in the reviewed documentation.                     | Not verified for the reviewed SInvoice connector documentation.               | Specific 2026 product and meInvoice updates identified.        | Vendor legal updates identified; exact production release and workflow still require a demo. |
| **Vietnam VAT**                | Vietnam VAT Return reports; direct filing not verified.         | Tax return reports; direct filing not verified.                               | mTax/eTax/HTKK workflow is the clearest among candidates.      | Tax reports available; direct filing not verified.                                           |
| **Document retention**         | Cloud backup; legal archive and export policy must be designed. | Cloud or self-hosted; legal retention remains a customer-control requirement. | Local database allows customer-controlled retention.           | Local server deployment allows customer-controlled retention.                                |
| **Data residency**             | Cloud; exact tenant location not verified.                      | Cloud region or self-hosted in Vietnam.                                       | Main SQL Server database can remain at CTYHP.                  | Desktop/server database can remain at CTYHP.                                                 |
| **Multi-currency**             | Strong.                                                         | Strong.                                                                       | Supported.                                                     | Supported.                                                                                   |
| **Multi-entity consolidation** | Strongest through OneWorld.                                     | Multi-company and consolidation available.                                    | Mainly company/branch; multi-country not verified.             | Multi-country consolidation not verified.                                                    |
| **Manufacturing ERP**          | Strong enterprise manufacturing and supply chain.               | Strong modular MRP/Inventory/Quality/PLM.                                     | Accounting and costing oriented; not a full manufacturing ERP. | Production accounting and costing; not verified as a full global ERP.                        |
| **Public API**                 | SuiteTalk REST, OAuth, English documentation.                   | External APIs and complete developer framework, English documentation.        | MISA SME-specific public API not verified.                     | Project integrations exist; public developer portal not verified.                            |
| **Next.js/Supabase fit**       | High.                                                           | Very high, especially self-hosted or Odoo.sh.                                 | Medium to low unless the vendor supplies an API/connector.     | Medium; likely vendor-led.                                                                   |
| **Public VND pricing**         | No.                                                             | No; prices published in USD.                                                  | Yes.                                                           | Yes.                                                                                         |
| **License model**              | SaaS subscription plus modules and services.                    | Subscription; cloud or self-hosted.                                           | Annual or one-time license.                                    | Packaged license with separate services.                                                     |
| **Implementation cost**        | Quotation-based and potentially high.                           | Published service packs plus partner customization.                           | Lower entry cost; customization is separate.                   | Training price published; customization and integration quoted separately.                   |

---

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)
