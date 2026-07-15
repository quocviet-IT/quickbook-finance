# 16. Recurring Transactions

> Source scope: *QuickBooks Online Business User Manual*, Version 4 - July 2022, pages 76-77.

## Purpose

This chapter explains how QuickBooks Online uses recurring transaction templates to reduce repeated data entry for transactions that occur regularly with similar information.

It also translates the documented QuickBooks workflow into design requirements for an internal accounting system with scheduling, approvals, exception handling, automatic posting, and audit controls.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. The manual states that recurring transactions were available in the Essentials and Plus plans, but not in Simple Start. Current subscription features may differ.

---

## 1. What a Recurring Transaction Is

A recurring transaction is a reusable template for a transaction that occurs repeatedly with substantially the same information.

Examples include:

- monthly rent;
- internet and telephone charges;
- subscription fees;
- recurring customer invoices;
- insurance payments;
- equipment leases;
- management fees;
- scheduled transfers;
- fixed supplier bills.

Instead of creating the same transaction from the beginning each period, the system stores a template and uses it to create the next occurrence.

---

## 2. Open the Recurring Transactions List

Navigate to:

```text
Gear Icon > Lists > Recurring Transactions
```

The recurring transaction list should show key information such as:

| Field | Purpose |
|---|---|
| Template name | Identifies the recurring process |
| Transaction type | Invoice, bill, expense, journal, etc. |
| Schedule mode | Automatic or manual |
| Frequency | Daily, weekly, monthly, yearly, etc. |
| Previous date | Most recent generated occurrence |
| Next date | Next planned occurrence |
| Customer or supplier | Related party |
| Amount | Default transaction amount |
| Status | Active, paused, expired, or archived |

---

## 3. Documented Operating Modes

The manual describes two primary ways recurring transactions can operate.

### 3.1 Scheduled Automatic Creation

When a template is scheduled, QuickBooks Online can automatically post the transaction according to the configured schedule.

Recurring invoices may also be configured to email automatically to customers.

Example:

```text
Monthly invoice template
        ↓
Scheduled date arrives
        ↓
Invoice is created automatically
        ↓
Invoice is emailed to the customer
```

### 3.2 Manual Creation from a Template

A recurring template may also be used for manual entry.

The user opens the template and updates values such as:

- transaction date;
- amount;
- description;
- quantity;
- rate;
- tax treatment.

This approach is appropriate when the transaction repeats but the exact values vary.

---

## 4. Recommended Template Modes

An internal accounting system should support three controlled modes.

| Mode | Behavior | Suitable use |
|---|---|---|
| Scheduled | Creates or posts automatically | Fixed, low-risk transactions |
| Reminder | Notifies a user before creation | Transactions requiring review |
| Unscheduled | Reusable manual template | Irregular or variable transactions |

> **Design recommendation**
>
> The Reminder mode is a recommended control for internal systems. The source manual mainly distinguishes automatic scheduled posting from manual use of a template.

---

## 5. Create a Recurring Template

A controlled setup process should capture:

| Field | Description |
|---|---|
| Template name | Unique name |
| Transaction type | Invoice, expense, bill, journal, etc. |
| Mode | Scheduled, reminder, or unscheduled |
| Frequency | Daily, weekly, monthly, quarterly, yearly |
| Start date | First eligible occurrence |
| End date | Optional final occurrence |
| Next run date | Next planned generation |
| Customer or supplier | Related party |
| Currency | Transaction currency |
| Default amount | Template amount |
| Ledger accounts | Posting accounts |
| Tax codes | Default tax treatment |
| Payment terms | Due-date calculation |
| Email settings | Automatic sending rules |
| Approval rule | Required reviewer or approver |
| Status | Draft, active, paused, expired |

---

## 6. Frequency Configuration

Common frequencies include:

```text
Daily
Weekly
Every two weeks
Monthly
Every two months
Quarterly
Half-yearly
Yearly
Custom interval
```

A schedule must define how dates behave when the target day does not exist.

Example:

```text
Scheduled day: 31
February occurrence: last valid day of February
```

### Recommended date rules

- specify the business timezone;
- define weekend behavior;
- define public-holiday behavior;
- define month-end behavior;
- define leap-year behavior;
- store the next-run calculation;
- prevent duplicate occurrences.

---

## 7. Recurring Invoice Example

Example configuration:

```text
Template name: Monthly Support Fee
Transaction type: Invoice
Mode: Scheduled
Frequency: Monthly
Start date: 2026-08-01
Customer: Example Customer
Amount: USD 1,000
Terms: Net 15
Auto-email: Enabled
```

Workflow:

```text
Schedule becomes due
        ↓
System creates invoice
        ↓
Invoice receives a unique number
        ↓
Invoice is sent to the customer
        ↓
Delivery status is recorded
        ↓
Payment is received and matched
```

---

## 8. Variable Recurring Transactions

Some recurring transactions do not have a fixed amount.

Examples:

