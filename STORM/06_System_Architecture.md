# System Architecture

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)

Recommended system-of-record boundaries and integration architecture for CTYHP.

## Wave/QBO integration constraints

Wave provides GraphQL, OAuth 2, accounting entities, webhooks, and Wave Connect. However, regional restrictions and the lack of a confirmed raw bank-feed API remove it from consideration as the primary platform. **[W12]**-**[W15]**

QBO provides OAuth 2, realmID, REST/GraphQL, a Node.js SDK, sandbox, and webhooks. Its most important limitation is that the API does not expose bank transactions still in For Review; CTYHP therefore cannot use QBO as the raw bank-data source for its reconciliation engine. **[Q9]**-**[Q14]**

## Wave/QBO baseline architecture

```text
Order Management ─┐
BOM / Pricing ───────┤
Production Tracking ─┼──> Supabase Accounting Control Plane
Warehouse ───────────┘ │
Bank API / CSV ────────────────────>├── Reconciliation Engine
├── Invoice Orchestration
├── Approval / Exception Queue
├── Production Reporting Mart
└── QBO Adapter ──> QuickBooks Online
```

| **Data domain**        | **System of record**                    | **QBO synchronization**              |
|------------------------|-----------------------------------------|--------------------------------------|
| Customer master        | Order/CRM system                        | Customer                             |
| Production order       | CTYHP                                   | External reference/custom field only |
| BOM/BOM version        | CTYHP                                   | Do not send the full BOM             |
| Warehouse movement     | CTYHP                                   | Summarized item/COGS/journal effect  |
| Invoice                | CTYHP orchestrates; QBO accounting copy | Invoice/credit memo                  |
| Raw bank transaction   | Supabase reconciliation store           | Do not depend on QBO For Review      |
| Payment match          | CTYHP rule engine                       | Payment/deposit after approval       |
| GL/AR/AP/close/audit   | QBO                                     | QBO accounting record                |
| Production-line report | Supabase data mart                      | Not dependent on native QBO reports  |

### Components CTYHP should build

- Supabase accounting control plane and entity mapping.

- Outbox and idempotency to prevent duplicate invoices/payments.

- Webhook inbox, signature validation, deduplication, dead-letter handling, and replay.

- Direct bank ingestion from bank APIs or controlled CSV/OFX.

- Reconciliation rules covering references, amounts, invoices, customer accounts, date windows, splits, partials, fees, and an exception queue.

---

## Primary-candidate integration architecture

| **Platform**          | **API / developer model**                                         | **Next.js/Supabase fit**                       | **Primary integration risk**                                                   |
|-----------------------|-------------------------------------------------------------------|------------------------------------------------|--------------------------------------------------------------------------------|
| **QuickBooks Online** | Accounting API, OAuth 2, webhook, English docs.                   | High, but Vietnam compliance remains external. | Raw bank “For Review” transactions are not exposed through the accounting API. |
| **Oracle NetSuite**   | SuiteTalk REST, OAuth, enterprise integration framework.          | High.                                          | Enterprise complexity and partner-led implementation.                          |
| **Odoo**              | External API and full developer framework, English docs.          | Very high, especially self-hosted/Odoo.sh.     | Version migration and custom-module governance must be managed.                |
| **MISA SME**          | Product-specific public API not verified.                         | Medium/low without vendor API.                 | May rely on vendor connector, database integration, or import/export.          |
| **FAST Accounting**   | Project-based integration capability; public portal not verified. | Medium.                                        | Likely vendor-led and dependent on custom scope/SLA.                           |

### Proposed CTYHP integration architecture

| **Layer**                       | **Responsibility**                                                                                                                         |
|---------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| **CTYHP operational systems**   | Customer/vendor master, orders, BOM/pricing, production batches, warehouse movements, shipment, and payment schedule.                      |
| **Supabase integration layer**  | Master-data mapping, outbox/retry, idempotency, webhook inbox, reconciliation engine, integration audit, and reporting mart.               |
| **ERP/accounting platform**     | NetSuite or Odoo for integrated ERP; MISA SME or FAST for local statutory accounting and compliance, depending on the target architecture. |
| **Vietnam compliance services** | SInvoice, meInvoice, Fast e-Invoice, mTax, or other verified services, subject to current Decree 254 confirmation.                         |
| **Reporting**                   | Financial reporting from the accounting core; production and jewelry-management reporting from the Supabase data mart.                     |

## Architecture principles

- CTYHP operational systems remain the source of truth for orders, BOM/pricing, production batches, warehouse movements, shipments, and payment schedules.
- Supabase provides master-data mapping, outbox/retry, idempotency, webhook inbox, reconciliation, integration audit, and reporting mart capabilities.
- The selected ERP/accounting platform records statutory and financial effects according to the chosen target architecture.
- Production and jewelry-management reporting remains traceable to operational lineage rather than relying only on native accounting reports.

---

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)
