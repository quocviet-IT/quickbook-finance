# 24. Mobile App

> Source scope: *QuickBooks Online Business User Manual*, Version 4 - July 2022, pages 123-125.

## Purpose

This chapter explains the QuickBooks Online mobile workflow documented for iPhone, iPad, and Android devices. It covers mobile installation, navigation, quote creation, customer signature capture, quote-to-invoice conversion, expense capture, attachments, and report access.

It also translates the documented workflow into design requirements for a secure mobile accounting application.

> **Important**
>
> This chapter reflects the QuickBooks Australia mobile experience documented in July 2022. Current app-store availability, navigation, device support, permissions, and feature parity may differ.

---

## 1. Mobile Capabilities

The source manual describes mobile access to business information, customers, and suppliers from supported iPhone, iPad, and Android devices.

Documented capabilities include:

- creating and sending professional invoices and quotes;
- taking photos of receipts and organizing daily expenses;
- converting a quote to an invoice;
- adding photos and notes to quotes, invoices, sales receipts, customers, and expenses;
- receiving overdue-invoice notifications;
- tracking payments and recording sales;
- viewing Profit and Loss and Balance Sheet reports.

### Mobile workflow overview

```text
Install Mobile App
        ↓
Sign In
        ↓
Select Quick Action or Menu
        ↓
Create or Review Transaction
        ↓
Attach Photo, Note, or Signature
        ↓
Save, Send, or Convert
        ↓
Synchronize with Company File
```

---

## 2. Download and Sign In

The documented installation process is:

1. Download the QuickBooks Online mobile app for the supported device.
2. Install it from the applicable app store.
3. Open the app.
4. Sign in using the existing QuickBooks Online username and password.

### Recommended sign-in controls

- require an individual user account;
- enable multi-factor authentication where supported;
- do not save credentials in plain text;
- use secure operating-system credential storage;
- show the selected company after sign-in;
- log successful and failed sign-in attempts;
- support remote session revocation;
- block access from unsupported or compromised devices where policy requires it.

---

## 3. Mobile Navigation

The source states that iPhone and iPad navigation is similar but not identical.

### iPad

- Quick actions are available through carousels near the top.
- Additional functions are available from the menu in the upper-left area.
- The plus button is available in the upper-right area.
- The interface is described as being similar to the browser version, with left- and right-side option panels.

### iPhone

- Quick actions are also available in the mobile interface.
- Additional functions are available through the menu near the bottom-right area.
- The plus button is positioned near the bottom of the screen.

### Design principle

Mobile navigation should prioritize high-frequency tasks:

```text
Create Quote
Create Invoice
Record Expense
Capture Receipt
Receive Payment
View Customers
View Reports
```

Less common settings should remain outside the primary action bar.

---

## 4. Mobile Dashboard

A mobile dashboard should present only the information needed for immediate action.

Recommended cards include:

- overdue invoices;
- unpaid invoice total;
- recent customer payments;
- unreviewed receipt captures;
- expenses awaiting completion;
- draft quotes;
- quotes awaiting customer acceptance;
- cash balance summary;
- recent sales;
- synchronization warnings.

### Mobile dashboard rules

- avoid displaying too many cards;
- prioritize urgent items;
- use clear monetary formatting;
- support pull-to-refresh;
- display last synchronization time;
- show actionable error messages;
- respect user permissions.

---

## 5. Create a Quote on iPhone or iPad

The documented workflow is:

```text
Tap Plus
    ↓
Select Quotes
    ↓
Choose Customer
    ↓
Enter Quote Details
    ↓
Save or Send by Email
```

### Typical quote fields

| Field | Description |
|---|---|
| Customer | Customer receiving the quote |
| Quote date | Date created |
| Expiry date | Optional validity end date |
| Product/service | Item being quoted |
| Description | Work or product description |
| Quantity | Number of units |
| Rate | Unit price |
| Tax | Tax treatment |
| Discount | Authorized discount |
| Notes | Customer-facing or internal note |
| Attachment | Photo, document, or specification |

