# 12. Banking Centre

> Source scope: *QuickBooks Online Business User Manual*, Version 4 - July 2022, pages 49-62.

## Purpose

This chapter explains how QuickBooks Online imports, reviews, matches, categorizes, excludes, and automates bank transactions.

It also converts the documented workflow into system requirements for an internal accounting platform with bank ingestion, reconciliation, rules, receipt capture, exception handling, and audit controls.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. Current bank-feed availability, supported institutions, file formats, and menu names may differ by country and version.

---

## 1. Banking Centre Overview

The Banking Centre helps users bring bank and credit-card transactions into the accounting system.

Two main ingestion methods are documented:

1. automatic bank feeds;
2. manual transaction-file upload.

After import, transactions enter a review workflow before they affect the accounting records.

```text
Bank Feed or File Upload
        ↓
For Review
        ↓
Match / Add / Split / Transfer / Exclude
        ↓
Categorised
        ↓
Bank Register and Financial Reports
```

---

## 2. Benefits of Bank Integration

Connecting bank data can:

- reduce manual entry;
- reduce transcription errors;
- accelerate daily bookkeeping;
- suggest transaction categories;
- identify potential matches;
- improve reconciliation;
- centralize supporting documents.

### Key control principle

Imported bank transactions should not affect the ledger until they are reviewed and approved, unless a controlled rule explicitly allows automatic posting.

---

## 3. Automatic Bank Feeds

Navigate to:

```text
Banking
```

Ensure the **Banking** tab is selected.

Another documented route is:

```text
Chart of Accounts > Select Bank/Credit Card > Connect Bank
```

### Typical connection workflow

1. Select the bank or financial institution.
2. Authenticate through the bank's secure connection process.
3. Select the bank or credit-card accounts to connect.
4. Map each external account to a QuickBooks account.
5. Confirm the connection.
6. Download available transactions.
7. Review imported data.

---

## 4. Direct Feeds and Standard Feeds

The manual distinguishes between direct and standard bank-feed connections.

| Connection type | General description |
|---|---|
| Direct feed | A more direct, secure, and often more reliable connection |
| Standard feed | A normal aggregation connection that may be quicker to activate |

### Recommended system record

Store:

- bank name;
- connection type;
- connection status;
- linked account;
- last successful sync;
- last failed sync;
- consent expiry;
- token expiry;
- created by;
- approved by.

---

## 5. Manual Bank Transaction Import

When automatic feeds are unavailable or incomplete, transactions can be uploaded manually.

The manual lists the following formats:

```text
CSV
QFX
QBO
OFX
```

### Documented workflow

```text
Banking > Upload Transactions
```

Then:

1. select the file;
2. choose the target bank account;
3. configure the CSV field mapping when required;
4. review the imported rows;
5. select the rows to import;
6. confirm the import;
7. complete the process.

---

## 6. Recommended Bank File Columns

A controlled bank-import file should include:

| Field | Description |
|---|---|
| Transaction date | Bank posting or transaction date |
| Description | Bank-provided transaction text |
| Reference | Bank reference or transaction ID |
| Debit | Money out |
| Credit | Money in |
| Amount | Signed transaction amount |
| Currency | Transaction currency |
| Account number | Source bank account |
| Balance | Optional running balance |
| Raw text | Original bank statement text |

### Import controls

- validate the account;
- validate date format;
- normalize debit and credit signs;
- detect duplicate bank IDs;
- calculate a file hash;
- preserve raw data;
- reject invalid rows into an exception queue.

---

## 7. Banking Centre Tabs

The manual describes three main tabs.

### 7.1 For Review

New transactions appear in **For Review**.

Transactions in this tab do not affect the financial statements until they are actioned.

Possible actions include:

- Add;
- Match;
- Split;
- Transfer;
- Exclude;
- Create a rule;
- attach a document.

### 7.2 Categorised

Transactions that have been accepted, matched, or added appear in **Categorised**.

These transactions have been recorded in the accounting system and can affect:

- bank registers;
- account balances;
- tax reporting;
- financial statements.

### 7.3 Excluded

Transactions that should not enter the accounting records appear in **Excluded**.

Examples:

- transactions before the migration cutover date;
- duplicate imported rows;
- irrelevant bank-feed records;
- test or incorrect imports.

