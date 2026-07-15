# 20. Cash Flow

> Source scope: *QuickBooks Online Business User Manual*, Version 4 - July 2022, pages 100-101.

## Purpose

This chapter explains the Cash Flow area documented in QuickBooks Online, including the Overview and Planner tabs, the use of reconciled bank data, and three-month cash-flow projections.

It also translates the documented workflow into practical design requirements for an internal accounting and financial-planning system.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. Forecasting behavior, data sources, interface labels, and feature availability may differ in current versions.

---

## 1. What Cash Flow Means

Cash flow is the movement of money into and out of business accounts.

A positive accounting profit does not always mean the business has enough cash available. A company may report revenue while still waiting for customers to pay, or may need to pay suppliers, payroll, tax, and other obligations before incoming cash is received.

Cash-flow management therefore focuses on:

- available cash;
- expected receipts;
- expected payments;
- timing differences;
- future cash shortages;
- funding requirements;
- payment priorities.

---

## 2. Open the Cash Flow Area

From the left navigation menu, select:

```text
Cash Flow
```

The source manual describes two main tabs:

```text
Overview
Planner
```

---

## 3. Overview Tab

The **Overview** tab shows money moving into and out of the business.

The source notes that users can view and add information to the overview.

Typical information may include:

- opening cash position;
- money in;
- money out;
- net cash movement;
- current bank balances;
- recent inflows and outflows.

### Core calculation

```text
Net Cash Flow = Money In - Money Out
```

Ending cash:

```text
Ending Cash
= Opening Cash
+ Money In
- Money Out
```

---

## 4. Planner Tab

The **Planner** tab provides a forward-looking view.

The source manual states that it:

- uses historical transactions from bank feeds;
- pulls in the next three months of projected transactions;
- provides insight into upcoming money in and money out;
- allows users to customize expected inflows and outflows;
- can include known bills and expected BAS or IAS obligations.

For first-time use, select:

```text
Start planning
```

---

## 5. Importance of Reconciled Bank Accounts

The manual recommends reconciling all bank accounts before relying on the Cash Flow Overview or Planner.

Reconciled bank data improves the quality of:

- opening cash balances;
- historical transaction patterns;
- projected inflows;
- projected outflows;
- short-term liquidity decisions.

### Recommended prerequisite checklist

- [ ] All active bank accounts are included.
- [ ] Bank-feed transactions have been reviewed.
- [ ] Duplicate imports have been resolved.
- [ ] Transfers have been matched correctly.
- [ ] Reconciliations are current.
- [ ] Outstanding cheques or payments are considered.
- [ ] Foreign-currency balances have been converted consistently.
- [ ] Bank accounts that should be excluded are identified.

---

## 6. Forecast Horizon

The documented Planner uses a three-month forecast horizon.

For an internal system, recommended selectable horizons include:

```text
7 days
14 days
30 days
60 days
90 days
6 months
12 months
Custom
```

> **Design recommendation**
>
> The selectable horizons above are an internal-system extension. The source manual specifically describes a three-month QuickBooks projection.

---

## 7. Cash Inflows

Common inflow categories include:

- customer invoice payments;
- cash sales;
- deposits;
- loan proceeds;
- owner contributions;
- refunds received;
- investment income;
- asset-sale proceeds;
- transfers from other bank accounts.

### Inflow forecast fields

| Field | Description |
|---|---|
| Expected date | Planned receipt date |
| Amount | Expected cash received |
| Currency | Receipt currency |
| Customer/source | Payer |
| Category | Type of inflow |
| Probability | Likelihood of receipt |
| Source document | Invoice, contract, or estimate |
| Status | Forecast, confirmed, received, overdue |
| Notes | Assumptions or exceptions |

---

## 8. Cash Outflows

Common outflow categories include:

- supplier bills;
- payroll;
- tax payments;
- rent;
- utilities;
- loan repayments;
- insurance;
- inventory purchases;
- capital expenditure;
- subscriptions;
- transfers to other accounts.

### Outflow forecast fields

| Field | Description |
|---|---|
| Expected date | Planned payment date |
| Amount | Expected cash payment |
| Currency | Payment currency |
| Supplier/payee | Payment recipient |
| Category | Type of outflow |
| Priority | Critical, high, normal, optional |
| Source document | Bill, PO, payroll, or contract |
| Status | Forecast, approved, scheduled, paid |
| Notes | Assumptions or exceptions |

