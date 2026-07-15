# Research Perspectives

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)

Research lenses and question frameworks used to avoid evaluating platforms only by features or price.

## Wave Apps and QuickBooks Online perspectives

Four independent perspectives are applied to both Wave Apps and QuickBooks Online to avoid evaluating the products only through accounting features or price.

### 1.1 Wave Apps

| **Perspective**              | **ID** | **Research question**                                                                                 |
|------------------------------|--------|-------------------------------------------------------------------------------------------------------|
| Accounting/Compliance Expert | W-A1   | To what extent can Wave customize account types, account numbers, and subaccounts?                    |
| Accounting/Compliance Expert | W-A2   | How does Wave account for sales tax/VAT, and does it support compliance in Vietnam?                   |
| Accounting/Compliance Expert | W-A3   | How do bank import, matching, and reconciliation operate?                                             |
| Accounting/Compliance Expert | W-A4   | Are audit trail, period lock, and user permissions sufficient for internal control?                   |
| Product/UX Analyst           | W-P1   | What is the estimate/quote → invoice → deposit/payment workflow, and is progress invoicing available? |
| Product/UX Analyst           | W-P2   | Does it support recurring invoices, reminders, statuses, and online payment?                          |
| Product/UX Analyst           | W-P3   | How do dashboard, mobile, receipt capture, and reporting support daily users?                         |
| Product/UX Analyst           | W-P4   | Can invoices link to production orders, BOMs, or warehouse movements?                                 |
| Integration Architect        | W-I1   | Is there a public API; what authentication model and entities are covered?                            |
| Integration Architect        | W-I2   | Can the API read raw pending bank-feed transactions?                                                  |
| Integration Architect        | W-I3   | What webhooks, automation, Google Sheets, or export capabilities exist?                               |
| Integration Architect        | W-I4   | How is multi-currency modeled and what are the limits?                                                |
| Business/Pricing Analyst     | W-B1   | What are the current plans, prices, and core features?                                                |
| Business/Pricing Analyst     | W-B2   | What target segment and countries are officially supported?                                           |
| Business/Pricing Analyst     | W-B3   | How are payroll, receipt OCR, and payment processing priced?                                          |
| Business/Pricing Analyst     | W-B4   | Can any Wave plan be officially operated by CTYHP in Vietnam?                                         |

### 1.2 QuickBooks Online

| **Perspective**              | **ID** | **Research question**                                                                        |
|------------------------------|--------|----------------------------------------------------------------------------------------------|
| Accounting/Compliance Expert | Q-A1   | How far can QBO customize COA, account numbers, subaccounts, and account volume?             |
| Accounting/Compliance Expert | Q-A2   | How does QBO support GST/VAT/sales tax, and what is its compliance position in Vietnam?      |
| Accounting/Compliance Expert | Q-A3   | How are bank feeds, matching, reconciliation, and manual imports organized?                  |
| Accounting/Compliance Expert | Q-A4   | Are audit log, book close/lock, and user permissions sufficient for internal control?        |
| Product/UX Analyst           | Q-P1   | How is the estimate → progress invoice → payment workflow organized?                         |
| Product/UX Analyst           | Q-P2   | Does it support recurring invoices, reminders, invoice status, and online payments?          |
| Product/UX Analyst           | Q-P3   | How do dashboard, mobile workflow, and management reporting operate?                         |
| Product/UX Analyst           | Q-P4   | Are inventory, projects, class/location, and custom fields sufficient for production orders? |
| Integration Architect        | Q-I1   | Which protocols and business entities are covered by the Accounting API?                     |
| Integration Architect        | Q-I2   | Can the API read transactions in Bank transactions — For Review?                             |
| Integration Architect        | Q-I3   | Are OAuth, webhooks, sandbox, automation, and an app ecosystem available?                    |
| Integration Architect        | Q-I4   | How is multi-currency implemented and what constraints apply?                                |
| Business/Pricing Analyst     | Q-B1   | What are current QBO plans, prices, and user limits?                                         |
| Business/Pricing Analyst     | Q-B2   | What is the target segment of each plan, and how relevant is it to manufacturing?            |
| Business/Pricing Analyst     | Q-B3   | Is Vietnam payroll native or add-on based, and what does it cost?                            |
| Business/Pricing Analyst     | Q-B4   | Which plan is closest to CTYHP’s needs and what must be validated before purchase?           |