- utilities;
- commissions;
- variable subscriptions;
- monthly service hours;
- usage-based invoices;
- credit-card charges.

For these transactions, use:

- Reminder mode; or
- Unscheduled template mode.

The user should review and update variable fields before posting.

---

## 9. Automatic Posting Controls

Automatic posting should be limited to predictable, low-risk transactions.

Recommended conditions:

- template is approved;
- customer or supplier is active;
- ledger accounts are active;
- tax codes are valid;
- currency is valid;
- amount is within an approved threshold;
- accounting period is open;
- no duplicate occurrence exists;
- required attachments are present;
- schedule has not expired.

If any validation fails, the occurrence should enter an exception queue instead of posting.

---

## 10. Automatic Email Controls

For recurring invoices, automatic email should store:

- recipient;
- CC and BCC;
- subject;
- message body;
- template version;
- invoice number;
- sent time;
- delivery status;
- bounce or failure reason.

Recommended delivery statuses:

```text
Queued
Sent
Delivered
Viewed
Failed
Bounced
```

An email failure should not silently cancel the accounting transaction.

---

## 11. Template Versioning

Editing an active recurring template should create a new version rather than overwrite prior configuration.

Example:

```text
Monthly Rent - Version 1
Effective: 2026-01-01 to 2026-06-30
Amount: 5,000

Monthly Rent - Version 2
Effective: 2026-07-01 onward
Amount: 5,500
```

Each generated transaction must retain the exact template version used.

---

## 12. Change Management

Changes that should require review include:

- amount;
- customer or supplier;
- ledger account;
- tax code;
- schedule;
- currency;
- auto-post setting;
- auto-email setting;
- end date;
- payment terms.

### Recommended change record

```text
Template
Previous value
New value
Changed by
Changed at
Reason
Approved by
Effective date
```

---

## 13. Pause, Resume, and End

A recurring template should support:

| Action | Result |
|---|---|
| Pause | Stops future generation temporarily |
| Resume | Restarts future generation |
| End | Stops generation after a defined date |
| Archive | Removes from active use but preserves history |

### Recommended rule

Pausing or ending a template should not delete transactions that have already been generated.

---

## 14. Missed Occurrences

A scheduled job may fail because of:

- system outage;
- expired authorization;
- closed accounting period;
- invalid account;
- inactive customer or supplier;
- email failure;
- validation error.

The system should record:

- scheduled occurrence time;
- failure time;
- failure reason;
- retry count;
- next retry;
- resolution status.

### Retry principle

Retries must be idempotent so that the same occurrence is not created twice.

---

## 15. Duplicate Prevention

Each generated occurrence should have a unique idempotency key.

Example:

```text
template_id + scheduled_date + entity_id
```

A database constraint should prevent a second transaction from being generated for the same scheduled occurrence.

---

## 16. Review Queue

Recurring transactions requiring review should enter a queue with statuses such as:

```text
Pending Review
Ready to Post
Validation Failed
Approval Required
Posted
Skipped
Cancelled
```

Useful queue filters include:

- due today;
- overdue;
- transaction type;
- customer or supplier;
- amount;
- legal entity;
- currency;
- exception type;
- approver.

---

## 17. Approval Workflow

Recommended approval examples:

| Template or occurrence | Approval |
|---|---|
| Low-value fixed rent | Initial template approval |
| High-value recurring bill | Approval for each occurrence |
| Recurring journal | Accountant and controller |
| Customer invoice with fixed contract | Initial approval and periodic review |
| Variable monthly expense | Review before posting |
| Template amount increase | Finance approval |

A system should support both:

- template-level approval;
- occurrence-level approval.

---

## 18. Accounting Period Controls

The scheduler must check whether the accounting period is open.

When the intended period is locked:

- do not post automatically;
- move the occurrence to an exception queue;
- notify the responsible user;
- require an approved date adjustment or reopening process.

The system should never silently post into another period.

---

## 19. Tax and Currency Controls

Before generating a transaction, validate:

- tax registration;
- tax code;
- tax rate effective date;
- customer or supplier tax treatment;
- transaction currency;
- exchange rate;
- ledger currency compatibility.

For foreign-currency templates, retain:

- transaction currency;
- scheduled exchange-rate policy;
- actual rate used;
- rate date;
- source;
- manual override reason.

---

## 20. Recommended Recurring Status Model

### Template status

```text
Draft
    ↓
Pending Approval
    ↓
Active
    ↓
Paused
    ↓
Expired
    ↓
Archived
```

### Occurrence status

```text
Scheduled
    ↓
Generated
    ↓
Pending Review
    ↓
Approved
    ↓
Posted
```

Exception outcomes:

```text
Failed
Skipped
Cancelled
Reversed
```

---

