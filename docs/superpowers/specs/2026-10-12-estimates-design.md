# Estimates: a price promised to a customer, turned into an invoice (release 2.01)

## Why

The client's mockup keeps estimates: a price promised to a customer before any sale is made. They sit outside the books, and the mockup turns one into an invoice when the customer accepts. The area-by-area comparison of 2 October lists Estimates as missing in OneBook (mockup p36). This is the first area the user chose after release 2.00.

### What the mockup does (p36, p7:365-396, p19:117-122, p21:476)

- **Where.** A collapsed card, "Estimates and purchase orders", sits on the Transactions screen. The two kinds share one list.
- **Data.**
  - Reference `EST-1000+n`, editable and not unique.
  - Date, and "Valid until" (date + 30 days).
  - The customer as free text, and a note printed at the foot.
  - Lines of account, description and amount. There is no tax, quantity or price.
- **States** are worked out when shown: open, expired, declined, converted. There is no draft or sent state, and nothing in the screen sets declined.
- **"Turn into an invoice"** opens an invoice draft with the lines carried over. The estimate is marked only once that invoice is posted. A conversion is one-shot and whole: no partial conversion, no deposit.
- **Nothing posts.** "A quote is a promise to a price … neither is an accounting event, so neither is in the ledger."
- **Print.** It uses the invoice layout with Number, Date, Valid until, Customer, Description, Amount and Total. It always ends with "This is a quotation, not an invoice. Nothing is owed on it."
- **Mockup slips we do not copy:**
  - delete has no confirmation;
  - a reference can repeat;
  - an abandoned conversion followed by any other post can mark the wrong estimate.

### What OneBook has

- **Nothing for estimates.** There is no table, screen or sequence.
- **Purchase orders** are already their own module under Purchases. They are a non-posting document that becomes a bill, and they are the pattern to follow.
- **Invoices are stricter than the mockup.**
  - The customer is chosen from the customer list.
  - Each line carries an item, description, quantity, unit price, income account and tax code.
  - A draft cannot be edited after it is created; it is only issued or voided.
  - The PDF is drawn in the browser from a pure document model (`lib/domain/invoice-document.ts`, `lib/client/invoice-pdf.ts`).

## Decisions (user, 12/10)

1. **Lines like an OneBook invoice.**
   - Choose a customer from the list.
   - Each line has item, description, quantity, unit price, income account and tax code. Choosing an item fills in its price and tax, as on an invoice.
   - The estimate shows Subtotal, Sales tax and Total.
   - Turning it into an invoice loses nothing.
2. **States as in the mockup, plus Declined.** An estimate is numbered when first saved and starts Open. It shows Expired once past its date. "Mark declined" and "Reopen" are added. It becomes Converted when an invoice is made from it.
3. **Turning it into an invoice opens the New invoice form, filled in.**
   - The form can be changed before the draft is created.
   - Creating the draft links it to the estimate, which becomes Converted and locked.
   - Cancelling the form changes nothing.
   - If that invoice is voided later, the estimate is Open again.
4. **Its own tables,** as purchase orders have, so an estimate can never reach receivables, ageing or revenue.

## Part 1: data and rules

### Storage (migration 0141, additive only)

- **`acc_estimate`:**
  - `id`;
  - `estimate_number`: unique `EST-000001`, from its own sequence, assigned when first saved, never edited;
  - `customer_id` (required);
  - `estimate_date`;
  - `expiry_date`: defaults to the estimate date + 30 days, and is never before the estimate date;
  - `currency_code`: USD, as invoices;
  - `memo`: printed at the foot;
  - `subtotal_minor`, `tax_minor`, `total_minor`: worked out by the database, as for invoices;
  - `declined_at`: null unless declined;
  - `created_by`, `created_at`, `updated_at`.
- **`acc_estimate_line`:** the same shape as `acc_invoice_line`.
  - `line_order`, `item_id`, `description`, `quantity`, `unit_price_minor`, `income_account_id`, `tax_code_id`;
  - each line's amount and tax.
- **`acc_invoice.estimate_id`:** a nullable foreign key. A partial unique index allows at most one invoice that is not void per estimate.
- **The usual for a new document:**
  - grants per table;
  - row-level security as invoices have;
  - the `EST-` sequence row and its number source;
  - the number guard trigger.
- **Export and backup:** both new tables join the company export and backup list (`lib/domain/company-export.ts`).

### State (worked out when read; only Declined is stored)

| State | When | What it allows |
|---|---|---|
| Converted | an invoice that is not void is linked to it | view and PDF only: locked against edit, delete and decline |
| Declined | `declined_at` is set | edit, Reopen, PDF, delete if never linked |
| Expired | not declined, not converted, and the company's today is after `expiry_date` | edit, turn into an invoice (after a confirmation), decline, PDF, delete if never linked |
| Open | otherwise | edit, turn into an invoice, decline, PDF, delete if never linked |

"Today" is the company's date, in its time zone.

### Database functions (SECURITY DEFINER, `search_path` pinned, staff only, amounts worked out server-side)

- **`acc_save_estimate`** creates or edits an estimate with its lines, in one call.
  - It refuses a Converted estimate.
  - It numbers a new estimate from the `EST-` sequence.
- **`acc_set_estimate_declined(id, declined)`** marks an estimate declined, or reopens it. It refuses a Converted one.
- **`acc_delete_estimate(id)`** deletes an estimate and its lines.
  - It refuses one that has ever had an invoice linked, voided or not. The answer is to mark it declined instead.
- **`acc_create_invoice_from_estimate(estimate_id, …the invoice draft's fields and lines…)`** works in one transaction:
  1. It locks the estimate.
  2. It refuses when the estimate is declined, or already has an invoice that is not void.
  3. It refuses when the customer differs from the estimate's.
  4. It creates the draft through the same code as `acc_create_draft_invoice`, and sets `estimate_id`.

  Two people converting at once get one draft; the second is refused with the invoice's number, or "a draft invoice".