---

## 9. Tax and Statutory Payments

The source specifically mentions allowing for BAS and IAS in the Planner.

A controlled forecast should also include relevant obligations such as:

- GST/BAS;
- IAS;
- PAYG withholding;
- payroll-related liabilities;
- superannuation;
- income tax instalments;
- local taxes and statutory fees.

> **Regional note**
>
> BAS and IAS are Australian obligations. A system used in another country should use the applicable local tax calendar and compliance rules.

---

## 10. Forecast Sources

A robust cash-flow forecast can combine several sources.

| Source | Example |
|---|---|
| Bank history | Recurring historical deposits and payments |
| Accounts Receivable | Open customer invoices |
| Accounts Payable | Open supplier bills |
| Purchase Orders | Expected future supplier commitments |
| Payroll | Upcoming net payroll and liabilities |
| Tax calendar | Planned tax and statutory payments |
| Recurring transactions | Rent, subscriptions, service invoices |
| Manual adjustments | Known events not yet entered elsewhere |
| Budgets | Planned expenditure or receipts |

### Source priority

A confirmed transaction should normally take priority over a statistical projection.

Example priority:

```text
Actual
Confirmed
Approved
Scheduled
Forecast
Historical Estimate
```

---

## 11. Manual Cash-Flow Items

The source states that users can customize money in and money out.

Manual items are useful when an event is known but has not yet been recorded in the accounting modules.

Examples:

- expected new customer deposit;
- planned equipment purchase;
- settlement payment;
- tax instalment;
- financing event;
- exceptional legal expense;
- planned owner contribution.

### Manual-item controls

- require a description;
- store the creator;
- store the created date;
- require a category;
- distinguish manual items from accounting transactions;
- prevent double counting after the real transaction is recorded;
- support expiry or conversion to an actual transaction;
- retain change history.

---

## 12. Avoiding Double Counting

Forecasts may double count cash when the same event appears in multiple sources.

Example:

```text
Open supplier bill
+
Manual expected payment
=
Duplicate cash outflow
```

Recommended controls:

1. link manual items to source transactions;
2. mark forecast items as replaced when actual documents exist;
3. use unique source references;
4. show duplicate warnings;
5. distinguish invoice issue date from expected payment date;
6. reconcile forecast items to actual bank transactions.

---

## 13. Probability-Weighted Forecasting

An internal system may calculate expected inflows using probability.

Example:

```text
Invoice amount: 10,000
Collection probability: 80%

Probability-weighted inflow:
10,000 x 80% = 8,000
```

Suggested probability levels:

| Status | Example probability |
|---|---:|
| Confirmed | 100% |
| High confidence | 80% |
| Medium confidence | 50% |
| Low confidence | 20% |
| Excluded | 0% |

> **Design recommendation**
>
> Probability weighting is an internal forecasting enhancement and is not described as a QuickBooks workflow on the source pages.

---

## 14. Scenario Planning

Recommended scenarios:

```text
Base Case
Best Case
Worst Case
Custom Scenario
```

### Base Case

Uses expected payment dates and approved commitments.

### Best Case

Assumes:

- faster customer collection;
- higher sales;
- delayed discretionary payments;
- lower unexpected costs.

### Worst Case

Assumes:

- delayed customer receipts;
- reduced sales;
- urgent supplier payments;
- higher expenses;
- tax or payroll pressure.

### Scenario comparison

| Metric | Base | Best | Worst |
|---|---:|---:|---:|
| Opening cash | 100,000 | 100,000 | 100,000 |
| Expected inflows | 80,000 | 100,000 | 50,000 |
| Expected outflows | 90,000 | 80,000 | 110,000 |
| Ending cash | 90,000 | 120,000 | 40,000 |

---

## 15. Cash Threshold Alerts

The system should alert users when projected cash falls below a defined threshold.

Examples:

```text
Minimum operating cash
Minimum payroll coverage
Minimum supplier-payment reserve
Minimum tax reserve
Bank overdraft limit
```

### Alert levels