---

## Primary-candidate STORM framework

The following question set is applied consistently to NetSuite, Odoo, MISA SME, and FAST Accounting. It extends the earlier Wave/QBO perspectives with Vietnam regulatory compliance and data-residency analysis.

| **Perspective**                       | **Code** | **Research question**                                                                                                      |
|---------------------------------------|----------|----------------------------------------------------------------------------------------------------------------------------|
| **Accounting & Manufacturing Expert** | A1       | How deeply does the platform support COA, GL, AR, AP, inventory, and bank reconciliation?                                  |
| **Accounting & Manufacturing Expert** | A2       | Does it support BOM, production orders, WIP, production costing, lot/serial traceability, and warehouses?                  |
| **Accounting & Manufacturing Expert** | A3       | Can it handle weight-based materials, multiple units of measure, scrap, recovery, and material variance?                   |
| **Accounting & Manufacturing Expert** | A4       | Does it support multi-currency, foreign-customer transactions, and multi-entity or multi-country consolidation?            |
| **Product/UX Analyst**                | P1       | How is the quote → sales order → production → delivery → invoice → payment workflow organized?                             |
| **Product/UX Analyst**                | P2       | Are dashboards and reports available by order, product, production line, stage, branch, or entity?                         |
| **Product/UX Analyst**                | P3       | Does it support approvals, role-based permissions, and audit history?                                                      |
| **Product/UX Analyst**                | P4       | Does it support Vietnamese and English users and multi-country operations?                                                 |
| **Regulatory/Compliance Expert**      | R1       | Is Vietnam e-invoicing connected directly to the tax authority or through a verified third-party provider?                 |
| **Regulatory/Compliance Expert**      | R2       | Is there verified evidence of readiness for Decree 254/2026/ND-CP?                                                         |
| **Regulatory/Compliance Expert**      | R3       | Can the platform prepare, export, or submit Vietnamese VAT returns?                                                        |
| **Regulatory/Compliance Expert**      | R4       | Does it provide audit, period locking, and document-retention controls compatible with Vietnamese accounting requirements? |
| **Data Residency Expert**             | D1       | Where is customer and transaction data stored: Vietnam-based infrastructure or overseas data centers?                      |
| **Data Residency Expert**             | D2       | Can the product be deployed on-premise or on infrastructure selected by CTYHP?                                             |
| **Data Residency Expert**             | D3       | Is sufficient information available to assess cross-border personal-data transfers?                                        |
| **Data Residency Expert**             | D4       | Are DPA, backup, export, restoration, and deletion processes documented?                                                   |
| **Integration Architect**             | I1       | Are public APIs, SDKs, OAuth, webhooks, and English developer documentation available?                                     |
| **Integration Architect**             | I2       | How well does it fit a Next.js, TypeScript, Supabase, and Vercel architecture?                                             |
| **Integration Architect**             | I3       | Can it integrate with CTYHP order management, BOM/pricing, production tracking, and warehouse systems?                     |
| **Integration Architect**             | I4       | Is integration real-time and API-based, or primarily dependent on manual Excel import/export?                              |
| **Business/Pricing Analyst**          | B1       | Is pricing published in VND, or available only through quotation?                                                          |
| **Business/Pricing Analyst**          | B2       | Is licensing perpetual, subscription-based, or hybrid?                                                                     |
| **Business/Pricing Analyst**          | B3       | Are initial implementation, migration, training, and customization costs published?                                        |
| **Business/Pricing Analyst**          | B4       | What additional costs may arise from localization, API access, hosting, upgrades, support, and maintenance?                |

---

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)
