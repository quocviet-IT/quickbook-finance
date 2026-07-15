# Comparative Report

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)

Consolidated comparison of Wave, QuickBooks Online, Oracle NetSuite, Odoo, MISA SME, and FAST Accounting. Architecture, gaps, recommendations, and roadmap are separated into dedicated files.

## Comparative-report outlines

### Wave/QBO comparison outline

#### Feature overview

- Accounting core scope

- Banking and reconciliation

- Estimate/invoice/payment workflow

- Reporting and management dimensions

- API, automation, and availability

- Consolidated comparison table

### 2. Technical Architecture and Integration

- API and authentication

- Webhook/event architecture

- Bank-feed integration limits

- Mapping to the CTYHP stack

- Recommended integration architecture

### 3. Pricing and Target Segment

- Wave Starter/Pro

- QBO plans

- Geographic availability

- Subscription and total cost of ownership

### 4. Gap Analysis

- Bank reconciliation

- Production-order invoicing

- BOM/production/warehouse integration

- Custom production reporting

- Vietnam compliance

- Data ownership and exit risk

### 5. Build vs Buy Recommendation

- Buy Wave

- Buy QBO

- Build full accounting

- Hybrid model

- PoC and go/no-go gates

---

### Primary-candidate comparison outline

**1. Regulatory and Vietnam Compliance**

- E-invoicing architecture

- Decree 254/2026 readiness

- VAT filing

- Accounting-document retention

- Audit and period controls

**2. Data Residency and Personal Data Protection**

- Hosting model

- Vietnam-local deployment

- Overseas data transfer

- Backup, export, restoration, and deletion

- Requirements under the current personal-data framework

**3. Functional and International Capability**

- Accounting core

- Multi-currency

- Export and foreign-customer invoicing

- Multi-company consolidation

- Jewelry-manufacturing requirements

**4. Technical Architecture and Integration**

- API and authentication

- Webhooks and asynchronous integration

- Compatibility with Next.js, Supabase, and Vercel

- Master-data ownership and migration

- Integration risks

**5. Pricing and Total Cost of Ownership**

- Subscription and license

- Localization

- Implementation and customization

- Support and upgrades

- Five-year TCO requirements

**6. Gap Analysis for CTYHP**

- Banking

- Production-order invoicing

- Precious-metal accounting

- BOM, WIP, and warehouse

- Production-line reporting

**7. Updated Recommendation**

- Preferred PoC platform

- Enterprise alternative

- Local accounting alternatives

- Proposed implementation architecture

- Go/no-go criteria

---

## Wave Apps vs QuickBooks Online

### Feature overview

| **Criterion**        | **Wave Apps**                                                              | **QuickBooks Online**                                                                                  | **Implication for CTYHP**                                                       |
|----------------------|----------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| Vietnam availability | Officially supports US/Canada businesses only. **[W2]**                  | Global product; Vietnam not listed for bank feeds and commercial details need confirmation. **[Q2]** | Wave is excluded from production; QBO requires PoC and commercial confirmation. |
| Chart of Accounts    | No subaccounts or custom account types. **[W5]**                         | Subaccounts/account numbers with plan limits. **[Q4][Q1]**                                         | QBO is stronger for accounting control.                                         |
| Tax/compliance       | Sales tax/reporting; Vietnam VAT/e-invoice not confirmed. **[W6][W7]** | GST/VAT/tax setup; Vietnam filing/e-invoice not confirmed. **[Q5]**                                  | A local compliance layer or partner is required.                                |
| Audit/period close   | Granular audit and period lock not confirmed.                              | Audit log and book lock are available. **[Q6][Q7]**                                                | QBO materially reduces custom control scope.                                    |
| Bank feed            | Plaid in US/Canada. **[W4]**                                             | Automatic feeds in multiple countries; Vietnam not confirmed. **[Q2]**                               | Do not rely on SaaS as CTYHP’s raw bank-data source.                            |
| Raw bank-feed API    | Not confirmed.                                                             | For Review is not exposed. **[Q13][Q14]**                                                          | Build bank ingestion/reconciliation internally.                                 |
| Invoice workflow     | Estimate, invoice, deposits, recurring, reminders. **[W9][W10]**       | Estimate, progress invoices, recurring, reminders. **[Q3]**                                          | QBO is closer to progress billing.                                              |
| Production context   | poNumber is available but no production entities. **[W12]**              | Inventory/projects/class/location; no confirmed BOM/MRP. **[Q1]**                                    | Keep production lineage in Supabase.                                            |
| Reporting            | Standard finance/tax/AR/AP/tag reports. **[W11]**                        | Standard + project/class + Advanced custom reports. **[Q1]**                                         | Custom production reporting still must be built.                                |
| API                  | GraphQL/OAuth/webhooks/Sheets. **[W12][W14][W15]**                   | REST/GraphQL/OAuth/sandbox/webhooks/SDK. **[Q9]**-**[Q12]**                                        | QBO fits the TypeScript stack better.                                           |
| Pricing              | USD 0/19 but unsuitable region. **[W1][W2]**                           | USD 38–275 snapshot from the Global page. **[Q1]**                                                   | Evaluate total cost of ownership, not subscription alone.                       |

### Consolidated assessment

Wave has a simpler product architecture and is useful as a UX reference for estimates/invoices, reminders, receipts, and dashboards. However, regional availability, COA depth, and its control model make it unsuitable as CTYHP’s primary accounting platform. **[W2][W5]**