### Mobile quote validation

- customer is active;
- required fields are complete;
- quantity and rate are valid;
- tax treatment is valid;
- discount is within permission;
- currency matches customer configuration;
- quote number is unique;
- total calculation is correct.

---

## 6. Send a Quote by Email

The source states that the quote can be sent immediately to the customer by email.

A mobile send workflow should include:

- recipient review;
- email subject;
- email message;
- quote preview;
- attachment review;
- send confirmation;
- delivery status.

Recommended delivery statuses:

```text
Draft
Queued
Sent
Delivered
Viewed
Failed
Bounced
```

A failed email should remain visible in an exception queue.

---

## 7. Customer Signature Capture

The documented iPad/iPhone workflow allows a potential customer to accept a quote by signing directly on the device screen.

Steps described in the source:

1. Save the quote.
2. Select **Get Signature**.
3. Present the device to the customer.
4. The customer signs with a finger or stylus.
5. Select **Done**.
6. Save the updated quote.

The captured signature is stored as an attachment to the customer quote.

### Signature record requirements

Store:

- quote ID and version;
- signer name;
- signer role where applicable;
- signature image;
- signed date and time;
- device identifier or session reference;
- user presenting the device;
- acceptance statement;
- document hash;
- audit event.

> **Legal note**
>
> Whether a captured signature is legally sufficient depends on the agreement, jurisdiction, identity controls, consent language, and applicable electronic-signature law. Obtain legal review for production use.

---

## 8. Signature Security

Recommended controls include:

- display the complete quote before signing;
- display the quote version and total;
- require explicit acceptance text;
- prevent modification after signature without invalidating acceptance;
- retain the signed version;
- hash the signed document;
- encrypt the signature image;
- restrict signature access;
- record any later cancellation or replacement.

### Signed quote status

```text
Draft
    ↓
Sent
    ↓
Accepted and Signed
    ↓
Converted to Invoice
```

Alternative outcomes:

```text
Rejected
Expired
Cancelled
Superseded
```

---

## 9. Convert a Quote to an Invoice

The source notes that the quote can be converted to an invoice during the signature workflow.

Recommended conversion process:

```text
Accepted Quote
        ↓
Validate Quote Version
        ↓
Create Invoice
        ↓
Link Invoice to Source Quote
        ↓
Preserve Signature Attachment
        ↓
Review Invoice
        ↓
Send to Customer
```

### Conversion controls

- prevent duplicate conversion;
- retain the source quote ID;
- retain the source quote version;
- copy approved line items;
- copy tax and currency details;
- record conversion user and time;
- require a variance reason when invoice values differ;
- keep the signature linked to the signed quote.

---

## 10. Send the Invoice

After conversion, the source workflow sends the invoice directly to the customer by email.

Before sending, verify:

- [ ] Customer and email address are correct.
- [ ] Invoice number is unique.
- [ ] Invoice date and due date are correct.
- [ ] Quote reference is retained.
- [ ] Products, quantities, and rates are correct.
- [ ] Tax and total are correct.
- [ ] Payment instructions are present.
- [ ] Required attachments are included.
- [ ] The accepted quote remains linked.

---

## 11. Capture an Expense on Mobile

The documented workflow is:

```text
Tap Plus
    ↓
Select Expense
    ↓
Take Photo of Invoice or Receipt
    ↓
Enter Expense Details
    ↓
Save
```

The photo can be automatically attached to the expense.

### Typical expense fields

| Field | Description |
|---|---|
| Payee/supplier | Expense recipient |
| Transaction date | Purchase or payment date |
| Amount | Expense amount |
| Currency | Transaction currency |
| Account/category | Ledger classification |
| Tax code | Tax treatment |
| Payment account | Bank, card, or cash account |
| Description | Business purpose |
| Class/location | Reporting dimension where used |
| Receipt photo | Supporting evidence |

---

## 12. Receipt Photo Quality

