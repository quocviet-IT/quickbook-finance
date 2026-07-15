# 21. Bank Reconciliation

> Source scope: *QuickBooks Online Business User Manual*, Version 4 - July 2022, pages 102-106.

## Purpose

This chapter explains the bank-reconciliation workflow documented in QuickBooks Online, including statement setup, transaction matching, discrepancy investigation, reconciliation reports, and automatic reconciliation adjustments.

It also translates the documented workflow into practical controls and implementation requirements for an internal accounting system.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. Interface labels and available actions may differ in current versions.
>
> A reconciliation should normally be completed only when the difference is exactly zero. Forced adjustments should be treated as exceptions requiring investigation and approval.

---

## 1. What Bank Reconciliation Is

Bank reconciliation compares the accounting-system balance with the corresponding bank or credit-card statement.

The objective is to confirm that:

- all legitimate bank transactions are recorded;
- duplicate transactions are removed;
- missing transactions are identified;
- transfers are recorded correctly;
- bank fees and interest are included;
- transaction amounts and dates are accurate;
- the accounting balance agrees with the external statement.

Core equation:

```text
Statement Ending Balance
- Cleared Accounting Balance
= Reconciliation Difference
```

The target result is:

```text
Difference = 0.00
```

---

## 2. Accounts That Can Be Reconciled

The source manual states that the same reconciliation process can be used for Balance Sheet accounts, except retained earnings.

Common reconciliation targets include:

- bank accounts;
- credit-card accounts;
- loan accounts;
- clearing accounts;
- payment-gateway accounts;
- cash-on-hand accounts;
- selected asset and liability control accounts.

### Recommended policy

Define which account types are eligible for reconciliation and assign a responsible owner and review frequency to each account.

---

## 3. Prerequisites

The source notes that reconciliation is nearly complete after online banking feeds have been processed.

Before starting, verify:

- [ ] Bank-feed or uploaded transactions have been reviewed.
- [ ] Duplicate imports have been resolved.
- [ ] Transfers are linked correctly.
- [ ] Customer and supplier payments have been matched.
- [ ] Bank fees and interest are recorded.
- [ ] The previous reconciliation is complete.
- [ ] The bank statement is available.
- [ ] The statement account and currency are correct.
- [ ] The accounting period is open.
- [ ] Beginning-balance discrepancies have been resolved.

---

## 4. Open the Reconciliation Area

Navigate to:

```text
Accounting > Reconcile
```

For first-time use, the documented screen may show:

```text
How it works > Get Started
```

After the initial setup, the Reconcile window opens directly.

---

## 5. Select the Account

In the Reconcile window, choose the bank or credit-card account from the dropdown list.

The screen displays:

- last statement ending date;
- beginning balance;
- selected account;
- fields for ending balance and ending date.

### Meaning of beginning balance

The beginning balance represents the balance at the end of the most recently completed reconciliation.

Recommended validation:

```text
Current Reconciliation Beginning Balance
= Previous Reconciliation Ending Balance
```

If the values do not agree, investigate before proceeding.

---

## 6. Enter Statement Information

Enter the values directly from the external statement:

| Field | Description |
|---|---|
| Ending balance | Balance printed on the bank or credit-card statement |
| Ending date | Statement closing date |
| Account | Account being reconciled |
| Beginning balance | System balance from the prior reconciliation |

Then select:

```text
Start reconciling
```

### Statement controls

- retain the original statement;
- store statement date and ending balance;
- record statement currency;
- capture statement reference or file hash;
- prevent duplicate statement reconciliation;
- require the ending date to follow the prior statement date.

---

## 7. Review Transactions

The Reconcile window displays transactions eligible for the statement period.

The source manual states that previously matched and added bank-feed transactions are automatically ticked.

Transactions imported from direct bank feeds or CSV files may display a bank-feed indicator and be selected automatically.

### Review each item for

- transaction date;
- amount;
- payee or payer;
- account category;
- reference;
- tax code;
- matched source document;
- cleared status;
- duplicate status.

---

## 8. Cleared and Uncleared Transactions

A selected transaction is treated as cleared for the current statement.

An unselected transaction may represent:

- an outstanding cheque;
- a deposit in transit;
- a transaction outside the statement period;
- a duplicate entry;
- an incorrect date;
- an incorrectly recorded amount;
- a transaction belonging to another account;
- a manually entered item not present on the statement.

### Investigation rule

Do not select or remove a transaction only to force the difference to zero. Determine the accounting reason and retain supporting evidence.

---

## 9. Difference Calculation

A reconciliation screen should continuously calculate:

