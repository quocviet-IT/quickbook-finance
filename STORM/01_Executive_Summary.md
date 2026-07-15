# CTYHP STORM Research Report

## Wave Apps vs QuickBooks Online

### Feature Architecture Benchmark and Build-vs-Buy Assessment
For CTYHP Internal Accounting System

---

## Project Information

| Item | Value |
|------|------|
| Organization | CTYHP |
| Objective | Feature architecture benchmark and Build vs Buy assessment |
| Technology Stack | Next.js, TypeScript, Supabase, Vercel, Google Apps Script |
| Research Date | 14 July 2026 |

> Internal decision-support document.
>
> Pricing, product scope, and regional availability may change over time.

---

# Research Principles

The following principles were used during this research.

- Official Wave documentation
- Official Intuit documentation
- Official QuickBooks documentation

Rules

- Pricing is a snapshot at research time.
- Product availability may differ by country.
- "Could not be determined" means there is no official evidence.
- The QuickBooks 2022 User Manual is used only for historical workflow validation.

---

# Executive Conclusion

## Wave Apps

Not recommended as CTYHP's production accounting platform in Vietnam.

Reasons

- Regional limitation
- Compliance limitation
- Banking limitation

---

## QuickBooks Online

Conditionally recommended.

Requirements before adoption

- Validate commercial availability
- Validate bank connectivity
- Validate Vietnam compliance
- Complete Proof of Concept (PoC)

---

Recommended architecture

```text
CTYHP Internal Platform
        │
        ▼
Supabase Accounting Layer
        │
        ▼
QuickBooks Online
```

---

# Table of Contents

1. Research Perspectives
2. Research Questions
3. Knowledge Base
4. Report Outline
5. Comparative Report
6. Market Scan
7. Appendix

---

## Keywords

QuickBooks

Wave Apps

Accounting

ERP

Vietnam

Supabase

Next.js

TypeScript

Build vs Buy

PoC

Accounting Architecture