# 09. Multi-Currency

> Source scope: *QuickBooks Online Business User Manual*, Version 4 — July 2022, pages 38–40.

## Purpose

This chapter explains how QuickBooks Online handles transactions involving foreign customers, suppliers, and currencies.

It also translates the documented QuickBooks workflow into design requirements for an internal accounting system that supports multi-currency transactions.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. Current menus, plan availability, exchange-rate sources, and accounting behavior may differ.
>
> Once multi-currency is enabled in QuickBooks Online, the manual states that it cannot be disabled.

---

## 1. When Multi-Currency Is Needed

Multi-currency is useful when a business:

- buys from foreign suppliers;
- sells to foreign customers;
- receives or makes payments in foreign currencies;
- maintains foreign-currency bank accounts;
- records exchange-rate gains and losses;
- reports consolidated balances in a home currency.

### Typical business examples

- A Vietnamese company invoices a US customer in USD.
- A company purchases equipment from a European supplier in EUR.
- A business keeps bank accounts in USD, AUD, and VND.
- A customer pays an invoice at an exchange rate different from the invoice-date rate.

---

## 2. Enable Multi-Currency

Navigate to:

```text
Gear Icon > Account and Settings > Advanced
```

Open the **Currency** section.

The manual describes the following process:

1. Confirm the home currency.
2. Turn on **Multicurrency**.
3. Accept the acknowledgement that the feature cannot be undone.
4. Save the setting.

> **Warning**
>
> Multi-currency should not be activated without finance approval because it changes how customers, suppliers, accounts, and reports are handled.

---

## 3. Home Currency

The home currency is the primary reporting currency of the company file.

In the Australian manual, the default home currency is Australian Dollar (AUD).

For another organization, the home currency may be:

- VND;
- USD;
- AUD;
- EUR;
- another legally and operationally appropriate currency.

### Recommended controls

Before activating multi-currency, confirm:

- [ ] Legal entity.
- [ ] Accounting-standard requirements.
- [ ] Functional currency.
- [ ] Reporting currency.
- [ ] Tax-reporting currency.
- [ ] Bank-account currencies.
- [ ] Customer and supplier currencies.
- [ ] Exchange-rate source.
- [ ] Revaluation policy.
- [ ] Approval from finance leadership.

---

## 4. Open the Currency Centre

After multi-currency is enabled, navigate to:

```text
Gear Icon > Lists > Currencies
```

The Currency Centre can be used to:

- view active currencies;
- add a currency;
- edit currency settings;
- revalue currency balances;
- remove an unused currency where permitted.

---

## 5. Add a Currency

From the Currency Centre:

1. Select **Add Currency**.
2. Choose the required currency.
3. Review the currency code and name.
4. Save the record.

### Suggested currency master

| Field | Example |
|---|---|
| Currency code | USD |
| Currency name | US Dollar |
| Symbol | $ |
| Decimal precision | 2 |
| Status | Active |
| Exchange-rate source | Approved provider |
| Effective date | YYYY-MM-DD |
| Created by | User ID |
| Approved by | User ID |

---

## 6. Assign Currency to Customers and Suppliers

When setting up a customer or supplier, select the currency in which that party transacts.

The manual describes this using a field similar to:

```text
This customer/supplier pays me with
```

After the currency is assigned:

- transactions for that party use the selected foreign currency;
- the system calculates the equivalent home-currency value;
- reports may show both transaction currency and home currency.

> **Control principle**
>
> Changing a customer or supplier currency after transactions exist should be restricted or prohibited.

---

## 7. Foreign-Currency Transaction Example

The manual gives an example of a supplier invoice:

```text
Supplier invoice: USD 1,000
Exchange rate: 1.3837 AUD per USD
Home-currency amount: AUD 1,383.70
```

Calculation:

```text
Foreign amount × Exchange rate = Home-currency amount
```

```text
USD 1,000 × 1.3837 = AUD 1,383.70
```

### Important data to retain

For every foreign-currency transaction, store:

- transaction currency;
- foreign amount;
- home currency;
- exchange rate;
- home-currency amount;
- exchange-rate source;
- rate date;
- manually overridden rate, if any;
- person approving the override.

---

## 8. Exchange-Rate Dates