## 21. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Duplicate generation | Scheduler retries and creates two invoices | Idempotency key |
| Obsolete template | Old contract continues billing | End date and periodic review |
| Wrong amount | Template not updated after price change | Versioning and approval |
| Closed-period posting | Transaction posts to locked month | Period validation |
| Invalid tax | Old tax code remains in template | Effective-date validation |
| Email failure | Invoice created but customer not notified | Delivery exception queue |
| Unauthorized auto-post | User activates high-risk template | Role-based approval |
| Inactive supplier | Bill posts to former supplier | Master-data validation |
| Missing evidence | Recurring expense lacks contract | Attachment requirement |
| Hidden schedule change | Next date modified without history | Immutable audit log |

---

## 22. Suggested Database Design

### `recurring_templates`

```text
id
template_name
transaction_type
mode
frequency_type
frequency_interval
timezone
start_date
end_date
next_run_at
customer_id
supplier_id
currency_code
default_amount
auto_post
auto_email
status
current_version
created_by
approved_by
created_at
updated_at
```

### `recurring_template_versions`

```text
id
template_id
version_number
configuration_json
effective_from
effective_to
change_reason
created_by
approved_by
created_at
```

### `recurring_occurrences`

```text
id
template_id
template_version_id
scheduled_at
idempotency_key
status
generated_transaction_id
failure_reason
retry_count
created_at
updated_at
```

### `recurring_approvals`

```text
id
template_id
occurrence_id
approval_type
status
requested_by
reviewed_by
reviewed_at
comment
```

### Supporting tables

```text
recurring_schedule_exceptions
recurring_email_logs
recurring_retry_logs
recurring_audit_history
recurring_attachments
```

---

## 23. Recommended Constraints

1. Template name must be unique within the legal entity.
2. Start date must not be after end date.
3. Next run date must follow the frequency rule.
4. Idempotency key must be unique.
5. Inactive parties cannot be used for new occurrences.
6. Scheduled templates require an approved timezone.
7. Auto-post templates require approval.
8. Generated transactions cannot be overwritten by template changes.
9. Closed periods cannot receive automatic postings.
10. Template versions must be immutable after activation.

---

## 24. Scheduler Design

A reliable scheduler should:

1. find due active templates;
2. lock the template or occurrence;
3. calculate the intended transaction date;
4. generate an idempotency key;
5. validate the template;
6. create the occurrence record;
7. create or queue the transaction;
8. send email where enabled;
9. calculate the next run date;
10. record success or failure.

Pseudo-flow:

```text
Find due templates
        ↓
Acquire lock
        ↓
Check idempotency
        ↓
Validate
        ↓
Generate transaction or review task
        ↓
Record outcome
        ↓
Calculate next run
        ↓
Release lock
```

---

## 25. AI Implementation Prompt

```text
Implement a recurring-transactions module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Support scheduled, reminder, and unscheduled template modes.
- Support recurring invoices, bills, expenses, journals, and transfers.
- Support daily, weekly, monthly, quarterly, yearly, and custom frequencies.
- Store timezone and explicit month-end, weekend, and holiday behavior.
- Add start date, end date, next run date, pause, resume, expire, and archive functions.
- Support template-level and occurrence-level approval.
- Create immutable template versions.
- Preserve the template version used by each generated transaction.
- Use a unique idempotency key per scheduled occurrence.
- Prevent duplicate generation during retries or concurrent scheduler runs.
- Validate parties, accounts, tax codes, currencies, amounts, and accounting periods before posting.
- Route validation failures to an exception queue.
- Support automatic invoice email with delivery status.
- Support retries with failure history.
- Prevent automatic posting into locked periods.
- Maintain immutable audit history.
- Add search, filters, pagination, upcoming schedules, overdue occurrences, and exception dashboards.
- Include unit and integration tests for date calculation, month end, leap year, idempotency, permissions, approvals, retries, and period locks.
```

---

## 26. Internal System Checklist

- [ ] Template modes are defined.
- [ ] Frequency and timezone are stored.
- [ ] Start and end dates are validated.
- [ ] Auto-posting requires approval.
- [ ] Variable transactions require review.
- [ ] Template versions are preserved.
- [ ] Idempotency prevents duplicate generation.
- [ ] Failed occurrences enter an exception queue.
- [ ] Closed-period postings are blocked.
- [ ] Tax and currency are validated.
- [ ] Email delivery status is recorded.
- [ ] Pause and resume are supported.
- [ ] Expired templates stop generating transactions.
- [ ] Recurring templates are reviewed periodically.
- [ ] Generated transactions reconcile to the ledger.

---

## Related Topics

- [05. Audit Log](05_Audit_Log.md)
- [09. Multi-Currency](09_Multi_Currency.md)
- [13. Quotes and Invoices](13_Quotes_and_Invoices.md)
- [15. Expenses and Bills](15_Expenses_and_Bills.md)
- Accounting Period Close
- Approval Workflows
- Automated Reports

---

## Keywords

Recurring Transactions, recurring template, scheduled transaction, automatic posting, recurring invoice, recurring bill, recurring expense, reminder, unscheduled template, scheduler, idempotency, retry, template versioning, automatic email