| Level | Condition |
|---|---|
| Information | Cash remains above target |
| Warning | Cash approaches minimum threshold |
| Critical | Cash falls below minimum |
| Breach | Cash becomes negative or exceeds credit limit |

---

## 16. Cash-Flow Forecast Status Model

```text
Draft
    ↓
Calculated
    ↓
Under Review
    ↓
Approved
    ↓
Published
    ↓
Superseded
    ↓
Archived
```

Forecast items may use:

```text
Projected
Confirmed
Scheduled
Received/Paid
Overdue
Cancelled
Replaced
```

---

## 17. Forecast Review Process

Recommended review frequency:

| Forecast horizon | Review frequency |
|---|---|
| Daily liquidity | Daily |
| 13-week forecast | Weekly |
| 3-month forecast | Weekly or monthly |
| 12-month forecast | Monthly |
| Strategic forecast | Quarterly |

### Review checklist

- [ ] Bank accounts are reconciled.
- [ ] Opening cash is correct.
- [ ] Open invoices are current.
- [ ] Supplier bills are current.
- [ ] Payroll dates and values are updated.
- [ ] Tax obligations are included.
- [ ] Purchase commitments are included.
- [ ] Manual forecast items are reviewed.
- [ ] Duplicates are resolved.
- [ ] Foreign-exchange rates are updated.
- [ ] Scenarios are refreshed.
- [ ] Threshold breaches are assigned for action.
- [ ] Forecast owner has approved the result.

---

## 18. Forecast Accuracy

Forecast accuracy should be measured by comparing forecast values with actual cash movements.

### Variance calculation

```text
Variance = Actual Amount - Forecast Amount
```

Percentage variance:

```text
Variance %
= (Actual - Forecast) / Forecast x 100
```

### Useful metrics

- inflow forecast accuracy;
- outflow forecast accuracy;
- date accuracy;
- total ending-cash variance;
- overdue receivables;
- unplanned payments;
- manual-item accuracy;
- forecast bias.

---

## 19. Cash-Flow Reports and Dashboard

Recommended dashboard components:

- current cash balance;
- cash by bank account;
- money in;
- money out;
- net cash flow;
- projected ending cash;
- lowest projected cash date;
- threshold alerts;
- overdue customer invoices;
- upcoming supplier bills;
- payroll and tax calendar;
- scenario comparison;
- forecast versus actual.

### Recommended reports

- daily cash position;
- weekly cash forecast;
- 13-week cash-flow forecast;
- forecast-versus-actual;
- customer collection forecast;
- supplier-payment forecast;
- tax and payroll obligations;
- cash by currency;
- cash by entity or location;
- manual forecast-item report.

---

## 20. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Unreconciled opening cash | Forecast starts from incorrect balance | Require current bank reconciliation |
| Double counting | Bill and manual forecast both included | Source linking and duplicate detection |
| Missing tax obligation | BAS or payroll liability omitted | Compliance calendar integration |
| Unrealistic receivable date | All invoices assumed on time | Customer payment behavior model |
| Stale forecast | Projection is not refreshed | Scheduled recalculation and review |
| Unsupported manual adjustment | User changes forecast without explanation | Mandatory reason and audit log |
| Wrong currency conversion | Foreign balances use outdated rate | Effective-dated exchange rates |
| Hidden cash shortage | No minimum threshold configured | Liquidity alerts |
| Incorrect transfer treatment | Internal transfer treated as inflow/outflow | Eliminate internal transfer double counting |
| Overreliance on history | One-off events are projected repeatedly | Recurrence validation and exclusions |

---

## 21. Recommended Database Design

### `cash_flow_forecasts`

```text
id
name
entity_id
scenario_type
forecast_start_date
forecast_end_date
base_currency_code
status
opening_cash
projected_ending_cash
calculated_at
prepared_by
reviewed_by
approved_by
created_at
updated_at
```

### `cash_flow_forecast_items`

```text
id
forecast_id
direction
source_type
source_id
category_id
expected_date
amount
currency_code
exchange_rate
base_amount
probability
priority
status
is_manual
manual_reason
created_by
created_at
updated_at
```

### `cash_flow_scenarios`

```text
id
forecast_id
scenario_name
assumptions_json
status
created_by
created_at
```

### `cash_flow_thresholds`

