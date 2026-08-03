# Legacy QuickBooks Australia Reference

## Status

This directory is an archived research source derived from a July 2022 QuickBooks Online manual published for Australia.

It is **not** the product specification or canonical implementation manual for CTYHP Accounting.

Use these canonical US documents instead:

1. `../PRD/PRD_US_Accounting_Web_App.md`
2. `../US_ACCOUNTING_USER_MANUAL/README.md`
3. `../docs/AI_ACCOUNTING_INTEGRITY_EXECUTION.md` for the current integrity-hardening task

## Prohibited use

Do not implement the following from this legacy directory:

- Australian GST, BAS, IAS, TPAR, PAYG, ATO, ABN, or superannuation workflows.
- Australia-specific payroll, tax, filing, support, product-plan, pricing, or regulatory assumptions.
- Historical QuickBooks UI behavior as a requirement for the custom application.
- Any country-specific rule without confirmation in the canonical US PRD or US manual.

## Permitted use

The chapters may still be consulted for country-neutral workflow ideas, including:

- Navigation and usability patterns.
- Chart of Accounts concepts.
- Immutable audit history.
- Customer, invoice, vendor, bill, and payment workflows.
- Products, services, purchasing, inventory, and recurring transactions.
- Bank review and statement reconciliation concepts.
- Multi-currency controls.
- Report customization and operational support patterns.

When a general idea is adopted, restate it in the canonical US documentation before implementing it.

## Legacy chapter index

All numbered files in this directory retain their original historical content for traceability. Country-specific chapters such as `04_GST_Setup.md`, `07_TPARS.md`, `19_Payroll.md`, and `22_GST_and_BAS.md` are excluded from implementation scope.

