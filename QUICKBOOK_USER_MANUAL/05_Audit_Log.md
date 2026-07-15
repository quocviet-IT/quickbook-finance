# 05. Audit Log

> **Source scope:** QuickBooks Online Business User Manual, Version 4 - July 2022, pages 26-28.

## Purpose

This chapter explains how QuickBooks Online records transaction and user activity, how to filter the Audit Log, and how to inspect the history of an individual transaction.

> **Important**
>
> The workflow reflects the Australian QuickBooks Online interface documented in July 2022. Menu names and screen layouts may have changed, but the internal-control principles remain useful when designing or reviewing an accounting system.

---

## 1. What the Audit Log Records

QuickBooks Online maintains an audit trail when financial information is:

- added;
- changed;
- deleted;
- accessed through certain user or system activities.

The audit history is intended to show:

- who performed the action;
- when the action occurred;
- what record was affected;
- what type of change was made;
- the sequence of changes during the record's history.

The source manual emphasizes that the audit history is a permanent control record and should not be treated as ordinary editable transaction data.

> **Control principle**
>
> A reliable accounting system should not allow ordinary users or administrators to silently remove historical audit events.

---

## 2. Open the Audit Log

Use the following navigation path:

```text
Gear icon > Tools > Audit Log
```

The Audit Log displays activity across the company file.

Depending on the available interface and permissions, the screen may show information such as:

- date and time;
- user;
- event type;
- transaction or record name;
- action performed;
- history or view link.

---

## 3. Filter the Audit Log

The source manual documents filters for:

- **Users** - limit results to actions performed by a selected user;
- **Dates** - limit results to a date range;
- **Events** - limit results to a category of activity.

### Recommended review sequence

1. Select the relevant date range.
2. Select a specific user when investigating accountability.
3. Select the event category.
4. Review the matching entries.
5. Open the transaction history for material or unusual changes.
6. Export or print evidence when required for review.

### Practical filter examples

| Review objective | Suggested filter |
|---|---|
| Identify changes made during month-end close | Date range + accounting users |
| Investigate a deleted transaction | Event type for deleted transactions |
| Review activity by a departing employee | User + employment period |
| Confirm changes after a tax return was prepared | Date range after preparation date |
| Review integration activity | Application or system-originated events, when available |

---

## 4. View and Print Audit Information

The source manual notes that Audit Log results can be printed using the print icon.

The displayed columns may also be adjusted using the column or settings control near the top of the table.

### Good evidence-handling practice

When audit evidence is required:

- retain the selected filters;
- record the review purpose;
- preserve the date and time of extraction;
- include the reviewer name;
- avoid relying only on screenshots when a structured export is available;
- store the evidence in a controlled review folder.

---

## 5. Open Transaction History

From the main Audit Log, select **View** under the history-related column to inspect a record in more detail.

An individual transaction's audit history can also be opened from inside the transaction:

```text
Open transaction > More > Audit history
```

This is useful when investigating a specific:

- invoice;
- bill;
- expense;
- payment;
- journal entry;
- bank transaction;
- other accounting record.

---

## 6. What to Review in a Transaction Audit

For each material transaction, review:

| Review area | Questions |
|---|---|
| Creation | Who created the transaction and when? |
| Modification | Which fields or amounts changed? |
| Deletion | Was the transaction deleted, voided, or made inactive? |
| Approval | Was the change approved by an authorized person? |
| Timing | Did the change occur before or after period close? |
| Source | Was the action created by a user, import, bank feed, or connected app? |
| Evidence | Is the supporting document still attached? |
| Business reason | Is the reason for the change documented? |

---

## 7. Common Audit Events

A well-designed accounting audit log should capture events such as:

- user sign-in and sign-out;
- failed access attempts;
- creation of master data;
- changes to customers, suppliers, products, or accounts;
- transaction creation;
- transaction edits;
- transaction deletion or voiding;
- changes to tax codes;
- changes to bank details;
- changes to user permissions;
- configuration changes;
- import and integration activity;
- period locking and unlocking;
- approval and rejection events.

---

## 8. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Audit events can be deleted | An administrator removes evidence of a change | Append-only audit storage and restricted retention controls |
| Shared user accounts | Multiple employees use one login | Require individual accounts and prohibit credential sharing |
| Missing before-and-after values | Log shows that a record changed but not how | Store field-level old and new values |
| Changes after close | A user edits a locked-period transaction | Period lock, approval workflow, and exception reporting |
| Excessive administrator access | Too many users can change permissions | Least-privilege roles and periodic access review |
| Integration changes are unclear | API updates are shown as a generic user | Record application ID, request ID, and integration source |
| No documented reason | A transaction is materially changed without explanation | Require a change reason for sensitive fields |
| Audit data is not reviewed | Logs exist but suspicious activity is missed | Scheduled audit reviews and alert rules |