```text
id
entity_id
threshold_type
amount
currency_code
effective_from
effective_to
approved_by
created_at
```

### Supporting tables

```text
cash_flow_categories
cash_flow_actual_matches
cash_flow_variances
cash_flow_alerts
cash_flow_forecast_versions
cash_flow_audit_history
```

---

## 22. Recommended Constraints

1. Forecast start date must not be after end date.
2. Forecast items must define inflow or outflow.
3. Amount must be positive; direction controls the sign.
4. Manual items require a reason.
5. Source item and manual replacement cannot both remain active without warning.
6. Currency and exchange rate must be valid.
7. Approved forecasts must be versioned instead of overwritten.
8. Internal transfers must be identified.
9. Forecast calculations must be reproducible.
10. Each published forecast must retain its assumptions and source snapshot.

---

## 23. Suggested Calculation Flow

```text
Load Reconciled Bank Balances
        ↓
Load Open Receivables
        ↓
Load Open Payables
        ↓
Load Payroll, Tax, PO, and Recurring Commitments
        ↓
Load Manual Forecast Items
        ↓
Normalize Currency
        ↓
Remove Duplicates and Internal Transfers
        ↓
Apply Expected Dates and Probability
        ↓
Calculate Daily Running Balance
        ↓
Apply Scenarios
        ↓
Generate Alerts
        ↓
Review and Publish
```

---

## 24. AI Implementation Prompt

```text
Implement a cash-flow overview and forecasting module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Provide Overview and Planner interfaces.
- Use reconciled bank balances as the opening cash position.
- Support 7-day, 30-day, 60-day, 90-day, 6-month, and 12-month horizons.
- Load forecast items from Accounts Receivable, Accounts Payable, Purchase Orders, Payroll, Tax, Recurring Transactions, and manual adjustments.
- Distinguish actual, confirmed, approved, scheduled, forecast, and historical-estimate sources.
- Support manual money-in and money-out items with mandatory reasons.
- Prevent double counting between manual items and source transactions.
- Support multi-currency conversion using effective-dated exchange rates.
- Eliminate internal-transfer double counting.
- Support Base, Best, Worst, and custom scenarios.
- Support probability-weighted inflows.
- Calculate daily cash balances and projected ending cash.
- Add configurable minimum-cash, payroll, tax, and overdraft thresholds.
- Generate warnings when projected cash falls below thresholds.
- Support forecast versioning, review, approval, publishing, and audit history.
- Compare forecast to actual bank movements and calculate variances.
- Provide charts, tables, filters, exports, and exception queues.
- Include unit and integration tests for calculations, duplicates, transfers, currency conversion, scenarios, thresholds, permissions, and forecast versioning.
```

---

## 25. Internal System Checklist

- [ ] All bank accounts are reconciled.
- [ ] Opening cash is accurate.
- [ ] Overview shows money in, money out, and net cash flow.
- [ ] Planner includes at least a three-month view.
- [ ] Open receivables and payables are included.
- [ ] Payroll and tax obligations are included.
- [ ] Purchase commitments are included.
- [ ] Manual forecast items require reasons.
- [ ] Duplicate forecast items are detected.
- [ ] Internal transfers are eliminated.
- [ ] Multi-currency values use approved rates.
- [ ] Cash thresholds and alerts are configured.
- [ ] Scenario analysis is available.
- [ ] Forecasts are reviewed and versioned.
- [ ] Forecast-to-actual variance is measured.
- [ ] Published forecasts retain source and assumption history.

---

## Related Topics

- [09. Multi-Currency](09_Multi_Currency.md)
- [12. Banking Centre](12_Banking_Centre.md)
- [13. Quotes and Invoices](13_Quotes_and_Invoices.md)
- [15. Expenses and Bills](15_Expenses_and_Bills.md)
- [16. Recurring Transactions](16_Recurring_Transactions.md)
- [18. Purchase Orders](18_Purchase_Orders.md)
- [19. Payroll](19_Payroll.md)
- Bank Reconciliation
- GST and BAS
- Reports Centre

---

## Keywords

Cash Flow, Cash Flow Overview, Cash Flow Planner, cash forecast, money in, money out, liquidity, three-month forecast, cash scenario, forecast variance, reconciled bank account, cash threshold, expected receipts, expected payments