# Sales Tax Center (US) — Design Specification

- **Date:** 2026-07-22
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Market:** United States (Sales Tax, not VAT; USD base; UI in English)
- **Related:** `docs/superpowers/specs/2026-07-15-ctyhp-accounting-webapp-design.md`,
  `QUICKBOOK_USER_MANUAL/04_GST_Setup.md`, `QUICKBOOK_USER_MANUAL/22_GST_and_BAS.md`,
  `holy-grail-coding-guidebook-en.md`

## 1. Goal & Scope

A Sales Tax Center for a single US tax jurisdiction: see how much sales tax has been
collected and is owed, record payments (remittances) that reduce the liability, and
manage tax rates. The implicit tax agency is the **Sales Tax Payable** account (2100).

**Phase 1 covers:**
- **Sales Tax Liability report** — tax collected per rate over a period (accrual basis),
  plus the Sales Tax Payable balance and payments, showing the net owed.
- **Record tax payment** — remit collected tax to the agency
  (`DR Sales Tax Payable / CR Bank`), reducing the liability.
- **Tax rate management** — CRUD over `acc_tax_code` (there is no UI today; rates are
  seed-only).

**Key principle:** invoices already post sales tax to Sales Tax Payable (2100). This
module only *reads* the ledger/invoice lines for the liability and *adds* a remittance
document. No change to invoice posting.

### Out of scope (this phase)
- Multiple tax agencies / multi-state filing (single implicit agency = account 2100).
- Component/combined rates (county + city breakdown).
- Sales-tax adjustments (credits/penalties/discounts on the return).
- Cash-basis liability (accrual only, consistent with the existing reports).

## 2. Reuse principle (Holy Grail Part 14)

No change to how tax is posted on invoices. The liability is derived from existing data
(`acc_invoice_line.line_tax_minor` + the Sales Tax Payable account in
`acc_journal_line`). The remittance reuses the atomic-RPC + service + audit patterns, and
the corrected void semantics (mark the journal entry `void`; reports exclude void — do
NOT post a reversal). Tax-rate CRUD operates on the existing `acc_tax_code` table.

## 3. Data model

### Migration `0015_sales_tax.sql`
- `alter type acc_journal_source add value if not exists 'tax_payment';` (used only in
  0016 — a new enum value cannot be used in the same migration that adds it).
- **`acc_tax_payment`** — `id`, `payment_number` (sequenced, unique), `tax_account_id`
  (→ `acc_account`, the Sales Tax Payable being remitted), `payment_date`,
  `currency_code` (→ `acc_currency`), `amount_minor` (bigint, > 0), `bank_account_id`
  (→ `acc_account`), `period_start` (date, nullable), `period_end` (date, nullable),
  `status` (`posted|void`), `journal_entry_id` (→ `acc_journal_entry`), `memo` (nullable),
  `created_by` (→ auth.users), `created_at`, `updated_at`.
- `acc_sequence`: insert key `tax_payment` (prefix `TAXPMT-`).
- Enum `acc_tax_payment_status` (`posted|void`).
- RLS on `acc_tax_payment`: read `acc_current_role() is not null`; write `acc_is_staff()`.

### Migration `0016_sales_tax_functions.sql`
- `acc_record_tax_payment(p_tax_account_id, p_payment_date, p_currency, p_amount_minor,
  p_bank_account_id, p_period_start, p_period_end, p_memo) returns uuid` — validates
  staff + positive amount, posts a balanced entry (DR tax account / CR bank) via
  `acc_post_entry` (source `tax_payment`), inserts `acc_tax_payment`, returns its id.
- `acc_void_tax_payment(p_payment_id) returns void` — marks the entry `void` (no reversal
  posting, matching the reporting filter) and sets the payment `status='void'`.

## 4. Domain & schemas