A mobile capture interface should help the user produce a usable document.

Recommended quality checks:

- image is not blurred;
- all edges are visible;
- document is not cropped;
- lighting is sufficient;
- text is readable;
- amount and date are visible;
- multiple pages can be added;
- duplicate image is detected;
- original image is preserved.

### Capture states

```text
Captured
Processing
Needs Review
Matched
Attached
Rejected
```

---

## 13. OCR and Data Extraction

A custom mobile application may extract fields from the receipt image.

Possible extracted fields:

- supplier name;
- invoice or receipt number;
- date;
- subtotal;
- tax;
- total;
- currency;
- payment method.

> **Design recommendation**
>
> OCR extraction is an internal-system enhancement. The source pages describe taking a photo and attaching it to the expense, but do not define a detailed OCR workflow.

### OCR controls

- show extracted values before posting;
- provide confidence scores;
- flag low-confidence fields;
- require human review;
- preserve original image;
- record corrected values;
- prevent automatic posting of high-risk items.

---

## 14. Add Photos and Notes

The source identifies the ability to add photos and notes to:

- quotes;
- invoices;
- sales receipts;
- customers;
- expense transactions.

Recommended attachment metadata:

```text
File name
File type
File size
Document category
Related record
Uploaded by
Uploaded at
Device source
File hash
Security status
```

### Recommended controls

- malware scanning;
- supported file types;
- size limits;
- access controls;
- retention policy;
- duplicate-file detection;
- immutable record linking;
- audit logging.

---

## 15. Overdue Invoice Notifications

The source states that mobile users can receive overdue-invoice notifications.

Recommended notification content:

- customer;
- invoice number;
- amount due;
- due date;
- days overdue;
- currency;
- assigned owner;
- available action.

Possible actions:

```text
Open Invoice
Send Reminder
Call Customer
Record Payment
Add Follow-up Note
Assign Follow-up
```

### Notification controls

- do not expose sensitive values on a locked screen when policy prohibits it;
- respect user permissions;
- support notification preferences;
- prevent duplicate reminders;
- record reminder history.

---

## 16. Track Payments and Record Sales

The source identifies payment tracking and sales recording as mobile capabilities.

A controlled mobile payment workflow should validate:

- customer;
- invoice;
- payment date;
- amount;
- currency;
- payment method;
- deposit account;
- reference number;
- remaining balance.

### Payment controls

- prevent payment above available balance unless approved;
- support partial payments;
- prevent duplicate bank-match creation;
- store receipt or payment evidence;
- preserve the invoice-payment relationship;
- synchronize with the Banking Centre.

---

## 17. Run Reports on Mobile

The source documents running a Profit and Loss report from the mobile navigation menu. It also lists Profit and Loss and Balance Sheet as mobile performance views.

Recommended mobile reports:

- Profit and Loss;
- Balance Sheet;
- Accounts Receivable ageing;
- Accounts Payable ageing;
- sales by customer;
- expenses by category;
- cash position.

### Mobile reporting principles

- use responsive tables or summarized cards;
- provide date filters;
- display currency clearly;
- support drill-down where permission allows;
- avoid exposing payroll or personal data unnecessarily;
- show data refresh time;
- export only when authorized.

---

## 18. Synchronization

A mobile application should synchronize with the central accounting database.

Recommended sync states:

```text
Local Draft
Pending Upload
Synchronizing
Synchronized
Conflict
Failed
```

### Synchronization controls

- use globally unique record IDs;
- preserve server and device timestamps;
- prevent duplicate submissions;
- use idempotency keys;
- display sync failures;
- retry safely;
- record conflict resolution;
- never silently overwrite approved financial data.

---

## 19. Offline Mode

A custom mobile system may support limited offline work.

Suitable offline actions may include:

- capture receipt photos;
- create draft notes;
- create incomplete expense drafts;
- view previously cached non-sensitive data.

Actions that should normally require a secure connection include:

