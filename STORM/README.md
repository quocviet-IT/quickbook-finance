# CTYHP STORM Research Knowledge Base

[README](README.md) · [Executive Summary](01_Executive_Summary.md) · [Perspectives](02_Research_Perspectives.md) · [Questions & Findings](03_Research_Questions.md) · [Knowledge Base](04_Knowledge_Base.md) · [Comparative Report](05_Comparative_Report.md) · [System Architecture](06_System_Architecture.md) · [Gap Analysis](07_Gap_Analysis.md) · [Build vs Buy](08_Build_vs_Buy.md) · [Roadmap](09_Implementation_Roadmap.md)

This folder reorganizes the source report into focused Markdown documents for GitHub, Claude Code, Codex, Cursor, RAG, and internal review.

## Research scope

**CTYHP**

**STORM RESEARCH REPORT**

**Wave Apps vs QuickBooks Online**

Feature Architecture Benchmark and Build-vs-Buy Assessment  
for CTYHP’s Internal Accounting System

| **Organization**  | CTYHP                                                            |
|-------------------|------------------------------------------------------------------|
| **Objective**     | Feature architecture benchmark; accounting build-vs-buy decision |
| **Current stack** | Next.js + TypeScript + Supabase + Vercel + Google Apps Script    |
| **Research date** | 14 July 2026                                                     |

*Internal decision-support document. Pricing, product scope, and regional availability may change by country and over time.*

## Evidence rules

- Official Wave, Intuit, and QuickBooks documentation is prioritized.

- Pricing and service scope are a research-time snapshot and may vary by country.

- “Could not be determined” means no clear confirmation was found in current official sources; it does not prove the feature does not exist.

- The QuickBooks Online Business User Manual, Intuit Australia, Version 4 – July 2022 is used to validate historical workflow patterns, not 2026 pricing or availability. **[Q15]**

## File structure

| File | Purpose |
|---|---|
| `01_Executive_Summary.md` | Executive conclusion, shortlist, and final platform direction. |
| `02_Research_Perspectives.md` | STORM perspectives and research-question frameworks. |
| `03_Research_Questions.md` | Verified findings for Wave, QBO, NetSuite, Odoo, MISA SME, and FAST. |
| `04_Knowledge_Base.md` | Structured evidence tables, market scan, and regulatory context. |
| `05_Comparative_Report.md` | Comparative analysis, pricing, compliance, functionality, and source appendix. |
| `06_System_Architecture.md` | Recommended CTYHP integration and system-of-record architecture. |
| `07_Gap_Analysis.md` | Functional, regulatory, data-residency, banking, and manufacturing gaps. |
| `08_Build_vs_Buy.md` | Build-vs-buy decision and updated platform recommendations. |
| `09_Implementation_Roadmap.md` | PoC plan, acceptance criteria, TCO request, and go/no-go gates. |
| `assets/` | Supporting media. The source DOCX did not contain extractable embedded media. |

## Reference IDs

- `[W#]`: Wave sources.
- `[Q#]`: QuickBooks Online sources.
- `[M#]`: market-scan sources.
- `[S#]`: primary-candidate and regulatory sources.

The complete source registry is included in [05_Comparative_Report.md](05_Comparative_Report.md#appendix--reference-sources).

## Recommended reading order

1. Start with `01_Executive_Summary.md`.
2. Review `07_Gap_Analysis.md` and `08_Build_vs_Buy.md` for decision-making.
3. Use `06_System_Architecture.md` and `09_Implementation_Roadmap.md` for implementation planning.
4. Consult `03_Research_Questions.md`, `04_Knowledge_Base.md`, and `05_Comparative_Report.md` for evidence and traceability.
