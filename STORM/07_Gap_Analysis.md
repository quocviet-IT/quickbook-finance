# Gap Analysis

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)

Gaps between platform capabilities and CTYHP requirements across banking, manufacturing, compliance, data residency, integration, and reporting.

## Wave/QBO baseline gap analysis

| **CTYHP requirement**         | **Wave**                                    | **QBO**                                                          | **Remaining gap**                                                              |
|-------------------------------|---------------------------------------------|------------------------------------------------------------------|--------------------------------------------------------------------------------|
| Next.js + TypeScript          | GraphQL/OAuth but regional constraint.      | OAuth 2, Node.js SDK, REST/GraphQL, sandbox.                     | Build a server-side QBO adapter and token management.                          |
| Supabase integration DB       | External mapping can be stored.             | Store realmID, token metadata, and entity mapping.               | RLS, encryption, outbox, webhook inbox, retries.                               |
| Google Apps Script            | Wave Connect integrates Sheets. **[W15]** | GAS must call API or Supabase.                                   | Use GAS for light reporting/operations, not as the accounting transaction bus. |
| Automated bank reconciliation | Connections do not cover Vietnam.           | Feed and For Review have API/availability constraints.           | Build direct bank ingestion, rule engine, and exception queue.                 |
| Production-order invoicing    | Generic invoice/poNumber.                   | Stronger progress invoice and dimensions.                        | CTYHP keeps order/BOM/batch lineage; QBO keeps the accounting invoice.         |
| BOM/pricing                   | No native BOM confirmed.                    | No native BOM/MRP confirmed.                                     | BOM and costing engine remain in CTYHP.                                        |
| Production tracking           | No production entities confirmed.           | Projects do not replace routing/work centers.                    | Retain the current production tracking system.                                 |
| Warehouse                     | No warehouse model confirmed.               | Inventory/PO do not prove manufacturing multi-warehouse support. | Warehouse remains system of record; post summarized financial effects.         |
| Production-line reporting     | Tag reporting is insufficient.              | Advanced reporting is stronger but lacks production lineage.     | Build a Supabase reporting mart by line/batch/order/BOM.                       |
| Vietnam VAT/e-invoice/payroll | Region not supported.                       | Not fully determined.                                            | Local compliance assessment/connectors are mandatory.                          |

### Three decision-critical gaps

> 1\. Banking: the real objective is reconciliation across bank transaction → customer → production order → invoice → shipment → receivable → accounting posting. Neither SaaS should be CTYHP’s raw bank-data source.
>
> 2\. Production context: orders, BOM versions, lines/work centers, batches, material issues, warehouse releases, and shipments must remain in Supabase rather than being forced into memos, custom fields, or the COA.
>
> 3\. Reporting: QBO should serve statutory and financial reporting; Supabase should serve management reporting by production line, batch, order, and BOM version.

---

## Primary-candidate compliance, residency, and manufacturing gaps

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

---

## Consolidated CTYHP gap analysis

| **CTYHP requirement**                             | **NetSuite**                                | **Odoo**                                   | **MISA SME**                   | **FAST**                              |
|---------------------------------------------------|---------------------------------------------|--------------------------------------------|--------------------------------|---------------------------------------|
| **Unified order–production–warehouse–accounting** | Strong                                      | Strong                                     | Limited                        | Medium                                |
| **Current Vietnam e-invoice**                     | Connector; Decree 254 confirmation required | SInvoice; Decree 254 confirmation required | Strongest current evidence     | Viable; live Decree 254 demo required |
| **Vietnam VAT filing**                            | Reports; direct filing unclear              | Reports; direct filing unclear             | Strong mTax path               | Reports; direct filing unclear        |
| **International consolidation**                   | Strongest                                   | Strong                                     | Limited                        | Not verified                          |
| **Public API and English docs**                   | Strong                                      | Strong and flexible                        | Limited/not verified for SME   | Vendor-led                            |
| **Vietnam data residency**                        | Not controlled/verified                     | Possible through self-hosting              | Possible locally               | Possible locally                      |
| **Cost transparency**                             | Low                                         | Medium                                     | High                           | High                                  |
| **Jewelry customization**                         | Feasible but expensive                      | Most feasible                              | Requires external/custom layer | Possible but vendor-led               |
| **Fit with CTYHP AI Team stack**                  | High                                        | Very high                                  | Medium/low                     | Medium                                |

## Cross-cutting gap summary

1. **Banking:** raw bank ingestion and deterministic reconciliation must not depend solely on a SaaS review queue.
2. **Production context:** production orders, BOM versions, work centers, batches, material issues, warehouse releases, and shipments require preserved operational lineage.
3. **Vietnam compliance:** e-invoice, VAT, retention, data-flow, and cross-border processing claims require current release evidence and contractual confirmation.
4. **Jewelry manufacturing:** purity, weight, fine-gold equivalent, stones, scrap, recovery, assay, WIP, and variance require a real-data PoC.
5. **Reporting:** statutory reports and production-management reports have different systems of record and reconciliation requirements.

---

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)
