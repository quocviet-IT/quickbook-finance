# Products & Services (Item Catalog) — Design Specification

- **Date:** 2026-07-22
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Market:** United States (USD base, Sales Tax not VAT; UI in English)
- **Related:** `docs/superpowers/specs/2026-07-15-ctyhp-accounting-webapp-design.md`,
  `docs/superpowers/specs/2026-07-22-expenses-bills-payables-design.md`,
  `QUICKBOOK_USER_MANUAL/11_Products_and_Services.md`, `holy-grail-coding-guidebook-en.md`

## 1. Goal & Scope

A reusable catalog of items (products and services) that prefill invoice and bill
lines, so line entry is not free-text and data is consistent across the sell and buy
sides. Each item is **dual-purpose**: it may have a sales side ("I sell this") and/or a
purchase side ("I buy this").

**Key principles:**
- Items only **prefill** line fields; each line still stores its own account/amount
  (a snapshot) plus an `item_id` link. Posting logic and reports are unchanged.
- Historical accuracy: changing an item's price later never alters past invoices/bills,
  because lines keep their own values.
- No inventory tracking (quantities/FIFO) — that stays a later phase.

### Out of scope (this phase)
- Inventory / stock quantity / FIFO costing.
- Item categories, bundles/kits.
- Multi-currency item pricing (prices are base-currency USD amounts).
- Sales-by-item reporting.
- A `Service` vs `Non-inventory` type distinction (not needed for behavior now).

## 2. Reuse principle (Holy Grail Part 14)

No posting/ledger changes. Items are configuration that prefills lines. Reuse the
existing service/UI patterns from Customers/Vendors and the invoice/bill line editors.
The line still computes amounts server-side exactly as today; `item_id` is one extra
nullable column.

## 3. Data model — migration `0014_products_services.sql`

Money as integer minor units (`_minor`), consistent with existing tables.

### `acc_item`
`id`, `item_code` (text, unique when present, nullable), `name` (text, not null),
`description` (text, default '' — default line description),
- Sales side: `is_sold` (bool, default true), `sales_price_minor` (bigint, default 0),
  `income_account_id` (→ `acc_account`, nullable), `sales_tax_code_id` (→ `acc_tax_code`, nullable)
- Purchase side: `is_purchased` (bool, default false), `purchase_cost_minor` (bigint, default 0),
  `expense_account_id` (→ `acc_account`, nullable)
- `is_active` (bool, default true), `created_at`, `updated_at`.

Prices are **base-currency (USD)** amounts. On prefill they populate the line's
`unit_price_minor` (invoice) or `amount_minor` (bill); the user can edit per line.

### Column additions
- `acc_invoice_line`: add `item_id uuid references acc_item (id)` (nullable).
- `acc_bill_line`: add `item_id uuid references acc_item (id)` (nullable).

### RLS
`acc_item`: read for any authenticated role (`acc_current_role() is not null`), write via
`acc_is_staff()`. No sequence (item_code is user-entered or null).

## 4. Domain & schemas

### Zod (`lib/domain/schemas.ts`)
- `itemCreateSchema` / `itemUpdateSchema` with cross-field rules:
  - at least one of `is_sold` / `is_purchased` is true;
  - if `is_sold` then `income_account_id` is required;
  - if `is_purchased` then `expense_account_id` is required.
- Add optional `item_id` (uuid) to `invoiceLineInputSchema` and `billLineInputSchema`.

### Pure helpers (`lib/domain/items.ts`, unit-tested)
- `itemToInvoiceLineDefaults(item)` → `{ description, unit_price_minor, income_account_id, tax_code_id }`
- `itemToBillLineDefaults(item)` → `{ description, expense_account_id, amount_minor }`

These are pure mapping functions used by the client to prefill; they are the single
definition of "what an item fills in".

## 5. Service layer

- New: `lib/services/items.ts` — `listItems`, `createItem`, `updateItem`, `setItemActive`.
  Mirrors the vendor/customer service pattern; every write goes through the service and
  appends to `acc_audit_log` via `writeAudit`.
- Modify `invoicing.createDraftInvoice` and `payables.createDraftBill` to persist the
  optional `item_id` on each line. No change to server-side amount computation.

## 6. UI (Next.js App Router + Ant Design, mirroring existing pages)

- `app/(app)/items` — list + create/edit. Form has two toggleable sections (Sales /
  Purchase); Sales shows price + income account + sales tax; Purchase shows cost +
  expense account. `is_active` toggle. Add a "Products & Services" nav entry.
- `InvoicesClient`: add an item picker on each line that prefills description /
  unit_price / income account / tax code via `itemToInvoiceLineDefaults` (fields stay
  editable); the line submits `item_id`.
- `BillsClient`: add an item picker on each line that prefills description / expense
  account / amount via `itemToBillLineDefaults`; the line submits `item_id`.
- Data tables scroll horizontally on narrow screens; UI in English.

## 7. Security (Holy Grail Part 12)

RLS on `acc_item` (read any role, write staff). Server actions guard by role
(`canWrite`) and validate with Zod before writing. Generic errors; no PII logged.
Adding `item_id` to line tables does not weaken any existing policy.

## 8. Testing (Holy Grail Part 10)

- Unit: `itemCreateSchema` cross-field validation (sold→income required; purchased→
  expense required; at least one side); `itemToInvoiceLineDefaults` /
  `itemToBillLineDefaults` mapping.
- E2E (light, live DB via a verify script): create an item, create a draft invoice
  whose line references it, assert the line stores `item_id` and the snapshot values.
- Verify before "done": `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`
  — zero errors — with real output pasted.

## 9. Reports impact

None. Reports derive from `acc_journal_line`, which is unaffected. `item_id` on lines is
a link for future sales-by-item reporting, not used by current reports.

## 10. Build sequence

1. Migration `0014_products_services.sql` (acc_item + line columns + RLS).
2. Pure helpers + Zod schemas + unit tests (TDD).
3. Types (`acc_item` row type; `item_id` on line row types).
4. Service `items.ts`; wire `item_id` into createDraftInvoice / createDraftBill.
5. UI: items page + nav; item picker in InvoicesClient and BillsClient.
6. E2E verify + full green build/test/lint/typecheck.