> **Control note**
>
> Exclusion should require a reason and remain auditable.

---

## 8. Add a Transaction

To add a bank transaction:

1. open the transaction in **For Review**;
2. select the transaction type;
3. select or create the customer or supplier;
4. choose the account category;
5. select the tax code;
6. add a memo or attachment where required;
7. select **Add**.

### Required validation

- account category is active;
- tax code is valid;
- transaction currency matches the bank account;
- amount is non-zero;
- transaction is not a duplicate;
- required payee data is present.

---

## 9. Split a Transaction

Use **Split** when a single bank transaction relates to multiple accounts or tax treatments.

Example:

```text
Total payment: 1,100

Office Supplies: 700
Shipping Expense: 300
Tax: 100
```

### Split controls

- total split amount must equal the bank amount;
- tax calculation must reconcile;
- each split line must use a valid account;
- rounding differences must be controlled;
- the original bank record must remain linked.

---

## 10. Match a Transaction

QuickBooks may suggest a match based on:

- amount;
- transaction date;
- customer or supplier;
- transaction ID;
- invoice;
- bill;
- expense;
- payment.

To accept a suggested match, use **Match**.

### Matching examples

```text
Bank deposit → Customer payment
Bank withdrawal → Supplier payment
Credit-card debit → Expense
Bank transfer → Transfer between accounts
```

---

## 11. Find Match

Use **Find Match** when:

- one bank amount relates to multiple invoices;
- one payment covers multiple bills;
- the automatic suggestion is incomplete;
- partial payments exist;
- fees or deductions need separate treatment.

### Matching rules

A matching engine may evaluate:

```text
Reference match
Amount match
Date-window match
Customer/supplier match
Invoice number match
Account match
Currency match
Payment-status match
```

---

## 12. Debit Transactions

The manual describes debit transactions as defaulting to an expense-like workflow unless matched to an existing bill, expense, or payment.

Possible classifications include:

- Expense;
- Cheque;
- Transfer;
- Credit-card payment.

### Record as Transfer

Use a transfer when money moves between accounts, such as:

- bank to bank;
- bank to credit card;
- bank to loan account;
- bank to drawings;
- bank to payroll clearing.

### Recommended rule

A transfer must create linked entries in both accounts and must not create income or expense.

---

## 13. Credit Transactions

Credit transactions generally represent money received.

Possible classifications include:

- Deposit;
- Sales Receipt;
- Customer payment;
- Transfer.

### Examples

```text
Customer payment received
Cash deposit
Refund received
Bank-to-bank transfer
Loan proceeds
```

The category should not default to income when the amount is actually:

- a transfer;
- a loan;
- an owner contribution;
- a refund;
- a receivable settlement.

---

## 14. Batch Processing

The manual supports batch actions for multiple transactions.

Possible actions include:

- Accept;
- Exclude;
- Update.

### Recommended safeguards

1. Display the number of selected rows.
2. Display the affected total amount.
3. Prevent mixed-currency batch posting.
4. Require confirmation.
5. Restrict high-risk bulk changes.
6. Record all affected transaction IDs.
7. Provide a batch result report.

---

## 15. Attachments

Supporting documents can be attached during the Add or Match process.

Examples:

- invoice;
- receipt;
- bank advice;
- contract;
- payment confirmation;
- internal approval.

The manual notes that only one attachment may be added directly in the Banking screen, while additional attachments may be added after opening the saved transaction.

### Attachment controls

- allowed file types;
- file-size limit;
- malware scanning;
- document classification;
- retention period;
- immutable link to the transaction;
- permission-based access.

---

## 16. Bank Rules

Bank Rules automate transaction classification.

Navigate to:

```text
Banking > Rules
```

or select:

```text
Create a Rule
```

### Rule direction

A rule can apply to:

- Money In;
- Money Out.

### Rule conditions

The manual documents conditions such as:

| Source field | Operators |
|---|---|
| Bank text | Contains / Does not contain |
| Description | Contains / Is exactly / Does not contain |
| Amount | Equals / Greater than / Less than / Does not equal |

Up to five conditions may be added to a rule in the documented version.

---

## 17. Bank Rule Actions

A rule may assign:

- payee;
- account category;
- tax code;
- class;
- location;
- memo.

A rule can also automatically add the transaction to the books.