QBO has a more mature accounting-control and extensibility architecture: hierarchical COA, audit log, period lock, project/class/location, inventory, API, OAuth, and sandbox. **[Q4][Q6][Q7][Q9]**-**[Q12]**

No verified evidence shows that QBO is a complete manufacturing ERP. Inventory, purchase orders, and projects do not replace BOM versioning, routing, work-center costing, production batches, or warehouse movement lineage.

### Pricing model and target segment

| **Plan**         | **Price snapshot**           | **Core scope**                                 | **Assessment**                                |
|------------------|------------------------------|------------------------------------------------|-----------------------------------------------|
| Wave Starter     | USD 0                        | Unlimited estimates/invoices/bills/bookkeeping | US/Canada businesses only.                    |
| Wave Pro         | USD 19/month or USD 190/year | Bank automation, OCR, reminders                | Not a production option for CTYHP.            |
| QBO Simple Start | USD 38/month                 | 1 user, accounting foundation                  | Global snapshot; Vietnam must be confirmed.   |
| QBO Essentials   | USD 75/month                 | 3 users, bills, multicurrency                  | No inventory/projects.                        |
| QBO Plus         | USD 115/month                | 5 users, inventory, projects, class/location   | Closest functional baseline.                  |
| QBO Advanced     | USD 275/month                | 25 users, custom roles/reports/workflows       | Better when control/reporting needs are high. |

Total cost of ownership must include subscription, regional and compliance risk, bank integration, API implementation, production integration, custom reporting, audit/close controls, and exit/data migration. Wave is inexpensive but creates little value if it cannot be operated officially; QBO costs more but can reduce the risk of building a double-entry ledger, AR/AP, audit, and period close from scratch.

---

## Primary-candidate regulatory, data-residency, and functional comparison

### Regulatory and Vietnam compliance

| **Platform**          | **E-invoice path**                                                                  | **Decree 254 status**                                          | **VAT path**                                                  | **Assessment**                                                                  |
|-----------------------|-------------------------------------------------------------------------------------|----------------------------------------------------------------|---------------------------------------------------------------|---------------------------------------------------------------------------------|
| **QuickBooks Online** | No verified Vietnam-specific e-invoice or VAT filing path in the baseline research. | Not established.                                               | Not verified.                                                 | Not suitable as the primary Vietnam statutory-accounting platform. [Q5][M1] |
| **Oracle NetSuite**   | Partner/localization connector to a local e-invoice provider.                       | Not verified in reviewed product documentation.                | Vietnam VAT Return available; direct submission not verified. | Conditional; legal and vendor confirmation required. [S6]                     |
| **Odoo**              | Official Vietnam localization and Viettel SInvoice integration.                     | Current connector readiness not verified.                      | Tax return reports available; direct submission not verified. | Conditional; connector version and filing workflow require PoC. [S11]         |
| **MISA SME**          | MISA SME connects directly with meInvoice.                                          | Specific 2026 updates were identified.                         | mTax/eTax/HTKK workflow is available.                         | Strongest current compliance evidence. [S18][S19]                           |
| **FAST Accounting**   | Connects to Fast e-Invoice.                                                         | Vendor updates identified; exact release workflow needs proof. | Tax reports available; direct filing not verified.            | Viable, subject to live Decree 254 demonstration. [S25][S26]                |

Compliance conclusion: MISA SME has the clearest current evidence. Odoo, NetSuite, and FAST have viable integration paths, but CTYHP should not accept general claims such as “Vietnam localization” without a release version, supported-process list, live invoice demonstration, support commitment, and contractual obligation to update the product when regulations change.

### Data residency and personal-data protection

| **Platform**          | **Primary hosting model**                                         | **Vietnam-local database possible?**                 | **Data-residency assessment**                                                  |
|-----------------------|-------------------------------------------------------------------|------------------------------------------------------|--------------------------------------------------------------------------------|
| **QuickBooks Online** | Overseas SaaS; exact tenant location not established in baseline. | No normal on-premise option.                         | High cross-border dependency; DPA and transfer assessment required.            |
| **Oracle NetSuite**   | Oracle cloud SaaS; exact account region not verified.             | No normal on-premise deployment.                     | Data-center and cross-border terms must be contractually confirmed.            |
| **Odoo**              | Odoo Online/Odoo.sh cloud or self-hosted.                         | Yes, self-hosting can place the database in Vietnam. | Best global-platform residency flexibility.                                    |
| **MISA SME**          | SQL Server on company-controlled infrastructure.                  | Yes.                                                 | Good for local ledger data; cloud connectors still require a data-flow review. |
| **FAST Accounting**   | Desktop/LAN server or online product.                             | Yes for the on-premise edition.                      | Good if on-premise is selected; cloud region must be verified.                 |

Keeping a database in Vietnam is not, by itself, complete personal-data compliance. CTYHP must still document controller/processor roles, purposes and legal bases, subprocessors, cross-border flows, retention periods, access controls, incident response, deletion, and support access. [S2]

### Functional and international capability