- **Grants:** executable by `authenticated` and `service_role`, and revoked from `public` and `anon`.

### What does not change

- Nothing posts for an estimate. Only the invoice made from it posts, when issued, as today.
- Voiding the linked invoice uses the existing void; the estimate reads Open again because no live invoice is linked.

### Permissions

Creating, editing, declining, reopening, deleting and turning into an invoice need write access (`canWrite`, and `acc_is_staff()` in the database). Read-only roles see the list and download the PDF.

## Part 2: screens

### Where

- **Sales › Estimates** (`/estimates`), after Invoices in the Sales group.
- **New transaction › Estimate** (`/estimates?new=1`), opening the form after hydration (`useInitiallyOpen`).
- **Dashboard recent activity:** `acc_estimate` reads "Estimate" and links to `/estimates`.

### The Estimates list

- **Page.** The title is "Estimates". The intro reads: "An estimate is a price promised to a customer. It is not in the books: nothing posts until the invoice made from it is issued."
- **Filters:** state pills (All, Open, Expired, Declined, Converted) with counts, and a search over number and customer.
- **Columns:** Number, Date, Customer, Valid until, Total, State, Invoice (the linked invoice's number, or "Draft"), and actions.
  - The list goes through `DataTable`.
  - Its columns fit the 1280 box, with no horizontal scroll.
- **Row actions,** following each state's rules:
  - Edit
  - Turn into an invoice
  - Mark declined / Reopen
  - Download PDF
  - Delete

  Actions that change something show only to people who can write.
- **Empty state:** "No estimates yet". A writer also gets the New estimate button.

### The estimate form (a modal, as for invoices)

- **Fields:** Customer (searchable, with New customer), Estimate date, Valid until (defaults to + 30 days), and the lines. Each line takes an item, description, quantity, unit price, income account and tax code. The item fills in its defaults (`itemToInvoiceLineDefaults`).
- **Note:** a field labelled "Note printed at the foot".
- **Totals:** Subtotal, Sales tax and Total are shown live. The server's figures are the ones saved.
- **Buttons:**
  - **Save:** the number is assigned on the first save.
  - **Turn into an invoice:** on a saved, open estimate.

### Turning an estimate into an invoice

1. **From the list or the form,** "Turn into an invoice" goes to `/invoices?new=1&estimate=<id>`.
   - If the estimate expired, a confirmation comes first: "EST-000001 expired on {date}. Turn it into an invoice anyway?"
2. **The Invoices page reads the estimate on the server.** It opens the New invoice modal filled with the customer and the lines. The issue and due dates are set the way the New invoice form already sets them.
   - A note above the form says "From estimate EST-000001".
3. **Create draft** calls `acc_create_invoice_from_estimate`.
   - On success the toast reads "Draft invoice created from EST-000001. Check it over, then issue it."
   - On refusal, the database's words show in the form.
4. **The invoice's detail** shows "From estimate EST-000001", linking to `/estimates`.

### Messages

- **Delete:** the confirmation reads "Delete EST-000001? It is not in the books, so nothing else changes." The refusal reads "EST-000001 has had an invoice made from it. Mark it declined instead."
- **Already converted:** "EST-000001 has already been turned into an invoice ({number or "a draft invoice"})."
- **Decline and reopen** need no confirmation; the toasts read "EST-000001 marked declined." and "EST-000001 reopened."

### PDF

`lib/domain/estimate-document.ts` is a pure model sharing the seller and bill-to blocks with the invoice document. The browser renderer is shared with invoices.

- **Header:** the title "Estimate EST-000001", and the meta lines Estimate date and Valid until.
- **Lines:** description, quantity, unit price, amount.
- **Totals:** Subtotal, Sales tax, Total. There is no Paid or Balance due.
- **Foot:** the note, then always "This is a quotation, not an invoice. Nothing is owed on it."
- **File name:** `Estimate EST-000001 <customer>.pdf`.

## Part 3: verification and release

### Tests and checks

- **Unit tests,** with invented data:
  - the state worked out at each boundary: expiry day, declined, converted, a voided invoice;
  - the default expiry;
  - totals, matching invoice rounding;
  - the action rules per state;
  - the document model (title, meta, totals, the closing line);
  - the screen's widths;
  - the prefill from an estimate to the invoice form.
- **Migration test:**
  - grants;
  - SECURITY DEFINER with `search_path`;
  - the partial unique index;
  - the sequence row;
  - every refusal in the functions.
- **Verification script,** always rolled back, on the sample company only. It saves, edits, declines and reopens, converts, refuses a second conversion, voids the invoice and sees the estimate Open again, and checks the delete rules.

  It also checks the structure on all six companies.
- **Gates:** typecheck, lint, the full test suite, build and the bundle budget.
- **Smoke on PC-Test,** with screenshots in light, dark and phone:
  - create an estimate;
  - download its PDF;
  - decline and reopen;
  - turn it into an invoice, changing a quantity first;
  - see the estimate Converted;
  - void the draft invoice and see the estimate Open.

  Sample estimates stay on PC-Test as sample data.

### Release

- **2.01:** the changelog says what the user sees.
- **Guide:** steps for the estimates flow in the sales work.
- **Migration 0141:** goes live only with the user's approval.

## Not in this release

- Purchase orders stay as they are. They are already their own module.
- No sending by email: OneBook sends no documents yet.
- No customer link to accept a quote online.
- No partial conversion, no deposit, no progress invoicing (the mockup has none).
- No estimates report.
- No global search entry for estimates.