- posting financial transactions;
- approving payments;
- changing bank details;
- submitting tax information;
- exporting sensitive reports;
- managing users.

> **Design recommendation**
>
> Offline behavior is an internal-system extension. The source manual describes mobile access but does not define offline transaction guarantees.

---

## 20. Mobile Device Security

Recommended controls:

1. Require supported operating-system versions.
2. Use secure transport encryption.
3. Encrypt sensitive local storage.
4. Minimize cached accounting data.
5. Require MFA for privileged users.
6. Support biometric reauthentication where appropriate.
7. Apply automatic session timeout.
8. Revoke sessions after user deactivation.
9. Restrict rooted or jailbroken devices where policy requires it.
10. Support remote logout and data removal.
11. Log device and session activity.
12. Mask bank, tax, and personal identifiers.

---

## 21. Mobile Permissions

The application may request access to:

| Permission | Business use |
|---|---|
| Camera | Receipt photos, attachments, signatures |
| Photo library | Select existing documents |
| Notifications | Overdue invoices and workflow alerts |
| Biometrics | Secure reauthentication |
| Files | Upload or download documents |

### Permission principle

Request permissions only when needed and explain their purpose clearly. The app should continue with reduced functionality when a nonessential permission is denied.

---

## 22. Role-Based Mobile Access

Example mobile access model:

| Role | Mobile access |
|---|---|
| Sales user | Customers, quotes, invoices, sales follow-up |
| Expense user | Expense drafts and receipt capture |
| Manager | Approvals, dashboards, selected reports |
| Accountant | Transactions, reports, reconciliation review |
| Administrator | User and configuration management, preferably with stronger authentication |
| Reports-only user | Authorized reports without transaction editing |

The mobile application must use the same central permission model as the web application.

---

## 23. Audit Events

Recommended mobile audit events include:

- sign-in and sign-out;
- failed authentication;
- company switch;
- quote creation;
- signature capture;
- quote conversion;
- invoice send;
- receipt capture;
- expense creation;
- payment entry;
- report access;
- attachment upload;
- permission denial;
- synchronization failure;
- local data deletion.

Each event should record the user, time, company, device/session reference, action, result, and affected record.

---

## 24. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Lost device | Phone contains cached accounting data | Encryption, session timeout, remote revocation |
| Duplicate transaction | User taps Save repeatedly during poor connectivity | Idempotency key and disabled repeat action |
| Wrong company | User posts into another company file | Prominent company indicator and confirmation |
| Unreadable receipt | Photo is blurred or cropped | Capture-quality validation |
| Invalid signature | Quote changed after customer signed | Signed-version lock and document hash |
| Unauthorized discount | Mobile user overrides price | Approval thresholds |
| Email failure | Invoice is not delivered | Delivery-status exception queue |
| Sync conflict | Two users edit the same draft | Version checking and conflict resolution |
| Sensitive notification | Amount appears on lock screen | Configurable notification privacy |
| Excessive permissions | App requests unnecessary device access | Just-in-time permission requests |
| Offline posting error | Old data is posted after reconnect | Server-side validation and review |
| Missing audit history | Mobile change is not traceable | Central immutable audit events |

---

## 25. Recommended Database Design

### `mobile_devices`

```text
id
user_id
device_platform
app_version
os_version
device_status
last_seen_at
last_sync_at
created_at
updated_at
```

### `mobile_sessions`

```text
id
user_id
device_id
company_id
session_status
mfa_verified_at
created_at
expires_at
revoked_at
```

### `mobile_sync_jobs`

```text
id
device_id
user_id
company_id
direction
status
records_processed
records_failed
started_at
completed_at
error_message
```

### `mobile_drafts`

```text
id
user_id
device_id
draft_type
local_reference
server_record_id
payload_json
sync_status
idempotency_key
created_at
updated_at
```

### `customer_signatures`

```text
id
quote_id
quote_version
signer_name
acceptance_text
signature_file_id
signed_at
captured_by
session_id
document_hash
created_at
```