```text
Difference
= Statement Ending Balance
- Reconciled Accounting Balance
```

When all valid statement transactions are selected and recorded correctly:

```text
Difference = 0.00
```

### Recommended display

Show:

- statement ending balance;
- cleared payments;
- cleared deposits;
- cleared accounting balance;
- remaining difference;
- number of uncleared items;
- number of exception items.

---

## 10. Finish or Save the Reconciliation

The source documents these actions:

```text
Finish Now
Save for later
Close without saving
```

### Finish Now

Use when:

- the difference is zero;
- all exceptions are resolved;
- the statement is attached or archived;
- review requirements are complete.

### Save for later

Use when investigation is incomplete.

### Close without saving

Use when the current session should be abandoned without retaining the selections made in that session.

After completion, the Reconcile area summarizes the last reconciled date and ending balance.

---

## 11. Beginning-Balance Discrepancy

The source warns that changing or deleting a previously reconciled transaction may cause the next beginning balance to be incorrect.

QuickBooks may display a warning similar to:

```text
Your account is not ready to reconcile yet.
Your beginning balance is off.
```

The documented action is:

```text
We can help you fix it
```

This opens a Reconciliation Discrepancy Report.

---

## 12. Reconciliation Discrepancy Report

The discrepancy report identifies transactions changed after a completed reconciliation.

Useful fields include:

| Field | Purpose |
|---|---|
| Transaction type | Journal, payment, deposit, expense, etc. |
| Transaction date | Original accounting date |
| Reconciled amount | Amount at reconciliation time |
| Current amount | Amount after modification |
| Difference | Value causing the discrepancy |
| Change type | Amount, date, deletion, or status change |
| History | Link to transaction history |
| Changed by | User who made the change |
| Changed at | Time of modification |

The source directs users to select **View** in the History column and restore the transaction as needed.

---

## 13. Correcting Changed Transactions

When a reconciled transaction has been amended, it may be possible to edit it back to the value recorded at reconciliation time.

Recommended workflow:

```text
Identify Changed Transaction
        ↓
Open Audit History
        ↓
Compare Reconciled and Current Values
        ↓
Determine Correct Accounting Treatment
        ↓
Restore or Post an Approved Correction
        ↓
Re-run Reconciliation
```

### Control requirement

Do not restore a value blindly. Confirm whether the original transaction or the later change is economically correct.

---

## 14. Deleted Reconciled Transactions

The source states that a deleted transaction cannot be restored directly.

A controlled system should instead support:

- soft deletion;
- reversal entries;
- immutable transaction history;
- controlled recreation with reference to the original record;
- approval for changes affecting completed reconciliations.

### Recommended rule

A transaction included in a completed reconciliation should never be permanently deleted from the database.

---

## 15. Reconciliation Reports

To view a completed reconciliation report, the documented workflow is:

```text
Accounting > Reconcile > History by account
```

Then:

1. select the reconciliation;
2. choose **View Report** under the Action column;
3. review the reconciliation summary and transactions.

### Recommended report content

- account;
- statement ending date;
- beginning balance;
- statement ending balance;
- cleared payments;
- cleared deposits;
- reconciliation difference;
- transaction list;
- adjustments;
- preparer;
- reviewer;
- completion time;
- attached statement reference.

---

## 16. Warning on Editing Reconciled Transactions

The source shows that QuickBooks warns users before a reconciled transaction is changed.

An internal system should show a high-visibility warning containing:

- affected reconciliation;
- account;
- statement date;
- current amount;
- proposed amount;
- expected difference;
- reason field;
- approval requirement.

### Recommended permission rule

Only authorized accounting roles should be able to change transactions included in a completed reconciliation.

---

## 17. Automatic Reconciliation Adjustment

The source describes an automatic adjustment when a user finishes a reconciliation while the difference is not zero.

Documented action:

```text
Add adjustment and finish
```

QuickBooks creates an adjustment that forces the reconciliation difference to zero.

The forced amount appears in an Auto Adjustment column and is posted to a Reconciliation Discrepancies account in the Profit and Loss report.

> **High-risk warning**
>
> A forced adjustment hides the unresolved difference from the reconciliation screen but does not explain the underlying accounting error.

---

## 18. Recommended Forced-Adjustment Policy

A production accounting system should either disable forced adjustments or subject them to strict controls.

Minimum controls:

- require an explanation;
- require elevated permission;
- require reviewer approval;
- show the adjustment account;
- attach supporting documents;
- generate an exception alert;
- prohibit use above a configured threshold;
- include the adjustment in month-end review;
- retain a link to the affected reconciliation;
- require a resolution due date.

### Suggested status

