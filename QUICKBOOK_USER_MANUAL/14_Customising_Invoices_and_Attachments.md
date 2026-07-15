# 14. Customising Invoices and Attachments

> Source scope: *QuickBooks Online Business User Manual*, Version 4 - July 2022, pages 68-71.

## Purpose

This chapter explains how QuickBooks Online customises invoice templates and manages transaction attachments.

It also translates the documented workflow into implementation requirements for an internal accounting system with controlled templates, document storage, attachment linking, and audit history.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. Current templates, storage limits, menu names, and supported file types may differ.
>
> The source page 71 uses the heading "Manually add an Account", but the page content is about adding and managing attachments.

---

## 1. Invoice Template Customisation

Invoice customisation controls how an invoice is presented to customers without changing the underlying accounting transaction.

Typical presentation elements include:

- company logo;
- accent colour;
- font;
- column layout;
- header content;
- footer content;
- payment instructions;
- customer-facing labels;
- legal or commercial notes.

### Key principle

The invoice template changes the document appearance, not the posted accounting values.

---

## 2. Open Custom Form Styles

Navigate to:

```text
Gear Icon > Your Company > Custom Form Styles
```

Then:

1. select **New Style**;
2. select **Invoice**;
3. configure the template;
4. preview the result;
5. save the style.

The same customisation window can also be opened from the bottom of an invoice by selecting **Customise**.

---

## 3. Select a Template

The manual states that the documented version provides six base templates.

A base template controls the overall structure of the invoice, such as:

- placement of the logo;
- customer-address location;
- invoice-number location;
- line-item arrangement;
- totals section;
- footer layout.

### Recommended control

Each template should have a unique name and status.

Example:

```text
Standard Invoice
Wholesale Invoice
Retail Invoice
Service Invoice
US Customer Invoice
Gold Sales Invoice
```

---

## 4. Configure Branding

### Logo

The manual allows more than one logo to be uploaded.

A controlled system should store:

- logo name;
- legal entity;
- brand or business unit;
- file type;
- file size;
- uploaded by;
- approved by;
- effective date;
- active status.

### Accent colour

The accent colour should match approved company branding and maintain sufficient contrast for readability.

### Font

Use a readable font that renders consistently in:

- browser preview;
- generated PDF;
- printed documents;
- email attachments;
- mobile devices.

---

## 5. Configure Invoice Columns

Invoice columns may include:

| Column | Purpose |
|---|---|
| Product or Service | Item being billed |
| Description | Customer-facing details |
| Quantity | Number of units |
| Rate | Unit price |
| Amount | Line total |
| Tax | Tax treatment or amount |
| Discount | Line discount where supported |
| SKU | Product reference |

### Recommended rule

The template may hide a column visually, but required accounting values must remain stored in the transaction data.

---

## 6. Configure Header and Footer

### Header information

A header may include:

- legal company name;
- trading name;
- logo;
- registered address;
- phone and email;
- tax registration number;
- invoice number;
- invoice date;
- due date.

### Footer information

A footer may include:

- bank-payment instructions;
- payment terms;
- late-payment terms;
- return or refund policy;
- legal notice;
- customer-service contact;
- website.

### Control requirement

Legal and payment information should be versioned and approved before publication.

---

## 7. Template Preview and Testing

Before activating a template, test it using representative transactions.

Recommended test cases:

- short invoice;
- multi-page invoice;
- long product descriptions;
- discount lines;
- tax-inclusive pricing;
- tax-exclusive pricing;
- zero-tax transaction;
- foreign currency;
- subtotal groups;
- attached supporting documents;
- long customer names and addresses.

### Acceptance checklist

- [ ] Logo is clear and not distorted.
- [ ] Text is not clipped.
- [ ] Columns align correctly.
- [ ] Totals are visible.
- [ ] Page breaks are acceptable.
- [ ] Payment instructions are correct.
- [ ] Tax information is correct.
- [ ] PDF output renders correctly.
- [ ] Printed output is readable.
- [ ] Mobile preview is usable.

---

## 8. Template Lifecycle

Recommended status model:

```text
Draft
    ↓
Pending Review
    ↓
Approved
    ↓
Active
    ↓
Superseded
    ↓
Archived
```

### Suggested rules

