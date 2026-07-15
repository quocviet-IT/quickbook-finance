# Build vs Buy Recommendation

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)

Decision framework covering accounting-core purchase, integrated ERP, local statutory accounting, and CTYHP-owned integration layers.

## Wave/QBO build-vs-buy baseline

| **Option**                                | **Assessment**            | **Rationale**                                                                                                               |
|-------------------------------------------|---------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| Buy Wave                                  | Not recommended           | Official Vietnam business support, bank connections, and compliance are unsuitable.                                         |
| Buy QBO and place all workflows inside it | Insufficient              | Strong accounting core, but production/BOM/warehouse and bank-feed API gaps remain.                                         |
| Build the entire accounting platform      | Not recommended yet       | CTYHP would need to build ledger correctness, AR/AP, close, audit, tax logic, migration, and accountant workflows.          |
| QBO core + CTYHP internal layer           | Conditionally recommended | Use QBO for ledger/control and build the differentiating production integration, bank reconciliation, and custom reporting. |

> **Primary recommendation**
>
> Buy QuickBooks Online for the accounting ledger and controls; build the CTYHP Accounting Operations Layer on Next.js + TypeScript + Supabase + Vercel. Use Wave only as a reference for UX and feature simplification.

---

## Updated recommendation after the primary-candidate evaluation

### Recommendation 1 — Odoo Enterprise Custom, self-hosted in Vietnam

Odoo is the preferred first PoC candidate because it offers the best balance of manufacturing, integration, customization, data-residency flexibility, and cost. It combines Manufacturing, Inventory, Quality, Sales, and Accounting on one platform; supports multi-company and multi-currency; provides an English developer framework; fits the Next.js/TypeScript/Supabase stack; and can be self-hosted in Vietnam. The mandatory condition is proof that the e-invoice connector supports Decree 254/2026 and that the VAT workflow is acceptable to CTYHP accounting and legal reviewers.

**Status:** Preferred PoC candidate — conditional.

### Recommendation 2 — Oracle NetSuite OneWorld with Vietnam localization

NetSuite is the enterprise alternative when CTYHP requires multiple legal entities, multi-country consolidation, a standardized global ERP, enterprise support, and can accept a higher implementation budget and overseas cloud processing. It should not be selected without a five-year quotation, Decree 254 confirmation, VAT-filing clarification, data-location and DPA details, localization support commitments, and a jewelry-costing/traceability PoC.

**Status:** Enterprise alternative — conditional and high-cost.

### Recommendation 3 — FAST Accounting for local production accounting

FAST is a practical local candidate where the priority is Vietnamese accounting, production costing, on-premise data, lower cost, and local vendor support. It must prove a stable integration interface, integration SLA, multi-entity capability, BOM and traceability depth, English support, and the current Decree 254 e-invoice workflow.

**Status:** Local manufacturing-accounting candidate.

### Recommendation 4 — MISA SME for compliance-first accounting

MISA SME is the strongest compliance-first option for Vietnamese accounting, Decree 254 e-invoicing, VAT workflows, VND pricing, and locally stored accounting data. It should be treated as the statutory-accounting platform or sidecar unless its API and production integration capabilities can be proven sufficient for the wider ERP scope.

**Status:** Vietnam statutory-compliance candidate or accounting sidecar.

### QuickBooks Online baseline conclusion

QuickBooks Online remains a useful benchmark for accounting UX, bank reconciliation, invoice workflows, API/OAuth, and reporting. It does not have a verified Vietnam statutory-compliance path, is not a manufacturing ERP, and provides limited control over data residency. It should therefore not proceed to final selection as CTYHP’s primary Vietnam accounting/ERP platform. [Q9][Q10][Q13]

---

## Final consolidated comparison

| **Platform**          | **Vietnam compliance**                                              | **International capability**                              | **Manufacturing**                 | **Data residency**                              | **Integration**                   | **Pricing / TCO**                                        | **Updated recommendation**                |
|-----------------------|---------------------------------------------------------------------|-----------------------------------------------------------|-----------------------------------|-------------------------------------------------|-----------------------------------|----------------------------------------------------------|-------------------------------------------|
| **QuickBooks Online** | Weak; no verified Vietnam e-invoice/VAT path.                       | Multi-currency; limited multi-entity.                     | Low.                              | Overseas SaaS; no on-premise.                   | Strong accounting API.            | USD subscription; compliance and manufacturing external. | Do not retain on final shortlist.         |
| **Oracle NetSuite**   | VAT reports and partner localization; Decree 254 must be confirmed. | Very strong OneWorld and consolidation.                   | Strong.                           | Overseas cloud; exact region must be confirmed. | Very strong.                      | Quotation-based; high implementation cost.               | Enterprise alternative.                   |
| **Odoo**              | Vietnam localization + SInvoice; Decree 254 must be confirmed.      | Strong multi-company and multi-currency.                  | Strong and flexible.              | Cloud region or self-host in Vietnam.           | Very strong.                      | USD subscription plus implementation/customization.      | Preferred PoC candidate.                  |
| **MISA SME**          | Strongest current evidence; meInvoice + mTax.                       | Export/FX supported; international consolidation limited. | Accounting/costing, not full ERP. | Can keep SQL Server in Vietnam.                 | MISA SME public API not verified. | Low, transparent VND pricing.                            | Compliance-first/statutory candidate.     |
| **FAST Accounting**   | Fast e-Invoice and legal updates; Decree 254 demo required.         | Export/FX supported; multi-country unclear.               | Strong production costing.        | Can deploy on a Vietnam server.                 | Vendor-led/custom integration.    | Transparent VND entry pricing.                           | Local manufacturing-accounting candidate. |

## Proposed PoC shortlist

**Track A — Integrated ERP**

12. Odoo Enterprise Custom — self-hosted in Vietnam.

13. Oracle NetSuite OneWorld with Vietnam localization.

**Track B — Local accounting and compliance**

14. FAST Accounting Manufacturing.

15. MISA SME 2026 + meInvoice + mTax.

The two tracks should be tested in parallel. The PoC should determine whether CTYHP can use one integrated ERP or should combine an operational ERP with a Vietnam statutory-accounting platform.

## Final conclusion

Odoo is the preferred first PoC candidate because it provides the best overall balance of manufacturing capability, integration, customization, data-residency flexibility, and cost. NetSuite is the enterprise alternative for multi-country consolidation and standardized global ERP operations. MISA SME provides the strongest current Vietnam compliance evidence, while FAST is a credible local candidate for production costing and on-premise accounting. Final selection must be based on a vendor questionnaire, a technical demonstration, and a PoC using actual CTYHP jewelry-production data — not on marketing material alone.

---

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)