```text
Open Exception
Under Investigation
Correction Proposed
Approved
Resolved
Closed
```

---

## 19. Correcting an Incorrect Forced Reconciliation

The source gives a two-step correction process:

1. Open the Profit and Loss report, select the Reconciliation Discrepancies amount, view the transaction report, and delete the forced adjustment.
2. Return to the reconciliation report, undo the incorrect reconciliation, and reconcile the account correctly.

For an internal system, use controlled reversal instead of permanent deletion.

Recommended process:

```text
Identify Forced Adjustment
        ↓
Reverse Adjustment
        ↓
Undo or Reopen Reconciliation
        ↓
Correct Source Transactions
        ↓
Reconcile Again to Zero
        ↓
Review and Approve
```

---

## 20. Undo or Reopen Reconciliation

A completed reconciliation may need to be reopened when:

- the wrong statement date was used;
- the wrong ending balance was entered;
- transactions were omitted;
- transactions were incorrectly included;
- a forced adjustment was used;
- the wrong account was reconciled.

### Reopen controls

- require a reason;
- require elevated permission;
- retain the original reconciliation snapshot;
- record the user and timestamp;
- invalidate dependent reports where necessary;
- require reapproval after completion.

---

## 21. Recommended Reconciliation Status Model

```text
Draft
    ↓
In Progress
    ↓
Exception Review
    ↓
Ready for Approval
    ↓
Completed
    ↓
Locked
```

Alternative statuses:

```text
Saved for Later
Reopened
Undone
Superseded
Cancelled
```

---

## 22. Segregation of Duties

Recommended role separation:

| Activity | Role |
|---|---|
| Process bank feeds | Bookkeeper |
| Prepare reconciliation | Accountant |
| Investigate discrepancies | Accountant or senior bookkeeper |
| Approve reconciliation | Finance manager or controller |
| Reopen completed reconciliation | Restricted administrator/controller |
| Approve forced adjustment | Senior finance approver |
| Review reconciliation reports | Internal control or management |

The person who prepares the reconciliation should not be the only person approving material discrepancies or forced adjustments.

---

## 23. Reconciliation Frequency

Suggested frequency by account risk:

| Account | Suggested frequency |
|---|---|
| High-volume operating bank account | Daily or weekly monitoring; monthly formal reconciliation |
| Credit card | Monthly |
| Payroll clearing | Every pay run and month-end |
| Payment gateway | Daily or weekly |
| Loan account | Monthly |
| Petty cash | Monthly or at each count |
| Low-activity balance-sheet account | Monthly or quarterly |

The exact schedule should follow company policy and transaction risk.

---

## 24. Reconciliation Exceptions

Common exceptions include:

- statement transaction missing from the ledger;
- ledger transaction missing from the statement;
- duplicate transaction;
- incorrect amount;
- incorrect date;
- unmatched transfer;
- stale outstanding cheque;
- unidentified deposit;
- foreign-exchange difference;
- bank fee or interest not recorded;
- previously reconciled transaction changed;
- forced adjustment.

Each exception should have:

- owner;
- reason;
- amount;
- age;
- action plan;
- due date;
- status;
- supporting evidence.

---

## 25. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Incorrect beginning balance | Prior reconciled transaction was changed | Discrepancy report and transaction history |
| Forced zero difference | Adjustment hides missing transaction | Disable or tightly approve adjustments |
| Duplicate transaction | CSV and bank feed import the same item | External ID and file-hash controls |
| Wrong statement period | User enters incorrect ending date | Date validation and statement attachment |
| Unauthorised change | User edits reconciled payment | Permission and warning workflow |
| Permanent deletion | Reconciled transaction disappears | Soft delete and reversal policy |
| Unreviewed stale items | Old uncleared cheque remains open | Outstanding-item ageing report |
| Wrong account | Statement reconciled against another ledger account | Account confirmation step |
| Incomplete evidence | No bank statement retained | Mandatory statement attachment |
| Self-approval | Preparer also approves | Segregation of duties |

---

## 26. Recommended Database Design

### `reconciliations`

```text
id
account_id
statement_start_date
statement_end_date
beginning_balance
ending_balance
cleared_balance
difference
currency_code
status
statement_document_id
prepared_by
reviewed_by
approved_by
completed_at
locked_at
created_at
updated_at
```

### `reconciliation_lines`

```text
id
reconciliation_id
transaction_id
transaction_date
transaction_amount
cleared_amount
cleared_status
match_source
exception_status
created_at
updated_at
```

### `reconciliation_discrepancies`