1. Draft templates cannot be used for customer documents.
2. Active templates require approval.
3. Only one default template should exist per document type and legal entity.
4. Existing invoices retain the template version used when issued.
5. Superseded templates remain available for historical rendering.

---

## 9. Adding Attachments to Transactions

The manual states that attachments can be added to transactions by:

- browsing for a local file;
- dragging and dropping a file into the attachment area;
- adding a file from the bottom of a bank-feed transaction.

The documented maximum total attachment size per transaction is 20 MB.

### Transaction types that may use attachments

- invoice;
- quote;
- expense;
- bill;
- payment;
- bank transaction;
- purchase order;
- journal entry;
- inventory adjustment.

---

## 10. Open the Attachments Page

Navigate to:

```text
Gear Icon > Lists > Attachments
```

The Attachments page supports bulk upload and later linking to transactions.

Typical use cases:

- terms and conditions;
- supplier invoices;
- customer purchase orders;
- receipts;
- contracts;
- product certificates;
- bank confirmations;
- delivery documents.

---

## 11. Upload Attachments in Batch

Documented workflow:

1. open the Attachments page;
2. locate the file to upload;
3. upload and save the file;
4. review it under the **Name** column;
5. link it to a transaction or create a transaction from it.

### Recommended batch-upload controls

- validate file type;
- validate size;
- scan for malware;
- calculate file hash;
- detect duplicates;
- preserve original filename;
- classify document type;
- assign retention policy;
- record uploader and timestamp.

---

## 12. Attachment Page Actions

The documented Attachments window includes the following actions.

### Export

Select one or more files and choose **Export** from the Batch Actions menu.

### Create Invoice

Select an attachment and create an invoice linked to the file.

### Create Expense

Select an attachment and create an expense linked to the file.

### Print attachment list

Use the printer icon to print the attachment list.

### Customise columns

Use the settings icon to control which columns are visible.

### Row actions

The Action menu may include:

- Edit;
- Delete;
- Create Invoice;
- Create Expense.

---

## 13. Document-to-Transaction Workflow

A recommended workflow is:

```text
Upload Document
        ↓
Virus and File Validation
        ↓
Extract Metadata
        ↓
Classify Document
        ↓
Detect Duplicate
        ↓
Link to Existing Transaction
        or
Create New Invoice / Expense
        ↓
Review and Approve
        ↓
Post Transaction
        ↓
Retain Document and Audit History
```

---

## 14. Attachment Metadata

Each attachment should store:

| Field | Description |
|---|---|
| Original filename | Name provided by the uploader |
| Storage key | Internal object-storage path |
| MIME type | File type |
| File size | Size in bytes |
| File hash | Duplicate and integrity check |
| Document type | Receipt, invoice, contract, etc. |
| Transaction ID | Linked accounting transaction |
| Uploaded by | User who uploaded the file |
| Uploaded at | Upload timestamp |
| Retention date | Earliest permitted deletion date |
| Status | Uploaded, linked, archived, quarantined |

---

## 15. Attachment Security

Recommended security controls:

1. Store documents in private object storage.
2. Use short-lived signed URLs.
3. Apply role-based access.
4. Scan every upload for malware.
5. Restrict executable file types.
6. Encrypt data in transit and at rest.
7. Record every download, export, edit, and deletion.
8. Block permanent deletion where retention rules apply.
9. Mask sensitive information where required.
10. Back up documents independently from transaction records.

---

## 16. Duplicate Detection

Use a cryptographic file hash to identify exact duplicate uploads.

Possible outcomes:

```text
Exact duplicate found
    → Link existing document

Similar filename only
    → Show warning and allow review

Different file content
    → Store as a new document
```

The system should not rely only on filename because different files can share the same name.

---

## 17. Attachment Versioning

When a corrected document is uploaded, preserve the original.

Example:

```text
Supplier_Invoice_1001_V1.pdf
Supplier_Invoice_1001_V2.pdf
```

Versioning should record:

- original document;
- replacement document;
- reason for replacement;
- replaced by;
- replacement date;
- approval.

---

## 18. Retention and Deletion

Documents linked to posted transactions should not be deleted casually.

Recommended statuses:

```text
Active
Superseded
Archived
Legal Hold
Pending Deletion
Deleted
```

### Deletion controls

- require permission;
- require a reason;
- verify retention period;
- verify legal hold;
- retain audit history;
- use soft deletion before permanent deletion.

