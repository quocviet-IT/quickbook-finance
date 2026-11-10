# Customer detail page (3.0.12) and open-item statement (3.0.13)

Approved 2026-11-10. This continues the review of the Sales screens: the 3.0.8 review found no customer detail page, and that was the largest gap it found.

## Problem

`/customers` is a list and an edit dialog. A customer's name links nowhere. To see what BlueRidge Foods owes, an accountant has to:

- open Invoices and search by name;
- open Payments to see what has been paid;
- open Reports → Customer statement and pick the customer again, which gives an activity statement rather than a list of what is still owed;
- go to Invoices or Payments to act, then pick the customer from scratch.

All the data exists already: contact and credit fields on `acc_customer`, credit status from `acc_customer_credit_status`, and invoices, payments, credit memos and sales receipts, each with `customer_id`. The audit log covers `acc_customer` too (trigger from 0058). No migration is needed.

## Decisions

1. **Collections first.** The page opens on what is owed: the figures in its header and open invoices as the default tab. Its primary action is **Receive payment**.
2. **Open-item statement.** The statement is the prototype's open-item statement (roadmap item 12). The existing activity statement report stays.
3. **Two releases.** 3.0.12 is the customer page. 3.0.13 is the statement.

## 3.0.12: `/customers/[id]`

### Header

- **Breadcrumb:** Customers / *name*.
- **Title:** the name, with an Active/Inactive tag and the credit-state tag the list already shows (Within limit, Near limit, Over limit, On hold, No limit set).
- **Contact line:** email as a `mailto:` link, phone as a `tel:` link, and city and state. Each missing value is said in words ("No email"), followed by an **Add contact details** link that opens the customer form.
- **Facts strip:** five figures about this customer, not dashboard tiles.
  - **Owed now:** the open balance, with "*n* open invoices" beneath.
  - **Overdue:** the overdue amount, with "oldest *n* days late" beneath.
  - **Available credit:** limit minus owed; "—" with "No limit set" when there is no limit.
  - **Terms:** "Net *n*", with "Company default" beneath when the customer has none.
  - **DSO:** over the credit window, or "—" with its reason.
- **Actions:**
  - **Receive payment** (primary) goes to `/payments?new=1&customer=<id>`.
  - **New invoice** goes to `/invoices?new=1&customer=<id>`.
  - **⋯** holds Edit customer, and Statement from 3.0.13.
  - Receive payment and New invoice are shown only to writers.

### Tabs

1. **Open invoices** (default; its tab label carries the count). Rows come from `listOpenInvoicesForCustomer`, ordered by `sortInvoicesByAttention`.
   - **Columns:** Number · Issued · Due · Total · Paid · Balance due · Status · Actions.
   - **Status** uses `invoiceAttentionLook` ("201 days late", "Due in 5 days"); other rows show the invoice's own status.
   - **Number** opens the invoice dialog, the one built in 3.0.11, extracted from `InvoicesClient` into a shared component.
   - **Actions:** each row has Receive payment, which goes to `/payments?new=1&customer=<id>`.
   - **Summary line above:** "*n* open invoices · $X due · overdue first".
   - **Empty state:** "Nothing owed", with New invoice for writers.
2. **Transactions.** Every invoice (issued or later), payment, credit memo and sales receipt for the customer.
   - **Columns:** Date · Type · Number · Reference · Amount · Status.
   - **Filters:** Type (All, Invoices, Payments, Credit memos, Sales receipts) and a date range, defaulting to the last 12 months.
   - **Loading:** read through a server action for the chosen range, with 25 rows a page on the client. Each read is bounded by `customer_id` and the date range, so the PostgREST 1,000-row cap is not reached in practice. Each table read uses `readAllPages` as a guard.
   - **Empty state:** "No transactions in this period", with a button that widens the range to all dates.
3. **Contact & credit.** Two description blocks.
   - **Contact:** contact person, email, phone, address.
   - **Credit:** limit, terms, hold, last review date and note.
   - **Edit:** writers get an Edit button that opens the customer form. The form is extracted from `CustomersClient` so the list and this page share it, keeping 3.0.8–3.0.10's discard guard, required marks and focus on the first error.