```text
id
reconciliation_id
transaction_id
discrepancy_type
reconciled_value
current_value
difference_amount
status
owner_id
resolution_reason
resolved_at
created_at
updated_at
```

### `reconciliation_adjustments`

```text
id
reconciliation_id
journal_entry_id
adjustment_amount
adjustment_account_id
reason
status
approved_by
reversed_by
reversed_at
created_at
```

### Supporting tables

```text
reconciliation_versions
reconciliation_approvals
reconciliation_reopen_requests
reconciliation_documents
reconciliation_audit_history
```

---

## 27. Recommended Constraints

1. Account and statement ending date must be unique for completed reconciliations unless formally reopened.
2. Statement ending date must follow the previous completed reconciliation date.
3. Beginning balance must equal the prior ending balance, subject to approved corrections.
4. Completed reconciliation difference must equal zero unless an approved adjustment exists.
5. Reconciled transactions cannot be permanently deleted.
6. Adjustment amounts require a reason and approval.
7. Locked reconciliations cannot be changed directly.
8. Reopening requires an immutable reason and approver.
9. Statement currency must match the account currency.
10. Every reconciliation line must reference a valid accounting transaction.

---

## 28. Suggested Workflow

```text
Process Bank Feeds
        ↓
Obtain Bank Statement
        ↓
Select Account
        ↓
Validate Beginning Balance
        ↓
Enter Ending Balance and Date
        ↓
Review Cleared Transactions
        ↓
Investigate Exceptions
        ↓
Reach Difference 0.00
        ↓
Reviewer Approval
        ↓
Finish and Lock
        ↓
Archive Report and Statement
```

Exception path:

```text
Beginning Balance Error
        ↓
Run Discrepancy Report
        ↓
Review Audit History
        ↓
Correct or Reverse Transaction
        ↓
Reconcile Again
```

---

## 29. AI Implementation Prompt

```text
Implement a bank-reconciliation module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Support bank, credit-card, loan, clearing, and approved balance-sheet accounts.
- Store statement beginning date, ending date, beginning balance, ending balance, currency, and statement attachment.
- Load eligible accounting transactions and show cleared and uncleared states.
- Continuously calculate cleared payments, cleared deposits, cleared balance, and reconciliation difference.
- Require the final difference to equal zero.
- Support save-for-later, review, approve, complete, lock, reopen, and undo workflows.
- Detect changes to previously reconciled transactions.
- Generate a reconciliation discrepancy report with before-and-after values and audit history.
- Prevent permanent deletion of reconciled transactions.
- Support controlled reversals and correction entries.
- Disable forced reconciliation adjustments by default.
- When adjustments are enabled, require reason, amount threshold, approval, exception owner, and resolution due date.
- Preserve immutable reconciliation snapshots and versions.
- Require approval to reopen or undo a completed reconciliation.
- Provide reconciliation history by account, outstanding-item ageing, adjustment, and discrepancy reports.
- Enforce segregation of duties and role-based permissions.
- Include unit and integration tests for beginning balances, difference calculation, transaction changes, duplicate statements, locking, reopening, adjustments, permissions, and audit history.
```

---

## 30. Internal System Checklist

- [ ] Bank feeds are processed before reconciliation.
- [ ] The correct account is selected.
- [ ] The statement is attached or archived.
- [ ] Beginning balance matches the prior reconciliation.
- [ ] Ending balance and date match the statement.
- [ ] Cleared transactions are reviewed.
- [ ] Duplicate and missing transactions are resolved.
- [ ] Unmatched transfers are investigated.
- [ ] Difference equals 0.00.
- [ ] Material exceptions are independently reviewed.
- [ ] Completed reconciliation is locked.
- [ ] Reconciliation report is retained.
- [ ] Changes to reconciled transactions generate alerts.
- [ ] Reopening requires a reason and approval.
- [ ] Forced adjustments are prohibited or tightly controlled.
- [ ] Outstanding reconciliation items are aged and monitored.

---

## Related Topics

- [05. Audit Log](05_Audit_Log.md)
- [06. Chart of Accounts](06_Chart_of_Accounts.md)
- [09. Multi-Currency](09_Multi_Currency.md)
- [12. Banking Centre](12_Banking_Centre.md)
- [15. Expenses and Bills](15_Expenses_and_Bills.md)
- [20. Cash Flow](20_Cash_Flow.md)
- GST and BAS
- Reports Centre
- Accounting Period Close

---

## Keywords

Bank Reconciliation, reconciliation report, beginning balance, ending balance, statement date, cleared transaction, discrepancy report, reconciliation adjustment, forced reconciliation, undo reconciliation, bank statement, reconciliation difference, outstanding item