| **Platform**          | **Manufacturing**                                                       | **International transactions**                 | **Multi-entity**                           | **Jewelry-specific gap**                                                                         |
|-----------------------|-------------------------------------------------------------------------|------------------------------------------------|--------------------------------------------|--------------------------------------------------------------------------------------------------|
| **QuickBooks Online** | Inventory/project accounting; not an MRP platform.                      | Multi-currency supported.                      | Limited compared with enterprise ERP.      | Most production functions must remain in CTYHP systems.                                          |
| **Oracle NetSuite**   | Strong BOM, work orders, inventory, and supply-chain capability.        | Strong.                                        | Strongest through OneWorld.                | Jewelry costing, precious-metal, stone, scrap, and assay rules need configuration/customization. |
| **Odoo**              | Strong MRP, Inventory, Quality, PLM, Sales, and Accounting integration. | Strong.                                        | Multi-company and consolidation supported. | Jewelry workflows require custom modules but are technically feasible.                           |
| **MISA SME**          | Accounting, inventory, and production costing.                          | Export and foreign currency supported.         | Mainly company/branch.                     | Not a full operational manufacturing ERP.                                                        |
| **FAST Accounting**   | Production accounting and costing.                                      | Export, foreign receivables, and FX supported. | Not verified for global consolidation.     | Operational manufacturing and traceability require additional systems or customization.          |

### Jewelry-manufacturing PoC scenarios

1.  Raw gold by karat/purity and actual weight.

2.  Fine-gold-equivalent calculation.

3.  Gram, ounce, piece, and unit conversions.

4.  Multi-level BOM covering metal, stones, findings, and direct labor.

5.  Material issue to a production order and return of unused material.

6.  Scrap, recovery, refining return, and process loss.

7.  Stone lot, certificate, and serial traceability.

8.  Planned cost versus actual cost and WIP by operation.

9.  Invoice by shipment, milestone, or production order.

10. Export invoice, foreign-currency receivable, and realized/unrealized FX differences.

11. Gross margin by order, product family, production line, batch, and customer.

### Pricing and total cost of ownership

| **Platform**          | **Pricing visibility**                                                                                                 | **License model**                                | **Major additional cost areas**                                                       |
|-----------------------|------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------|---------------------------------------------------------------------------------------|
| **QuickBooks Online** | Published USD monthly subscription by plan.                                                                            | SaaS subscription.                               | Vietnam compliance and manufacturing remain external costs.                           |
| **Oracle NetSuite**   | No public VND pricing.                                                                                                 | SaaS subscription, modules, users, and services. | Localization, manufacturing, migration, integration, and support are quotation-based. |
| **Odoo**              | Published per-user prices in USD.                                                                                      | Subscription; cloud or self-hosted.              | Custom plan, hosting, implementation packs, partner work, and jewelry modules.        |
| **MISA SME**          | Published VND pricing; approximately VND 4.65m/year or VND 8.85m one-time for a referenced Standard tier.              | Annual or one-time license.                      | meInvoice, mTax, eSign, invoice volume, training, and customization may be separate.  |
| **FAST Accounting**   | Published VND pricing; manufacturing package approximately VND 11.9m plus about VND 4.45m initial training/consulting. | Packaged license plus services.                  | Customization, integration, support, and upgrades must be quoted.                     |

The RFP should request a minimum five-year TCO covering user licenses, accounting and manufacturing modules, hosting, Vietnam localization, e-invoice volume, digital signatures, data migration, API integration, custom reports, training, support SLA, upgrades, backup, disaster recovery, test environments, annual maintenance, and exit/export assistance.

---

## Final consolidated comparison

| **Platform**          | **Vietnam compliance**                                              | **International capability**                              | **Manufacturing**                 | **Data residency**                              | **Integration**                   | **Pricing / TCO**                                        | **Updated recommendation**                |
|-----------------------|---------------------------------------------------------------------|-----------------------------------------------------------|-----------------------------------|-------------------------------------------------|-----------------------------------|----------------------------------------------------------|-------------------------------------------|
| **QuickBooks Online** | Weak; no verified Vietnam e-invoice/VAT path.                       | Multi-currency; limited multi-entity.                     | Low.                              | Overseas SaaS; no on-premise.                   | Strong accounting API.            | USD subscription; compliance and manufacturing external. | Do not retain on final shortlist.         |
| **Oracle NetSuite**   | VAT reports and partner localization; Decree 254 must be confirmed. | Very strong OneWorld and consolidation.                   | Strong.                           | Overseas cloud; exact region must be confirmed. | Very strong.                      | Quotation-based; high implementation cost.               | Enterprise alternative.                   |
| **Odoo**              | Vietnam localization + SInvoice; Decree 254 must be confirmed.      | Strong multi-company and multi-currency.                  | Strong and flexible.              | Cloud region or self-host in Vietnam.           | Very strong.                      | USD subscription plus implementation/customization.      | Preferred PoC candidate.                  |
| **MISA SME**          | Strongest current evidence; meInvoice + mTax.                       | Export/FX supported; international consolidation limited. | Accounting/costing, not full ERP. | Can keep SQL Server in Vietnam.                 | MISA SME public API not verified. | Low, transparent VND pricing.                            | Compliance-first/statutory candidate.     |
| **FAST Accounting**   | Fast e-Invoice and legal updates; Decree 254 demo required.         | Export/FX supported; multi-country unclear.               | Strong production costing.        | Can deploy on a Vietnam server.                 | Vendor-led/custom integration.    | Transparent VND entry pricing.                           | Local manufacturing-accounting candidate. |

---

## Appendix — Reference Sources