Different accounting events may use different exchange-rate dates.

Examples:

| Event | Possible rate date |
|---|---|
| Customer invoice | Invoice date |
| Supplier bill | Bill date |
| Customer payment | Payment date |
| Supplier payment | Payment date |
| Period-end revaluation | Reporting-period end date |
| Credit note | Credit-note date |

The accounting policy should define the correct rate source and date for each event.

---

## 9. Realized and Unrealized Foreign-Exchange Differences

### Unrealized exchange gain or loss

An unrealized difference occurs when an open foreign-currency balance changes in home-currency value before settlement.

Example:

```text
Invoice remains unpaid.
Exchange rate changes before month-end.
The receivable is revalued.
```

### Realized exchange gain or loss

A realized difference occurs when the transaction is settled at a different rate from the original transaction rate.

Example:

```text
Invoice recorded at VND 24,000 per USD.
Payment received at VND 24,300 per USD.
The difference becomes realized FX gain or loss.
```

### Recommended accounting entries

The exact accounts depend on company policy, but a system may require:

- Unrealized Foreign Exchange Gain;
- Unrealized Foreign Exchange Loss;
- Realized Foreign Exchange Gain;
- Realized Foreign Exchange Loss;
- Foreign Currency Revaluation Adjustment.

---

## 10. Currency Revaluation

The Currency Centre may provide a **Revalue Currency** action.

A controlled revaluation process should:

1. Identify open foreign-currency balances.
2. Obtain an approved period-end exchange rate.
3. Calculate new home-currency values.
4. Calculate unrealized gains and losses.
5. Create balanced journal entries.
6. Record the source rate.
7. Store preparer and reviewer approvals.
8. Reverse the entry in the next period when required.

### Revaluation checklist

- [ ] Reporting date is correct.
- [ ] Rate source is approved.
- [ ] Rate is stored with sufficient precision.
- [ ] Open balances are complete.
- [ ] Previously settled items are excluded.
- [ ] Revaluation entries balance.
- [ ] Review and approval are recorded.
- [ ] Reversal policy is applied.
- [ ] Reports reconcile to the general ledger.

---

## 11. Multi-Currency Bank Accounts

Each foreign-currency bank account should have a defined currency.

Example:

```text
Bank Accounts
├── Operating Account — VND
├── US Collection Account — USD
├── Australian Account — AUD
└── European Supplier Account — EUR
```

### Recommended rule

A bank account should not accept transactions in a currency different from its configured account currency unless a documented conversion transaction is created.

---

## 12. Currency Conversion Workflow

A conversion between two bank accounts should be recorded as one linked transaction.

Example:

```text
Transfer USD account
        ↓
Apply USD/VND exchange rate
        ↓
Receive VND account
        ↓
Record bank fee
        ↓
Record realized FX difference
```

### Required fields

- source account;
- source currency;
- source amount;
- destination account;
- destination currency;
- destination amount;
- exchange rate;
- bank fee;
- transaction date;
- reference number;
- supporting document;
- approver.

---

## 13. Rounding and Precision

Currency calculations may require more precision than the displayed amount.

Recommended approach:

- store exchange rates with at least 6–10 decimal places;
- store money in decimal or integer minor units;
- define currency-specific decimal precision;
- round only at approved calculation points;
- retain the unrounded calculated value for audit;
- use a dedicated rounding-difference account when necessary.

### Example

```text
Displayed rate: 1.3837
Stored rate: 1.3837000000
Displayed amount: AUD 1,383.70
```

---

## 14. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Wrong home currency | Company file configured incorrectly | Approval before activation |
| Feature enabled accidentally | User turns on irreversible setting | Restrict permission and require confirmation |
| Wrong rate date | Invoice uses payment-date rate | Policy-based validation |
| Manual rate manipulation | User enters an unsupported rate | Approval threshold and audit log |
| Currency mismatch | USD payment applied to EUR invoice | Currency compatibility validation |
| Rounding differences | Reports do not reconcile | Controlled precision and rounding rules |
| Missing revaluation | Open balances remain at old rates | Period-end revaluation checklist |
| Duplicate FX postings | Revaluation runs twice | Idempotency and run locking |
| Supplier currency changed | Historical transactions become inconsistent | Lock currency after first transaction |
| Unsupported currency | Users enter free-text codes | Controlled ISO currency master |