> **Warning**
>
> Automatically posted transactions may bypass the For Review queue. This should be allowed only for low-risk, well-tested rules.

---

## 18. Example Bank Rule

Example: fuel purchases.

```text
Rule name: Fuel
Direction: Money Out
Bank account: Operating Account
Condition: Description contains "FUEL"
Payee: Fuel Various
Category: Fuel and Oil
Tax code: Purchase tax code
Automatic posting: Optional
```

### Recommended rule lifecycle

```text
Draft
    ↓
Tested
    ↓
Approved
    ↓
Active
    ↓
Monitored
    ↓
Suspended
    ↓
Retired
```

---

## 19. Rule Testing and Monitoring

Before activating a rule:

- test it against historical data;
- review false positives;
- review false negatives;
- confirm account mapping;
- confirm tax treatment;
- define a maximum amount;
- define the applicable bank account;
- obtain approval.

### Ongoing monitoring

Track:

- transactions matched by the rule;
- transactions auto-posted;
- exceptions;
- manual overrides;
- reversal rate;
- false-match rate;
- rule owner;
- last review date.

---

## 20. Tags

Tags are customizable labels used to track transactions.

The manual describes:

- tags;
- tag groups;
- transaction-level tagging;
- tag reporting.

Tags may be applied to:

- invoices;
- expenses;
- bills.

The manual notes that tags were not available for all transaction types, such as some journals or transfers.

### Example tag groups

```text
Project
- Project A
- Project B

Sales Channel
- Online
- Store
- Wholesale

Campaign
- Summer Promotion
- Holiday Campaign
```

---

## 21. Receipts

Receipts can be uploaded or emailed to QuickBooks.

The system may:

- extract receipt data;
- suggest a category;
- create a new expense;
- match the receipt to an existing transaction.

### Documented receipt workflow

```text
Banking > Receipts
```

Then:

1. register the sender email;
2. upload or email the receipt;
3. wait for processing;
4. review extracted data;
5. edit, add, or match the receipt.

Supported document formats documented in the manual include:

```text
PDF
JPEG
JPG
GIF
PNG
```

---

## 22. Receipt Review Actions

The manual describes actions such as:

- **Review** - inspect and edit extracted information;
- **Add** - create a new expense;
- **Match** - link the receipt to an existing transaction.

### Important matching note

When both a bank transaction and receipt are in review, the system may require one side to be added before a match is suggested.

---

## 23. Recommended Banking Status Model

```text
Imported
    ↓
For Review
    ↓
Suggested Match
    ↓
Reviewed
    ↓
Approved
    ↓
Posted
    ↓
Reconciled
```

Exception statuses:

```text
Duplicate Suspected
Missing Payee
Missing Category
Invalid Tax Code
Amount Mismatch
Currency Mismatch
Rule Exception
Excluded
Reversed
```

---

## 24. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Duplicate import | Same CSV uploaded twice | File hash and bank transaction ID |
| Incorrect match | Payment applied to wrong invoice | Confidence threshold and review |
| Wrong category | Loan recorded as income | Account and transaction-type validation |
| Wrong tax code | Transfer receives tax | Tax rules by transaction type |
| Uncontrolled auto-posting | Rule posts incorrect expenses | Rule approval and monitoring |
| Hidden exclusion | Transaction removed without reason | Mandatory exclusion reason |
| Split imbalance | Split lines do not equal bank amount | Balance validation |
| Currency mismatch | USD transaction posted to VND account | Currency validation |
| Missing evidence | Expense has no receipt | Attachment exception queue |
| Broken transfer | Only one side of transfer is recorded | Linked double-entry posting |
| Unauthorized batch action | User bulk-accepts transactions | Role-based access and confirmation |
| Stale bank connection | Sync silently stops | Connection health monitoring |

---

## 25. Suggested Database Design

### `bank_connections`

```text
id
bank_name
connection_type
status
consent_expires_at
last_sync_at
last_error
created_by
approved_by
created_at
updated_at
```

### `bank_accounts`

```text
id
connection_id
external_account_id
ledger_account_id
account_name
masked_account_number
currency_code
status
created_at
updated_at
```

### `raw_bank_transactions`

```text
id
bank_account_id
external_transaction_id
transaction_date
posted_date
description
reference
amount
currency_code
raw_payload
source_type
file_hash
import_batch_id
created_at
```