The [W#], [Q#], and [M#] references correspond to the original Wave/QBO research, the market scan, and the additional QuickBooks evidence review. The [S#] references support the full STORM evaluation of the Primary Candidates.

| **ID**  | **Platform / domain**      | **Source name**                                                | **URL / document**                                                                                                                                                                                                                                                                                                                | **Use in research**                                                                                |
|---------|----------------------------|----------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| **W1**  | Wave                       | Wave Pricing                                                   | [https://www.waveapps.com/pricing](https://www.waveapps.com/pricing)                                                                                                                                                                                                                                                       | Plans, price, bank automation, receipts, payments                                                  |
| **W2**  | Wave                       | Changes for users outside US and Canada                        | [https://support.waveapps.com/hc/en-us/articles/27277914806804-Changes-for-Wave-users-outside-the-United-States-and-Canada](https://support.waveapps.com/hc/en-us/articles/27277914806804-Changes-for-Wave-users-outside-the-United-States-and-Canada)                                                                     | Regional availability and compliance warning                                                       |
| **W3**  | Wave                       | Add a new business                                             | [https://support.waveapps.com/hc/en-us/articles/208624306-Add-a-new-business-to-your-Wave-account](https://support.waveapps.com/hc/en-us/articles/208624306-Add-a-new-business-to-your-Wave-account)                                                                                                                       | US/Canada business availability                                                                    |
| **W4**  | Wave                       | Supported account types for bank connections                   | [https://support.waveapps.com/hc/en-us/articles/360031202851-Supported-account-types-for-bank-connections](https://support.waveapps.com/hc/en-us/articles/360031202851-Supported-account-types-for-bank-connections)                                                                                                       | Plaid and bank connection scope                                                                    |
| **W5**  | Wave                       | Overview of your Chart of Accounts                             | [https://support.waveapps.com/hc/en-us/articles/115004972106-Overview-of-your-Chart-of-Accounts-page](https://support.waveapps.com/hc/en-us/articles/115004972106-Overview-of-your-Chart-of-Accounts-page)                                                                                                                 | COA customization and subaccount limits                                                            |
| **W6**  | Wave                       | How sales tax is tracked and calculated                        | [https://support.waveapps.com/hc/en-us/articles/360039628292-How-sales-tax-is-tracked-and-calculated-in-Wave](https://support.waveapps.com/hc/en-us/articles/360039628292-How-sales-tax-is-tracked-and-calculated-in-Wave)                                                                                                 | Sales tax accounting                                                                               |
| **W7**  | Wave                       | View and understand your Sales Tax Report                      | [https://support.waveapps.com/hc/en-us/articles/208623466-View-and-understand-your-sales-tax-report](https://support.waveapps.com/hc/en-us/articles/208623466-View-and-understand-your-sales-tax-report)                                                                                                                   | Tax reporting                                                                                      |
| **W8**  | Wave                       | Reconcile your books                                           | [https://support.waveapps.com/hc/en-us/articles/38599574877332-Reconcile-your-books](https://support.waveapps.com/hc/en-us/articles/38599574877332-Reconcile-your-books)                                                                                                                                                   | Reconciliation workflow                                                                            |
| **W9**  | Wave                       | Convert an estimate to an invoice                              | [https://support.waveapps.com/hc/en-us/articles/208621756-Convert-an-estimate-to-an-invoice](https://support.waveapps.com/hc/en-us/articles/208621756-Convert-an-estimate-to-an-invoice)                                                                                                                                   | Estimate-to-invoice workflow                                                                       |
| **W10** | Wave                       | Schedule invoice payment reminders                             | [https://support.waveapps.com/hc/en-us/articles/208621676-Schedule-invoice-payment-reminders](https://support.waveapps.com/hc/en-us/articles/208621676-Schedule-invoice-payment-reminders)                                                                                                                                 | Reminder automation                                                                                |
| **W11** | Wave                       | Overview of the Reports page                                   | [https://support.waveapps.com/hc/en-us/articles/115005085723-Overview-of-the-Reports-page](https://support.waveapps.com/hc/en-us/articles/115005085723-Overview-of-the-Reports-page)                                                                                                                                       | Financial, tax, AR/AP and tag reports                                                              |
| **W12** | Wave                       | Wave API Reference                                             | [https://developer.waveapps.com/hc/en-us/articles/360019968212-API-Reference](https://developer.waveapps.com/hc/en-us/articles/360019968212-API-Reference)                                                                                                                                                                 | GraphQL entities and invoice fields                                                                |
| **W13** | Wave                       | OAuth Guide                                                    | [https://developer.waveapps.com/hc/en-us/articles/360019493652-OAuth-Guide](https://developer.waveapps.com/hc/en-us/articles/360019493652-OAuth-Guide)                                                                                                                                                                     | OAuth 2 and entitlement                                                                            |
| **W14** | Wave                       | Webhooks Setup Guide                                           | [https://developer.waveapps.com/hc/en-us/articles/51070420388628-Webhooks-Setup-Guide](https://developer.waveapps.com/hc/en-us/articles/51070420388628-Webhooks-Setup-Guide)                                                                                                                                               | Webhook events, TLS, signatures and retry                                                          |
| **W15** | Wave                       | Wave Connect with Google Sheets                                | [https://support.waveapps.com/hc/en-us/articles/360020768272-Install-and-link-Wave-Connect-with-Google-Sheets](https://support.waveapps.com/hc/en-us/articles/360020768272-Install-and-link-Wave-Connect-with-Google-Sheets)                                                                                               | Google Sheets import/export                                                                        |
| **W16** | Wave                       | Create a foreign currency invoice or bill                      | [https://support.waveapps.com/hc/en-us/articles/360035158192-Create-a-foreign-currency-invoice-or-bill](https://support.waveapps.com/hc/en-us/articles/360035158192-Create-a-foreign-currency-invoice-or-bill)                                                                                                             | Foreign-currency accounting                                                                        |
| **W17** | Wave                       | Wave Payroll                                                   | [https://www.waveapps.com/payroll](https://www.waveapps.com/payroll)                                                                                                                                                                                                                                                       | Payroll scope and regional service                                                                 |
| **Q1**  | QBO                        | QuickBooks Online Global Pricing                               | [https://quickbooks.intuit.com/global/pricing/](https://quickbooks.intuit.com/global/pricing/)                                                                                                                                                                                                                             | Plans, price, users and feature matrix                                                             |
| **Q2**  | QBO                        | QuickBooks Global Bank Feeds                                   | [https://quickbooks.intuit.com/global/bank-feeds/](https://quickbooks.intuit.com/global/bank-feeds/)                                                                                                                                                                                                                       | Bank coverage and country list                                                                     |
| **Q3**  | QBO                        | QuickBooks Global Invoicing                                    | [https://quickbooks.intuit.com/global/invoicing/](https://quickbooks.intuit.com/global/invoicing/)                                                                                                                                                                                                                         | Estimate, invoice, progress invoicing and reminders                                                |
| **Q4**  | QBO                        | Create subaccounts in your Chart of Accounts                   | [https://quickbooks.intuit.com/learn-support/en-us/help-article/chart-accounts/create-subaccounts-chart-accounts-quickbooks/L7NLrY7cd_US_en_US](https://quickbooks.intuit.com/learn-support/en-us/help-article/chart-accounts/create-subaccounts-chart-accounts-quickbooks/L7NLrY7cd_US_en_US)                             | COA hierarchy and subaccounts                                                                      |
| **Q5**  | QBO                        | Set up and use tax in QuickBooks Online                        | [https://quickbooks.intuit.com/learn-support/en-global/help-article/sales-taxes/set-use-sales-tax-quickbooks-online/L4Lx8eL7V_ROW_en](https://quickbooks.intuit.com/learn-support/en-global/help-article/sales-taxes/set-use-sales-tax-quickbooks-online/L4Lx8eL7V_ROW_en)                                                 | GST/VAT/sales tax setup                                                                            |
| **Q6**  | QBO                        | Use the audit log                                              | [https://quickbooks.intuit.com/learn-support/en-global/help-article/audit-log/use-audit-log-quickbooks-online/L2WoVnW6I_ROW_en](https://quickbooks.intuit.com/learn-support/en-global/help-article/audit-log/use-audit-log-quickbooks-online/L2WoVnW6I_ROW_en)                                                             | Audit history                                                                                      |
| **Q7**  | QBO                        | Lock your books                                                | [https://quickbooks.intuit.com/learn-support/en-global/help-article/close-books/close-books-quickbooks-online/L59LelyPM_ROW_en](https://quickbooks.intuit.com/learn-support/en-global/help-article/close-books/close-books-quickbooks-online/L59LelyPM_ROW_en)                                                             | Period close and lock                                                                              |
| **Q8**  | QBO                        | Set up and use Multicurrency                                   | [https://quickbooks.intuit.com/learn-support/en-global/help-article/multicurrency/set-use-multicurrency-quickbooks-online/L5krkKQi8_ROW_en](https://quickbooks.intuit.com/learn-support/en-global/help-article/multicurrency/set-use-multicurrency-quickbooks-online/L5krkKQi8_ROW_en)                                     | Multicurrency configuration and constraints                                                        |
| **Q9**  | QBO                        | Explore the QuickBooks Online Accounting API                   | [https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api)                                                                                                                                 | REST/GraphQL resources                                                                             |
| **Q10** | QBO                        | Set up OAuth 2.0                                               | [https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)                                                                                                           | OAuth, realmID and SDK context                                                                     |
| **Q11** | QBO                        | QuickBooks Online Webhooks                                     | [https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks)                                                                                                                                                                               | Event integration                                                                                  |
| **Q12** | QBO                        | QuickBooks Online Sandboxes                                    | [https://developer.intuit.com/app/developer/qbo/docs/develop/sandboxes](https://developer.intuit.com/app/developer/qbo/docs/develop/sandboxes)                                                                                                                                                                             | Integration testing                                                                                |
| **Q13** | QBO                        | Pending bank-feed transactions via API                         | [https://help.developer.intuit.com/s/question/0D5TR00001JtbjS0AR/i-want-to-fetch-bank-feed-pending-trasnactions-in-my-app-is-it-possible](https://help.developer.intuit.com/s/question/0D5TR00001JtbjS0AR/i-want-to-fetch-bank-feed-pending-trasnactions-in-my-app-is-it-possible)                                         | For Review API limitation                                                                          |
| **Q14** | QBO                        | Pull bank-feed information through API                         | [https://help.developer.intuit.com/s/question/0D5TR000001d1DZ0AY/how-do-i-use-quickbooks-api-to-pull-bank-feed-information-that-i-see-in-my-transactions-tab](https://help.developer.intuit.com/s/question/0D5TR000001d1DZ0AY/how-do-i-use-quickbooks-api-to-pull-bank-feed-information-that-i-see-in-my-transactions-tab) | Bank data available after acceptance                                                               |
| **Q15** | QBO                        | QuickBooks Online Business User Manual — Version 4, July 2022  | Uploaded file: QuickBooks_SMB_user_manual-2022.pdf                                                                                                                                                                                                                                                                                | Historical banking, matching, reconciliation, class/location and audit workflows                   |
| **M1**  | QBO                        | A practical approach to e-invoicing compliance                 | [https://quickbooks.intuit.com/global/resources/invoicing/a-practical-approach-to-e-invoicing-compliance/](https://quickbooks.intuit.com/global/resources/invoicing/a-practical-approach-to-e-invoicing-compliance/)                                                                                                       | General e-invoicing compliance approach; Vietnam coverage not established                          |
| **M2**  | QBO                        | Learn Multicurrency in QuickBooks Online                       | [https://quickbooks.intuit.com/learn-support/en-us/help-article/multicurrency/learn-multicurrency-quickbooks-online/L5krkKQi8_US_en_US](https://quickbooks.intuit.com/learn-support/en-us/help-article/multicurrency/learn-multicurrency-quickbooks-online/L5krkKQi8_US_en_US)                                             | Multicurrency and foreign-customer transactions                                                    |
| **M3**  | Wave                       | Changes for Wave users outside the United States and Canada    | [https://support.waveapps.com/hc/en-us/articles/27277914806804-Changes-for-Wave-users-outside-the-United-States-and-Canada](https://support.waveapps.com/hc/en-us/articles/27277914806804-Changes-for-Wave-users-outside-the-United-States-and-Canada)                                                                     | Regional availability and compliance limitations                                                   |
| **M4**  | Wave                       | Create a foreign currency invoice or bill                      | [https://support.waveapps.com/hc/en-us/articles/360035158192-Create-a-foreign-currency-invoice-or-bill](https://support.waveapps.com/hc/en-us/articles/360035158192-Create-a-foreign-currency-invoice-or-bill)                                                                                                             | Foreign-currency invoicing and bills                                                               |
| **M5**  | Xero                       | Send and receive invoices with e-invoicing                     | [https://central.xero.com/s/article/Send-and-receive-invoices-with-e-invoicing](https://central.xero.com/s/article/Send-and-receive-invoices-with-e-invoicing)                                                                                                                                                             | Country-specific e-invoicing availability                                                          |
| **M6**  | Xero                       | About multicurrency                                            | [https://central.xero.com/s/article/About-multicurrency](https://central.xero.com/s/article/About-multicurrency)                                                                                                                                                                                                           | Foreign currencies and exchange-rate handling                                                      |
| **M7**  | Zoho Books                 | VAT on sales                                                   | [https://www.zoho.com/books/help/vat-sales/vat-sales.html](https://www.zoho.com/books/help/vat-sales/vat-sales.html)                                                                                                                                                                                                       | Country-specific VAT capabilities                                                                  |
| **M8**  | Zoho Books                 | Zoho Books product overview                                    | [https://www.zoho.com/books/](https://www.zoho.com/books/)                                                                                                                                                                                                                                                                 | Multicurrency, branches, and multiple organizations                                                |
| **M9**  | NetSuite                   | Vietnam VAT Return                                             | [https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2047227.html](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2047227.html)                                                                                                                                                 | Vietnam VAT return and supporting reports                                                          |
| **M10** | NetSuite                   | Vietnam e-invoicing integration path                           | Vendor/implementation-partner verification required                                                                                                                                                                                                                                                                               | Local e-invoice integration path identified; certification and scope require contract verification |
| **M11** | NetSuite                   | NetSuite OneWorld and consolidated reporting                   | [https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N269257.html](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N269257.html)                                                                                                                                                   | Subsidiaries, currencies, and consolidated reporting                                               |
| **M12** | Odoo                       | Vietnam fiscal localization                                    | [https://www.odoo.com/documentation/18.0/applications/finance/fiscal_localizations/vietnam.html](https://www.odoo.com/documentation/18.0/applications/finance/fiscal_localizations/vietnam.html)                                                                                                                           | Vietnam localization, SInvoice, and tax reporting                                                  |
| **M13** | Odoo                       | Multi-currency and multi-company accounting                    | [https://www.odoo.com/documentation/19.0/applications/finance/accounting/get_started/multi_currency.html](https://www.odoo.com/documentation/19.0/applications/finance/accounting/get_started/multi_currency.html)                                                                                                         | Foreign currencies and multi-company operation                                                     |
| **M14** | MISA                       | Connect MISA SME with e-invoices under Decree 123              | [https://helpsme.misa.vn/2023/kb/ket-noi-tren-misa-sme-voi-da-co-to-khai-dang-ky-su-dung-hoa-don-dien-tu-nd-123/](https://helpsme.misa.vn/2023/kb/ket-noi-tren-misa-sme-voi-da-co-to-khai-dang-ky-su-dung-hoa-don-dien-tu-nd-123/)                                                                                         | Decree 123 e-invoice connection and tax workflow                                                   |
| **M15** | MISA                       | Export sales in MISA SME                                       | [https://helpsme.misa.vn/2023/kb/banhang_xuatkhau/](https://helpsme.misa.vn/2023/kb/banhang_xuatkhau/)                                                                                                                                                                                                                     | Export sales and foreign-currency processing                                                       |
| **M16** | FAST                       | Fast e-Invoice                                                 | [https://invoice.fast.com.vn/](https://invoice.fast.com.vn/)                                                                                                                                                                                                                                                               | Electronic invoice integration                                                                     |
| **M17** | FAST                       | Exports and foreign-currency receivables                       | [https://fa12help.fast.com.vn/index.php/categories/xuat-khau-va-cong-no-ngoai-te/](https://fa12help.fast.com.vn/index.php/categories/xuat-khau-va-cong-no-ngoai-te/)                                                                                                                                                       | Export and foreign-currency accounting                                                             |
| **M18** | BRAVO                      | Electronic invoice functionality in BRAVO                      | [https://www.bravo.com.vn/tin-tuc-chung/tin-cong-nghe/tinh-nang-hoa-don-dien-tu-tren-phan-mem-bravo/](https://www.bravo.com.vn/tin-tuc-chung/tin-cong-nghe/tinh-nang-hoa-don-dien-tu-tren-phan-mem-bravo/)                                                                                                                 | Vietnam e-invoice integration                                                                      |
| **M19** | BRAVO                      | BRAVO 8 Help                                                   | [https://bravo8help.bravo.com.vn/Home/ContentGenerator?commandKey=MainWindow_New](https://bravo8help.bravo.com.vn/Home/ContentGenerator?commandKey=MainWindow_New)                                                                                                                                                         | Export/import, foreign-exchange, and consolidation capabilities                                    |
| **S1**  | Vietnam law                | Decree 254/2026/ND-CP                                          | [https://vanban.chinhphu.vn/?docid=218689&pageid=27160](https://vanban.chinhphu.vn/?docid=218689&pageid=27160)                                                                                                                                                                                                             | Current electronic-invoice and electronic-document framework                                       |
| **S2**  | Vietnam law                | Personal Data Protection Law / current framework               | [https://vanban.chinhphu.vn/?classid=1&docid=214590&orggroupid=1&pageid=27160](https://vanban.chinhphu.vn/?classid=1&docid=214590&orggroupid=1&pageid=27160)                                                                                                                                                               | Personal-data governance and cross-border assessment                                               |
| **S3**  | Vietnam law                | Decree 174/2016/ND-CP                                          | [https://vanban.chinhphu.vn/default.aspx?docid=183198&pageid=27160](https://vanban.chinhphu.vn/default.aspx?docid=183198&pageid=27160)                                                                                                                                                                                     | Accounting-document retention and accounting-law implementation                                    |
| **S4**  | NetSuite                   | OneWorld and multi-currency documentation                      | [https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N266701.html](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N266701.html)                                                                                                                                                   | Subsidiaries, currencies, and consolidation                                                        |
| **S5**  | NetSuite                   | NetSuite OneWorld overview                                     | [https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2119691.html](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2119691.html)                                                                                                                                                 | Enterprise workflow, subsidiaries, and reporting                                                   |
| **S6**  | NetSuite                   | Vietnam VAT Return                                             | [https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2048042.html](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2048042.html)                                                                                                                                                 | Vietnam VAT reporting capability                                                                   |
| **S7**  | NetSuite                   | NetSuite backup and disaster recovery                          | [https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_31104740147.html](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_31104740147.html)                                                                                                                                           | Cloud backup and recovery                                                                          |
| **S8**  | NetSuite                   | NetSuite Vietnam                                               | [https://www.netsuite.com/portal/vn/home.shtml](https://www.netsuite.com/portal/vn/home.shtml)                                                                                                                                                                                                                             | Vietnam market presence and quotation model                                                        |
| **S9**  | NetSuite                   | SuiteTalk REST Web Services                                    | [https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157780312610.html](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157780312610.html)                                                                                                                                         | REST integration and authentication                                                                |
| **S10** | Odoo                       | Odoo business applications                                     | [https://www.odoo.com/](https://www.odoo.com/)                                                                                                                                                                                                                                                                             | Integrated accounting, sales, inventory, and manufacturing suite                                   |
| **S11** | Odoo                       | Vietnam fiscal localization                                    | [https://www.odoo.com/documentation/19.0/applications/finance/fiscal_localizations/vietnam.html](https://www.odoo.com/documentation/19.0/applications/finance/fiscal_localizations/vietnam.html)                                                                                                                           | Vietnam accounting localization and SInvoice integration                                           |
| **S12** | Odoo                       | Odoo Cloud SLA                                                 | [https://www.odoo.com/cloud-sla](https://www.odoo.com/cloud-sla)                                                                                                                                                                                                                                                           | Backup and cloud availability                                                                      |
| **S13** | Odoo                       | Odoo hosting types                                             | [https://www.odoo.com/page/hosting-types](https://www.odoo.com/page/hosting-types)                                                                                                                                                                                                                                         | Odoo Online, Odoo.sh, and self-hosting                                                             |
| **S14** | Odoo                       | External API documentation                                     | [https://www.odoo.com/documentation/18.0/developer/reference/external_api.html](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html)                                                                                                                                                             | API and developer integration                                                                      |
| **S15** | Odoo                       | Odoo Vietnam pricing                                           | [https://www.odoo.com/vi_VN/pricing](https://www.odoo.com/vi_VN/pricing)                                                                                                                                                                                                                                                   | Subscription and implementation pricing                                                            |
| **S16** | MISA                       | Export sales in MISA SME 2026                                  | [https://helpsme.misa.vn/2026/kb/banhang_xuatkhau/](https://helpsme.misa.vn/2026/kb/banhang_xuatkhau/)                                                                                                                                                                                                                     | Export transactions and foreign currency                                                           |
| **S17** | MISA                       | MISA SME reports                                               | [https://helpsme.misa.vn/2026/ac/bao-cao/](https://helpsme.misa.vn/2026/ac/bao-cao/)                                                                                                                                                                                                                                       | Accounting, inventory, costing, and reporting                                                      |
| **S18** | MISA                       | MISA SME 2026 regulatory update                                | [https://helpsme.misa.vn/2026/kb/dap-ung-cac-thay-doi-ve-thue-va-hoa-don-theo-quy-dinh-moi/](https://helpsme.misa.vn/2026/kb/dap-ung-cac-thay-doi-ve-thue-va-hoa-don-theo-quy-dinh-moi/)                                                                                                                                   | Decree 254 and current tax/e-invoice changes                                                       |
| **S19** | MISA                       | MISA mTax workflow                                             | [https://helpsme.misa.vn/2023/kb/lam-the-nao-de-su-dung-dich-vu-thue-dien-tu-misa-mtax-duoc-mien-phi-tren-goi-professional-enterprise/](https://helpsme.misa.vn/2023/kb/lam-the-nao-de-su-dung-dich-vu-thue-dien-tu-misa-mtax-duoc-mien-phi-tren-goi-professional-enterprise/)                                             | Electronic tax filing workflow                                                                     |
| **S20** | MISA                       | MISA SME SQL installation                                      | [https://helpsme.misa.vn/2026/kb/cai_dat_lai_sql/](https://helpsme.misa.vn/2026/kb/cai_dat_lai_sql/)                                                                                                                                                                                                                       | Local SQL Server deployment                                                                        |
| **S21** | MISA                       | Overview of MISA AMIS Open API                                 | [https://www.misa.vn/154117/tong-quan-open-api-amis-ke-toan-doanh-nghiep/](https://www.misa.vn/154117/tong-quan-open-api-amis-ke-toan-doanh-nghiep/)                                                                                                                                                                       | API availability for MISA ecosystem; SME applicability requires confirmation                       |
| **S22** | MISA                       | MISA SME pricing                                               | [https://sme.misa.vn/bao-gia/](https://sme.misa.vn/bao-gia/)                                                                                                                                                                                                                                                               | VND annual and one-time licensing                                                                  |
| **S23** | FAST                       | FAST Accounting help                                           | [https://fa12help.fast.com.vn/](https://fa12help.fast.com.vn/)                                                                                                                                                                                                                                                             | Accounting and production-costing functions                                                        |
| **S24** | FAST                       | FAST Accounting documentation                                  | [https://fast.com.vn/tai-cac-tai-lieu-phan-mem-ke-toan-fast-accounting/](https://fast.com.vn/tai-cac-tai-lieu-phan-mem-ke-toan-fast-accounting/)                                                                                                                                                                           | Product documentation and user materials                                                           |
| **S25** | FAST                       | Electronic-invoice rules under the 2025 Tax Administration Law | [https://fast.com.vn/quy-dinh-hoa-don-chung-tu-dien-tu-theo-luat-quan-ly-thue-2025/](https://fast.com.vn/quy-dinh-hoa-don-chung-tu-dien-tu-theo-luat-quan-ly-thue-2025/)                                                                                                                                                   | Vendor legal update for current e-invoice framework                                                |
| **S26** | FAST                       | FAST Accounting product and pricing                            | [https://fast.com.vn/phan-mem-ke-toan-fast-accounting/](https://fast.com.vn/phan-mem-ke-toan-fast-accounting/)                                                                                                                                                                                                             | Modules, production package, pricing, and tax reports                                              |
| **S27** | FAST                       | FAST Accounting LAN installation                               | [https://fa11r09help.fast.com.vn/index.php/fa11help/huong-dan-cai-dat-tren-mang-noi-bo-cho-nhieu-nguoi-su-dung/](https://fa11r09help.fast.com.vn/index.php/fa11help/huong-dan-cai-dat-tren-mang-noi-bo-cho-nhieu-nguoi-su-dung/)                                                                                           | On-premise/server deployment                                                                       |
| **S28** | FAST                       | FAST/Open API banking integration example                      | [https://fast.com.vn/tao-tai-khoan-open-api-cua-ngan-hang-ocb/](https://fast.com.vn/tao-tai-khoan-open-api-cua-ngan-hang-ocb/)                                                                                                                                                                                             | Evidence of project-based API integration                                                          |
| **Q16** | QBO                        | QuickBooks Global FAQ                                          | https://quickbooks.intuit.com/global/faq/                                                                                                                                                                                                                                                                                         | AWS infrastructure, accepted payment cards, billing and data-security statements                   |
| **Q17** | QBO / privacy              | Intuit Global Privacy Statement                                | https://www.intuit.com/privacy/statement/                                                                                                                                                                                                                                                                                         | International data transfers, processing locations, retention and controller/processor context     |
| **Q18** | Vietnam law                | Decree 13/2023/ND-CP on personal data protection               | https://vanban.chinhphu.vn/?docid=207759&pageid=27160                                                                                                                                                                                                                                                                             | Vietnam personal-data protection baseline                                                          |
| **Q19** | QBO partner                | Hector Garcia — QuickBooks consulting and training pricing     | https://hectorgarcia.com/1on1/                                                                                                                                                                                                                                                                                                    | Published setup, advanced consulting and integrated-service price points                           |
| **Q20** | QBO training partner       | QuickBooks Training plans and pricing                          | https://quickbookstraining.com/plans-and-pricing                                                                                                                                                                                                                                                                                  | Published 2–5-user team training price                                                             |
| **Q21** | QBO implementation partner | Fourlane — QuickBooks Online migration and cleanup case study  | https://www.fourlane.com/quickbooks-online-migration-and-cleanup-case-study                                                                                                                                                                                                                                                       | Migration scope, data correction and dedicated support; project price not published                |
| **Q22** | QBO developer              | API call limits and throttling                                 | https://help.developer.intuit.com/s/article/API-call-limits-and-throttling                                                                                                                                                                                                                                                        | Per-realm request, concurrency and batch limits; webhook/CDC guidance                              |
| **Q23** | QBO                        | QuickBooks Global account plan comparison                      | https://quickbooks.intuit.com/global/online-compare/                                                                                                                                                                                                                                                                              | USD-displayed pricing, card billing and annual upfront billing terms                               |

---

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)