---

## 19. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Incorrect template | Wrong bank details shown | Template approval and preview |
| Historical document changes | Old invoice renders with new footer | Store template version on issue |
| Oversized upload | Storage or processing failure | File-size validation |
| Malicious file | Malware uploaded as an attachment | Malware scanning |
| Duplicate document | Receipt uploaded multiple times | File-hash detection |
| Unlinked document | Evidence cannot be found | Unlinked-document exception queue |
| Unauthorized access | User downloads confidential contract | Role-based access and download log |
| Silent deletion | Audit evidence disappears | Soft delete, approval, and history |
| Wrong transaction link | Document attached to another supplier | Review and unlink workflow |
| Broken file reference | Transaction points to missing storage object | Integrity monitoring |

---

## 20. Suggested Database Design

### `document_templates`

```text
id
template_name
document_type
legal_entity_id
version
status
is_default
layout_config_json
branding_config_json
header_config_json
footer_config_json
created_by
approved_by
effective_from
effective_to
created_at
updated_at
```

### `documents`

```text
id
original_filename
storage_key
mime_type
file_size_bytes
file_hash
document_type
status
uploaded_by
uploaded_at
retention_until
supersedes_document_id
created_at
updated_at
```

### `document_links`

```text
id
document_id
entity_type
entity_id
link_type
linked_by
linked_at
```

### Supporting tables

```text
document_access_logs
document_versions
document_extractions
document_review_tasks
template_approval_history
template_render_snapshots
```

---

## 21. Recommended Constraints

1. Template name and version must be unique within a legal entity.
2. Only one default active template may exist per document type and legal entity.
3. Issued transactions must store the template version used.
4. File hash should identify exact duplicates.
5. File size and MIME type must be validated before storage.
6. A posted transaction attachment cannot be permanently deleted without approval.
7. A document link must reference an existing document and business record.
8. Superseded files remain historically accessible.
9. Attachment access must be auditable.
10. Quarantined files cannot be linked or downloaded by ordinary users.

---

## 22. AI Implementation Prompt

```text
Implement invoice-template customisation and attachment management for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Supabase Storage
- Ant Design

Requirements:
- Support versioned invoice templates by legal entity and document type.
- Support logo, accent colour, fonts, columns, header, footer, legal text, and payment instructions.
- Separate visual template configuration from accounting transaction data.
- Require review and approval before a template becomes active.
- Store the exact template version used when an invoice is issued.
- Render and test multi-page PDF invoices.
- Support file browsing, drag-and-drop, and batch attachment upload.
- Validate file size and MIME type and scan uploads for malware.
- Calculate file hashes and detect duplicate documents.
- Store files in private object storage with signed URLs.
- Support linking one document to one or more permitted business records.
- Support Create Invoice and Create Expense workflows from uploaded documents.
- Maintain document versions, retention status, access logs, and soft deletion.
- Add search, filters, pagination, bulk actions, export, and unlinked-document queues.
- Include unit and integration tests for template versioning, default-template constraints, file validation, duplicate detection, linking, permissions, and deletion controls.
```

---

## 23. Internal System Checklist

- [ ] Invoice templates are versioned.
- [ ] Branding is approved.
- [ ] Legal and payment text is controlled.
- [ ] Issued invoices retain their template version.
- [ ] Multi-page PDF output is tested.
- [ ] Upload size and file type are validated.
- [ ] Malware scanning is enabled.
- [ ] Duplicate detection uses file hashes.
- [ ] Attachments use private storage.
- [ ] Downloads and exports are logged.
- [ ] Unlinked files enter an exception queue.
- [ ] Posted-transaction evidence cannot be silently deleted.
- [ ] Retention and legal-hold rules are implemented.
- [ ] Document links are included in the audit trail.

---

## Related Topics

- [05. Audit Log](05_Audit_Log.md)
- [12. Banking Centre](12_Banking_Centre.md)
- [13. Quotes and Invoices](13_Quotes_and_Invoices.md)
- Expenses and Bills
- Document Retention
- PDF Generation
- Role-Based Access Control

---

## Keywords

Customising Invoices, invoice template, Custom Form Styles, logo, accent colour, invoice columns, header, footer, attachments, document management, drag and drop, batch upload, Create Invoice, Create Expense, file hash, document retention, template versioning