### Supporting tables

```text
mobile_notifications
mobile_audit_events
mobile_attachment_uploads
mobile_sync_conflicts
receipt_capture_jobs
email_delivery_logs
```

---

## 26. Recommended Constraints

1. Each device session must belong to one authenticated user.
2. A mobile action must identify the selected company.
3. Idempotency keys must be unique for submitted financial actions.
4. A signed quote version must be immutable.
5. A quote cannot be converted twice without an approved exception workflow.
6. Receipt files must pass security validation.
7. Offline drafts cannot bypass server-side validation.
8. User deactivation must revoke active mobile sessions.
9. Sensitive exports must require explicit permission.
10. Synchronization conflicts must not silently overwrite financial records.

---

## 27. Suggested Mobile Workflow

```text
Authenticate User and Device
        ↓
Select Company
        ↓
Load Authorized Mobile Features
        ↓
Create or Review Mobile Record
        ↓
Capture Attachment or Signature
        ↓
Validate Locally
        ↓
Submit with Idempotency Key
        ↓
Validate on Server
        ↓
Save and Audit
        ↓
Return Sync and Delivery Status
```

---

## 28. AI Implementation Prompt

```text
Implement a secure mobile-first accounting interface as a responsive PWA or mobile application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design Mobile or a responsive component system

Requirements:
- Support authenticated access to multiple companies with a prominent company indicator.
- Support role-based access consistent with the web application.
- Provide quick actions for quote, invoice, expense, receipt capture, payment, customer, and reports.
- Support quote creation, email sending, customer signature capture, and quote-to-invoice conversion.
- Preserve the signed quote version and document hash.
- Prevent duplicate quote conversion.
- Support camera-based receipt capture and secure attachments.
- Provide optional OCR with confidence scores and mandatory review before posting.
- Support overdue-invoice notifications with configurable privacy.
- Support payment recording and integration with bank matching.
- Provide responsive Profit and Loss and Balance Sheet reports.
- Implement local drafts, safe retry, idempotency keys, and visible synchronization states.
- Never allow offline drafts to bypass server validation.
- Encrypt sensitive local data and minimize caching.
- Support MFA, session timeout, device registration, and remote session revocation.
- Maintain immutable mobile audit history.
- Include unit and integration tests for permissions, quote calculations, signatures, duplicate prevention, receipt upload, synchronization, retries, and company isolation.
```

---

## 29. Internal System Checklist

- [ ] Mobile platforms and supported versions are documented.
- [ ] Users sign in with individual accounts.
- [ ] MFA and session controls are implemented.
- [ ] The active company is clearly displayed.
- [ ] Mobile permissions match user roles.
- [ ] Quote creation and sending are supported.
- [ ] Signature capture preserves the signed version.
- [ ] Quote-to-invoice conversion is traceable.
- [ ] Receipt capture includes quality review.
- [ ] Expense drafts require server validation.
- [ ] Overdue notifications protect sensitive information.
- [ ] Payment entry prevents duplicates.
- [ ] Mobile reports respect permissions.
- [ ] Synchronization states are visible.
- [ ] Idempotency prevents repeated submissions.
- [ ] Lost-device sessions can be revoked.
- [ ] Attachments are scanned and encrypted.
- [ ] Mobile actions are recorded in the audit log.

---

## Related Topics

- [08. Managing Users](08_Managing_Users.md)
- [12. Banking Centre](12_Banking_Centre.md)
- [13. Quotes and Invoices](13_Quotes_and_Invoices.md)
- [14. Customising Invoices and Attachments](14_Customising_Invoices_and_Attachments.md)
- [15. Expenses and Bills](15_Expenses_and_Bills.md)
- [23. Reports](23_Reports.md)
- Security and Access Management
- Customer Signature Workflow

---

## Keywords

Mobile App, iPhone, iPad, Android, mobile accounting, quote, invoice, customer signature, expense capture, receipt photo, mobile report, push notification, synchronization, offline draft, device security, idempotency