4. **Activity.** The customer's audit trail, read with `searchAudit({ table_name: "acc_customer", record_id })` when the tab opens. It is shown with the change-history table from `DocumentAuditTrail` and gated by `audit.read`, with the same notice as on invoices for roles without it.

### States

- **Customer not found:** `notFound()` page with a link back to Customers.
- **Inactive customer:** the page still shows, with an Inactive tag. New invoice is hidden; Receive payment stays, because an inactive customer can still pay.
- **Credit status unavailable:** the credit figures show "—" with "Credit status could not be read".
- **Loading:** `loading.tsx` shows a skeleton in the page's layout.

### Customer list

- **Rows:** the name is a link to `/customers/[id]`. Each row is one line; the email and city line moves to the customer page.
- **Overdue column:** a new column, right-aligned, read from the credit rows. It shows "—" when nothing is overdue.
- **Default order:** customers with overdue amounts first, largest overdue first, then the rest by name. Headings still sort.
- **Width:** the list still fits 1280px, pinned by a `fitsBox` test.

### Links into the page

- the customer name in the invoice dialog's header;
- the customer name in the Customers list.

The A/R Aging and statement links come with 3.0.13.

### Prefill

- **Invoices:** `/invoices?new=1&customer=<id>` opens New invoice with the customer chosen and that customer's defaults applied (terms → due date, state tax), as picking the customer does.
- **Payments:** `/payments?new=1&customer=<id>` opens Receive payment with the customer chosen, so its open invoices load.
- **Unknown or inactive id:** an unknown customer id opens the empty form. So does an inactive one, but only for New invoice.

### Units

- `lib/domain/customer-detail.ts` (pure) builds the facts strip and the transaction rows:
  - `customerFacts(customer, creditRow, openInvoices, today)` returns the facts strip values.
  - `mergeCustomerTransactions(invoices, payments, creditMemos, salesReceipts)` returns the sorted transaction rows.
- `lib/services/customer-detail.ts` does the reads:
  - `getCustomerDetail(sb, id)` returns the customer, its credit row and its open invoices.
  - `listCustomerTransactions(sb, id, { from, to })` returns the merged rows for the range.
- `app/(app)/customers/[id]/page.tsx` is the server page, following `purchase-orders/[id]`. It sits beside `CustomerDetailClient.tsx` and `actions.ts` (transactions and activity reads).
- `app/(app)/customers/CustomerFormModal.tsx` holds the customer form, extracted from `CustomersClient`.
- `app/(app)/invoices/InvoiceDetailDialog.tsx` holds the invoice dialog, extracted from `InvoicesClient`.

### Testing

- **Unit tests** for `customer-detail.ts`: the facts strip covers no limit, over limit, nothing owed and the company default terms; the merged transactions are ordered and typed.
- **Contract tests** pin the wiring: the list links, the prefill parameters, and the two extracted components used from both places.
- **`fitsBox`** checks for the customer list and the open invoices table.
- **Self-check** on a local build against the Meridian sample company at 1440px, 1280px and 390px, with writes blocked. Tag and label widths are measured in the running app.

## 3.0.13: Open-item statement (outline, planned after 3.0.12 ships)

- **Route:** `/customers/[id]/statement?asOf=YYYY-MM-DD`, an A4 sheet on screen.
- **Header:** the company block, then "Statement", As of and the number of open items.
- **Party block:** "Statement for" with the name, address, email and phone.
- **Table:** Date (with the document number) · Description · Due · Age · Amount · Outstanding.
- **Under the table:** ageing bucket totals (Current, 1–30, 31–60, 61–90, Over 90), **Total due**, and the payment note from company settings.
- **Output:** Print uses a print stylesheet. Download PDF uses the invoice PDF generator.
- **Email:** the button opens the user's mail program with the customer's address, the subject "Statement from {company} as of {date}" and a short summary. The user attaches the PDF; the app has no mail service.
- **Entry points:** Statement buttons on the customer page and on each A/R Aging row.
- **Existing report:** the activity Customer statement report stays and accepts `?customer=`.

## Out of scope

- several contacts per customer;
- customer notes or tasks;
- attachments on a customer;
- sending mail from the server;
- a vendor detail page, which can follow the same pattern later.