---

## 15. Recommended Database Design

### `currencies`

```text
code
name
symbol
decimal_places
status
created_at
updated_at
```

### `exchange_rates`

```text
id
base_currency_code
quote_currency_code
rate
rate_date
rate_type
source
is_manual
approved_by
created_at
```

### `currency_revaluations`

```text
id
entity_id
reporting_date
home_currency_code
status
prepared_by
reviewed_by
approved_by
journal_entry_id
created_at
updated_at
```

### `currency_revaluation_lines`

```text
id
revaluation_id
account_id
party_id
transaction_id
foreign_currency_code
foreign_balance
old_home_value
new_home_value
fx_difference
```

### Supporting fields for financial transactions

```text
transaction_currency
foreign_amount
home_currency
exchange_rate
exchange_rate_date
home_amount
rate_source
manual_rate_reason
```

---

## 16. Recommended Constraints

1. Use ISO 4217 currency codes.
2. A currency code must be unique.
3. A customer or supplier currency cannot change after transactions exist.
4. A transaction must have one defined transaction currency.
5. Foreign transactions must store both foreign and home-currency values.
6. Exchange rates must be positive.
7. Manual-rate overrides require a reason.
8. Revaluation runs must be idempotent.
9. Locked accounting periods cannot be revalued without approval.
10. Currency conversion entries must balance in home currency.

---

## 17. Suggested Workflow

```text
Define Home Currency
        ↓
Approve Multi-Currency Activation
        ↓
Configure Currency Master
        ↓
Configure Exchange-Rate Source
        ↓
Assign Currency to Accounts and Parties
        ↓
Record Foreign-Currency Transactions
        ↓
Settle Transactions
        ↓
Calculate Realized FX
        ↓
Run Period-End Revaluation
        ↓
Post Unrealized FX
        ↓
Review and Reconcile
```

---

## 18. AI Implementation Prompt

```text
Implement a multi-currency accounting module.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Support a configurable home currency.
- Treat multi-currency activation as an irreversible, approval-controlled action.
- Use ISO 4217 currency codes.
- Support currency master data and approved exchange-rate sources.
- Store transaction currency, foreign amount, home currency, exchange rate, rate date, and home amount.
- Assign one currency to each customer, supplier, and bank account.
- Prevent party-currency changes after financial transactions exist.
- Support manual exchange-rate overrides with reason and approval.
- Calculate realized FX gains and losses on settlement.
- Support period-end revaluation of open balances.
- Post unrealized FX adjustment journals.
- Make revaluation runs idempotent and auditable.
- Support currency conversions between bank accounts, including fees.
- Apply currency-specific decimal precision and controlled rounding.
- Use immutable audit history for rate changes and revaluation postings.
- Add filters, search, reporting, export, and reconciliation.
- Include unit tests for conversions, settlement, revaluation, rounding, permissions, and duplicate prevention.
```

---

## 19. Internal System Checklist

- [ ] Home currency is approved.
- [ ] Multi-currency activation requires elevated permission.
- [ ] ISO currency master is used.
- [ ] Exchange-rate source is documented.
- [ ] Rate date is stored.
- [ ] Manual rates require a reason.
- [ ] Customers and suppliers have controlled currencies.
- [ ] Foreign bank accounts have assigned currencies.
- [ ] Realized FX is calculated at settlement.
- [ ] Unrealized FX is calculated at period end.
- [ ] Revaluation runs cannot be duplicated.
- [ ] Rounding policy is documented.
- [ ] FX reports reconcile to the ledger.
- [ ] Every rate override is auditable.

---

## Related Topics

- [03. Company Setup](03_Company_Setup.md)
- [05. Audit Log](05_Audit_Log.md)
- [06. Chart of Accounts](06_Chart_of_Accounts.md)
- Customers and Suppliers
- Bank Accounts
- Bank Reconciliation
- Invoices and Bills
- Financial Reports

---

## Keywords

Multi-Currency, home currency, foreign currency, exchange rate, currency centre, realized FX, unrealized FX, currency revaluation, foreign supplier, foreign customer, ISO 4217, rounding, foreign-currency bank account