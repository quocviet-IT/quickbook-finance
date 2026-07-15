# Implementation Roadmap

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)

Proof-of-concept plan, acceptance criteria, real-data scenarios, commercial requirements, and go/no-go gates.

## Mandatory gates before selecting QBO

| **Gate**                | **Pass condition**                                                                    |
|-------------------------|---------------------------------------------------------------------------------------|
| Commercial availability | Intuit/partner confirms that CTYHP can contract, pay, and receive support in Vietnam. |
| Bank connectivity       | Validate each bank and agree on API/file fallback.                                    |
| Vietnam tax/e-invoice   | Accounting/legal advisors confirm VAT, e-invoicing, retention, and filing.            |
| API entitlement         | Sandbox and production provide the required entities, rate limits, and webhooks.      |
| Data ownership          | Full export of COA, customers, invoices, payments, transactions, and reports.         |
| Reconciliation          | The internal engine does not depend on raw QBO For Review data.                       |
| Security                | OAuth token encryption, rotation/revocation, and webhook signature validation.        |
| Operational control     | Month-end close, adjustment, credit note, and audit-review procedures.                |

## Recommended PoC: 4–6 weeks

| **Phase** | **Scope**                                                                                                                  |
|-----------|----------------------------------------------------------------------------------------------------------------------------|
| Week 1    | Commercial/compliance discovery; validate region, bank, VAT/e-invoicing, and data policy.                                  |
| Week 2    | OAuth 2, sandbox, token refresh, realmID, webhook inbox, outbox; customer/item/invoice/payment CRUD.                       |
| Week 3    | Production-order invoicing covering deposits, progress invoices, partial delivery/payment, credit notes, and cancellation. |
| Week 4    | Bank CSV/API ingestion, deterministic matching, exception queue, and approved payment posting.                             |
| Week 5    | Revenue – material – labor – overhead = margin report by line/batch/order/customer/BOM.                                    |
| Week 6    | Month-end close, locks, reversals, failure recovery, duplicate prevention, and export/exit drill.                          |

## Acceptance criteria

> 1\. No duplicate invoice/payment when the same event is retried.
>
> 2\. Every invoice traces back to order, production batch, and BOM version.
>
> 3\. Every bank match traces to the raw bank record and approving person/rule.
>
> 4\. 100% of payment postings have an audit record and idempotency key.
>
> 5\. PoC target: ≥95% deterministic matching for transactions with payment references; all others enter the exception queue.
>
> 6\. Production-line reporting reconciles to posted revenue/COGS.
>
> 7\. Month-end close prevents changes to locked data outside approval.
>
> 8\. The export/exit procedure is tested in practice.

## Wave/QBO baseline conclusion

Wave is a useful UX reference but is not suitable as CTYHP’s production platform in Vietnam. QBO is a stronger accounting-core candidate, but it does not solve raw bank reconciliation, production/BOM/warehouse lineage, or custom production reporting. The preferred model is QBO accounting core + CTYHP Accounting Operations Layer, approved only after a PoC validates commercial availability, banking, and Vietnam compliance.

---

## Jewelry-manufacturing PoC scenarios

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

## Five-year TCO and RFP scope

| **Platform**          | **Pricing visibility**                                                                                                 | **License model**                                | **Major additional cost areas**                                                       |
|-----------------------|------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------|---------------------------------------------------------------------------------------|
| **QuickBooks Online** | Published USD monthly subscription by plan.                                                                            | SaaS subscription.                               | Vietnam compliance and manufacturing remain external costs.                           |
| **Oracle NetSuite**   | No public VND pricing.                                                                                                 | SaaS subscription, modules, users, and services. | Localization, manufacturing, migration, integration, and support are quotation-based. |
| **Odoo**              | Published per-user prices in USD.                                                                                      | Subscription; cloud or self-hosted.              | Custom plan, hosting, implementation packs, partner work, and jewelry modules.        |
| **MISA SME**          | Published VND pricing; approximately VND 4.65m/year or VND 8.85m one-time for a referenced Standard tier.              | Annual or one-time license.                      | meInvoice, mTax, eSign, invoice volume, training, and customization may be separate.  |
| **FAST Accounting**   | Published VND pricing; manufacturing package approximately VND 11.9m plus about VND 4.45m initial training/consulting. | Packaged license plus services.                  | Customization, integration, support, and upgrades must be quoted.                     |

The RFP should request a minimum five-year TCO covering user licenses, accounting and manufacturing modules, hosting, Vietnam localization, e-invoice volume, digital signatures, data migration, API integration, custom reports, training, support SLA, upgrades, backup, disaster recovery, test environments, annual maintenance, and exit/export assistance.

---

## Proposed PoC shortlist

**Track A — Integrated ERP**

12. Odoo Enterprise Custom — self-hosted in Vietnam.

13. Oracle NetSuite OneWorld with Vietnam localization.

**Track B — Local accounting and compliance**

14. FAST Accounting Manufacturing.

15. MISA SME 2026 + meInvoice + mTax.

The two tracks should be tested in parallel. The PoC should determine whether CTYHP can use one integrated ERP or should combine an operational ERP with a Vietnam statutory-accounting platform.

## Go / No-Go gates

| **Gate**           | **Mandatory pass condition**                                                                                 |
|--------------------|--------------------------------------------------------------------------------------------------------------|
| **E-invoice**      | Demonstrate issue, adjustment, replacement, cancellation, and error handling under Decree 254/2026.          |
| **VAT**            | Demonstrate preparation, review, export, and submission of VAT data.                                         |
| **Data residency** | Provide data-flow map, data-center location, DPA, and subprocessor list.                                     |
| **Retention**      | Demonstrate archive, export, audit, backup, restoration, and legal document presentation.                    |
| **API**            | Create and update customer, order, item, invoice, payment, and inventory transactions in a test environment. |
| **Idempotency**    | Retry the same event without creating duplicate invoices, payments, or inventory postings.                   |
| **Manufacturing**  | Run one jewelry order from BOM and material issue through WIP, finished goods, delivery, and invoice.        |
| **Precious metal** | Handle purity, weight, fine-gold equivalent, scrap, recovery, and variance.                                  |
| **Traceability**   | Trace an invoice back to order, batch, BOM version, material lot, and relevant approvals.                    |
| **Reporting**      | Produce gross margin by order, production line, product, batch, and customer.                                |
| **Pricing**        | Provide a five-year TCO, not only a first-year license quote.                                                |
| **Exit**           | Export master data, transactions, attachments, and audit history in a usable format.                         |

## Delivery sequence

1. Issue a vendor questionnaire and request current compliance evidence.
2. Conduct technical demonstrations using CTYHP process and data examples.
3. Run Track A and Track B PoCs in parallel.
4. Reconcile functional results, integration results, compliance results, and five-year TCO.
5. Approve the target architecture only after all mandatory gates pass.
6. Complete migration, fallback, audit, retention, and exit drills before production cutover.

---

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)