---

## 9. Recommended Audit Review Checklist

### Daily or operational review

- [ ] Review failed imports or integration errors.
- [ ] Review deleted or voided financial transactions.
- [ ] Review changes to bank details and payment information.
- [ ] Review unusual administrator activity.

### Month-end review

- [ ] Review transactions changed after initial reconciliation.
- [ ] Review entries posted to prior periods.
- [ ] Review manual journal entries.
- [ ] Review changes to tax codes and control accounts.
- [ ] Review period unlock events.
- [ ] Confirm approval evidence for material corrections.

### User-access review

- [ ] Confirm every active user still requires access.
- [ ] Remove or disable access for departed staff.
- [ ] Review administrator assignments.
- [ ] Review changes to roles and permissions.
- [ ] Confirm that shared accounts are not being used.

---

## 10. Application to an Internal Accounting System

A custom accounting platform should implement audit logging as a core accounting control, not as an optional reporting feature.

### Suggested audit entity

```text
audit_events
```

### Suggested fields

| Field | Purpose |
|---|---|
| `id` | Unique audit-event identifier |
| `occurred_at` | Server-generated event timestamp |
| `actor_user_id` | User who performed the action |
| `actor_role` | User role at the time of the action |
| `source_type` | Web, API, import, job, integration, or system |
| `source_id` | Application, job, or integration identifier |
| `action` | Create, update, delete, void, approve, reject, lock, or unlock |
| `entity_type` | Transaction, customer, account, user, configuration, and similar entities |
| `entity_id` | Identifier of the affected record |
| `before_data` | Previous values in structured form |
| `after_data` | New values in structured form |
| `changed_fields` | List of changed attributes |
| `reason` | Business reason supplied by the user |
| `request_id` | Trace identifier for one request or workflow |
| `ip_address` | Network origin when appropriate and legally permitted |
| `user_agent` | Client information when appropriate |
| `metadata` | Additional structured context |

### Recommended database rules

1. Generate timestamps on the server.
2. Prevent normal application roles from updating or deleting audit events.
3. Capture before-and-after data inside the same database transaction as the business change.
4. Record API and integration identities separately from human users.
5. Store a request or correlation ID for end-to-end tracing.
6. Protect sensitive values from unnecessary exposure in the audit payload.
7. Define a documented retention and archive policy.
8. Alert reviewers when high-risk events occur.

---

## 11. Suggested Workflow

```text
User or Integration Requests Change
        |
        v
Validate Permission and Period Status
        |
        v
Capture Previous Values
        |
        v
Apply Business Transaction
        |
        v
Write Immutable Audit Event
        |
        v
Commit Both Records Atomically
        |
        v
Send Alert or Add to Review Queue When Required
```

The business change and audit event should succeed or fail together. This prevents a transaction from changing without a corresponding history record.

---

## 12. High-Risk Event Alerts

Consider automatic alerts for:

- transaction deletion;
- period unlocking;
- changes to supplier bank accounts;
- role elevation to administrator;
- disabling audit or security controls;
- large manual journal entries;
- changes to reconciled transactions;
- repeated failed sign-in attempts;
- bulk imports or bulk deletions;
- changes initiated by an unknown integration.

---

## 13. AI Implementation Prompt

```text
Implement an immutable audit-log module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL

Requirements:
- Record create, update, delete, void, approve, reject, lock, unlock, import, and integration events.
- Capture actor, role, timestamp, source, entity type, entity ID, request ID, reason, changed fields, and before/after values.
- Write the business change and audit event in one database transaction.
- Prevent normal users and application roles from updating or deleting audit rows.
- Record human users, system jobs, and external integrations distinctly.
- Provide filters for user, date range, event type, source, entity type, and entity ID.
- Provide a transaction-level audit-history drawer or page.
- Add alerts for transaction deletion, period unlock, bank-detail changes, administrator-role changes, and edits to reconciled transactions.
- Apply row-level security and redact secrets or unnecessary personal data from audit payloads.
- Include tests proving that failed business transactions do not create partial audit records and successful changes cannot occur without an audit event.
```

---

## 14. Related Topics

- [03. Company Setup](03_Company_Setup.md)
- [04. GST Setup](04_GST_Setup.md)
- Managing Users
- Chart of Accounts
- Bank Reconciliation
- Period Close and Locking
- Role-Based Access Control

---

## Keywords

Audit Log, audit history, transaction history, immutable log, before and after values, internal control, user activity, period lock, administrator access, accounting audit trail, API audit, integration audit, change tracking