### `bank_transaction_reviews`

```text
id
raw_bank_transaction_id
status
suggested_action
suggested_account_id
suggested_party_id
confidence_score
reviewed_by
approved_by
posted_transaction_id
exclusion_reason
created_at
updated_at
```

### `bank_rules`

```text
id
name
direction
bank_account_id
conditions_json
actions_json
auto_post
status
owner_id
approved_by
last_reviewed_at
created_at
updated_at
```

### Supporting tables

```text
bank_import_batches
bank_match_candidates
bank_transaction_splits
bank_rule_executions
receipt_documents
receipt_extractions
banking_audit_history
```

---

## 26. Recommended Constraints

1. External bank transaction ID must be unique per bank account.
2. File hash must prevent duplicate batch import.
3. Split totals must equal the original bank amount.
4. A transfer must create linked entries.
5. Exclusion requires a reason.
6. Posted transactions cannot be silently deleted.
7. Auto-posting rules require approval.
8. Rule execution must be logged.
9. Currency must match the bank account.
10. One raw bank record must map to one final accounting outcome, unless formally split.

---

## 27. Suggested Matching Engine

A deterministic matching score may use:

```text
Exact reference match: +50
Exact amount match: +25
Date within 3 days: +10
Customer/supplier match: +10
Invoice number match: +20
Currency match: mandatory
Already settled: reject
```

### Example confidence levels

| Score | Action |
|---:|---|
| 90-100 | High-confidence suggestion |
| 70-89 | Review required |
| 40-69 | Weak suggestion |
| Below 40 | No automatic suggestion |

---

## 28. Suggested Workflow

```text
Connect Bank or Upload File
        ↓
Store Raw Bank Data
        ↓
Normalize and Deduplicate
        ↓
Apply Rules
        ↓
Generate Match Candidates
        ↓
Review Exceptions
        ↓
Approve Add / Match / Split / Transfer / Exclude
        ↓
Post Accounting Entry
        ↓
Attach Evidence
        ↓
Reconcile
```

---

## 29. AI Implementation Prompt

```text
Implement a Banking Centre module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Support bank API ingestion and CSV, QFX, QBO, and OFX upload.
- Store raw bank transactions immutably.
- Calculate file hashes and prevent duplicate imports.
- Provide For Review, Categorised, and Excluded queues.
- Support Add, Match, Find Match, Split, Transfer, Exclude, and Batch Actions.
- Require exclusion reasons.
- Validate currency, tax code, account, and split totals.
- Implement deterministic matching using reference, amount, date, party, invoice, and currency.
- Store match confidence scores.
- Support partial and multi-document matching.
- Implement linked transfer entries.
- Support approved bank rules with conditions and actions.
- Support optional auto-posting only for approved low-risk rules.
- Log every rule execution and manual override.
- Support receipt upload, extraction, review, add, and match workflows.
- Add attachment security, audit history, pagination, search, filters, sticky headers, and exception queues.
- Include unit and integration tests for imports, duplicates, matching, splits, transfers, exclusions, rule execution, and permissions.
```

---

## 30. Internal System Checklist

- [ ] Bank connections are monitored.
- [ ] Raw bank records are immutable.
- [ ] Duplicate detection is enabled.
- [ ] For Review items do not affect the ledger.
- [ ] Match confidence is visible.
- [ ] Split transactions balance.
- [ ] Transfers create linked entries.
- [ ] Exclusions require reasons.
- [ ] Auto-post rules require approval.
- [ ] Rule performance is reviewed.
- [ ] Receipt evidence is retained.
- [ ] Batch actions are controlled.
- [ ] Posted transactions are auditable.
- [ ] Banking records reconcile to the general ledger.

---

## Related Topics

- [05. Audit Log](05_Audit_Log.md)
- [06. Chart of Accounts](06_Chart_of_Accounts.md)
- [09. Multi-Currency](09_Multi_Currency.md)
- [10. Importing Data](10_Importing_Data.md)
- Expenses and Bills
- Customer Payments
- Bank Reconciliation
- Reports Centre

---

## Keywords

Banking Centre, bank feed, direct feed, standard feed, bank import, CSV, QFX, OFX, For Review, Categorised, Excluded, bank match, split transaction, transfer, bank rule, receipt capture, transaction categorization, reconciliation