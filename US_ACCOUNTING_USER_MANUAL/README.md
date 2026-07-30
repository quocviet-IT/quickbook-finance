# US Accounting Web App Manual

This directory is the canonical user and implementation manual for CTYHP Accounting in the United States market.

Use it together with `PRD/PRD_US_Accounting_Web_App.md`. If this manual conflicts with the legacy `QUICKBOOK_USER_MANUAL` directory, this manual and the US PRD take precedence.

The legacy QuickBooks material is retained only for general workflow research. Its Australia-specific tax, payroll, terminology, and product behavior are not implementation requirements.

## Chapters

| File | Scope |
|---|---|
| `01_Company_Users_and_Close.md` | Company settings, access, approvals, audit, and accounting periods |
| `02_General_Ledger.md` | Chart of Accounts, journals, posting, reversals, and opening balances |
| `03_Customers_and_Receivables.md` | Customers, estimates, invoices, credits, receipts, collections, and AR ageing |
| `04_Vendors_Payables_and_1099.md` | Vendors, bills, credits, payments, AP ageing, W-9 status, and 1099 support |
| `05_Banking_and_Reconciliation.md` | Statement import, review, bank rules, matching, and statement reconciliation |
| `06_US_Sales_Tax.md` | Agencies, jurisdictions, rates, taxability, liability, periods, and payments |
| `07_Products_Purchasing_and_Inventory.md` | Items, purchase orders, receiving, matching, and optional inventory |
| `08_Reports_Documents_and_Operations.md` | Reports, close, cash flow, imports, documents, backup, and support |
| `09_Multi_Currency.md` | Exchange rates, settlement gains/losses, and revaluation |
| `10_Payroll_Integration.md` | Controlled payroll-provider integration and payroll journal reconciliation |
| `11_Implementation_Checklist.md` | Release-oriented implementation checklist |

## Terminology

- Use **sales tax**, not GST or VAT, for the US sales-tax module.
- Use **tax agency**, **jurisdiction**, **filing period**, and **sales-tax liability**.
- Use **vendor tax profile**, **W-9 status**, and **1099 eligibility** for vendor information reporting support.
- Use **Cash** and **Accrual** for report basis.
- Use USD as the default base currency while permitting configured foreign currencies.
- Use estimates or quotes consistently; the default UI term is **Estimate**.

## Legal and tax boundary

This manual defines product behavior, controls, and data requirements. It does not provide legal or tax advice. US sales-tax, payroll, and information-reporting outputs require review by qualified professionals before production use.