### Pure helper (`lib/domain/salestax.ts`, unit-tested)
`summarizeSalesTaxLiability(input)` where `input = { collected: {code,name,ratePercent,
taxableMinor,taxMinor}[], paymentsMinor, openingBalanceMinor }` returns
`{ lines: [...], totalTaxCollectedMinor, paymentsMinor, netOwedMinor }`. Pure arithmetic;
the single definition of how the liability totals are rolled up.

### Zod (`lib/domain/schemas.ts`)
- `taxCodeCreateSchema` / `taxCodeUpdateSchema`: `code` (required, uppercase-ish, unique
  enforced by DB), `name`, `rate_percent` (number ≥ 0), `direction`
  (`sales|purchase|none`), `tax_account_id` (uuid, nullable), `is_active` (bool).
- `taxPaymentCreateSchema`: `tax_account_id` (uuid), `bank_account_id` (uuid),
  `payment_date` (optional), `currency_code`, `amount_minor` (int > 0),
  `period_start`/`period_end` (optional, nullable), `memo` (optional).

## 5. Service layer

- New `lib/services/salestax.ts`:
  - `getSalesTaxLiability(sb, from, to)` — accrual tax collected: group
    `acc_invoice_line.line_tax_minor` and `line_subtotal_minor` by `tax_code_id` for
    invoices with `status <> 'void'` and `issue_date` within `[from,to]`; sum
    remittances (`acc_tax_payment`) in the range; read the Sales Tax Payable running
    balance; combine via `summarizeSalesTaxLiability`.
  - `listTaxPayments(sb)`, `recordTaxPayment(sb, input)` (→ RPC), `voidTaxPayment(sb, id)`.
  - `createTaxCode(sb, input)`, `updateTaxCode(sb, id, input)`, `setTaxCodeActive(sb, id, active)`.
    (`listTaxCodes` already exists in `lib/services/reference.ts`.)
- Every write appends to `acc_audit_log` via `writeAudit`. Amounts recomputed
  server-side; the RPC is the source of truth for the remittance posting.

## 6. UI — `app/(app)/sales-tax` + nav "Sales Tax"

- **Liability** section: a date-range picker (default: current period) → a table of tax
  collected per tax code (code, name, rate %, taxable amount, tax collected), a total, and
  the net owed; a "Record payment" button that opens a modal (tax account, bank account,
  amount, period, memo).
- **Payments** section: a list of `acc_tax_payment` with void.
- **Tax rates** section: a table of `acc_tax_code` with add/edit (code, name, rate %,
  direction, tax account, active).
- Data tables scroll horizontally; UI in English. `canWrite` gates all mutations.

## 7. Security (Holy Grail Part 12)

RLS on `acc_tax_payment`; RPCs `SECURITY DEFINER` gated by `acc_is_staff()`; server
actions guard by role and validate with Zod. Tax-code writes are admin/accountant only.
Generic errors; no PII logged.

## 8. Testing (Holy Grail Part 10)

- Unit: `summarizeSalesTaxLiability` (roll-up math, net owed = opening + collected −
  payments within the model); `taxCodeCreateSchema` validation.
- E2E (live DB, or SQL-Editor equivalent while the Postgres port is unreachable from
  IPv4-only networks): issue an invoice with tax → liability shows the collected tax;
  record a tax payment → Sales Tax Payable decreases and net owed drops; void → restored.
- Verify before "done": `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`
  — zero errors — with real output pasted.

## 9. Reports impact

None to existing reports. The Sales Tax Liability is a new derived view; Trial Balance /
P&L / Balance Sheet continue to reflect Sales Tax Payable from the ledger, now also
reduced by remittances.

## 10. Build sequence

1. Migration `0015_sales_tax.sql` (enum value, `acc_tax_payment`, sequence, RLS).
2. Pure helper + Zod schemas + unit tests (TDD).
3. Row types (`TaxPaymentRow`) + service `salestax.ts`.
4. Migration `0016_sales_tax_functions.sql` (record/void RPCs).
5. UI: sales-tax page (liability + payments + tax rates) + nav.
6. E2E verify + full green build/test/lint/typecheck.
