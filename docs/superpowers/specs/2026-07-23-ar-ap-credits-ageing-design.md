# AR/AP Extended — Credit Memos, Vendor Credits, Refunds, Write-offs, Ageing & Statements

- **Date:** 2026-07-23
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Related:** `PRD/PRD_US_Accounting_Web_App.md` (US-FR-033, US-FR-035, US-FR-043, US-FR-045),
  `US_ACCOUNTING_USER_MANUAL/03_Customers_and_Receivables.md`,
  `US_ACCOUNTING_USER_MANUAL/04_Vendors_Payables_and_1099.md`,
  `docs/superpowers/specs/2026-07-15-ctyhp-accounting-webapp-design.md`

## 1. Goal & Scope

Complete the receivables and payables subledgers on top of the existing invoice/payment
and bill/bill-payment modules: let users reduce customer/vendor balances with credit
memos and vendor credits, refund customers, write off uncollectible or trivial balances,
and read AR/AP ageing plus customer/vendor statements that reconcile to the AR and AP
control accounts.

The double-entry ledger and the invoice/payment/bill/bill-payment documents already exist
(`acc_invoice`, `acc_payment`, `acc_payment_allocation`, `acc_bill`, `acc_bill_payment`,
`acc_bill_payment_allocation`, each maintaining a `balance_due_minor`/`unapplied_minor` and
a per-document void RPC). AR is resolved via `acc_active_ar_account()` (seeded account code
`1100`); AP via `acc_vendor.ap_account_id` falling back to `acc_active_ap_account()` (seeded
`2000`). This module adds new document types, allocation tables, posting rules, reports, and
UI — it does not alter existing tables.

### In scope
- **Credit Memo (AR)** + lines; issue posts a reversed-invoice entry; leaves an open credit;
  manual allocation to open invoices.
- **Vendor Credit (AP)** + lines; issue posts a reversed-bill entry; open credit; manual
  allocation to open bills.
- **Customer Refund (AR)** against an unapplied payment or an open credit-memo balance.
- **Write-off**: AR (uncollectible → bad-debt expense) and AP (trivial balance → other
  income), against a specific invoice/bill, with a required reason.
- **AR Ageing** and **AP Ageing** reports (buckets: Current, 1–30, 31–60, 61–90, 90+ by due
  date, as of a chosen date) that reconcile to the AR/AP control accounts.
- **Customer Statement** and **Vendor Statement** (period activity + open items + ageing
  summary).

### Out of scope (own cycles / later)
- Estimates and estimate→invoice conversion (US-FR-031) — separate cycle.
- Vendor refunds (money returned by a vendor) — rare; later.
- Automated collections: reminders, dunning schedules, delivery history (US-FR-035 "configurable
  reminders") — later.
- Statement PDF templating/versioning → Module K (Documents).
- Approval/maker-checker gating (write-off reason is captured now; independent approval → Module C).
- 1099 / vendor tax profile → Module G.

## 2. Alignment with the user manual

From `03_Customers_and_Receivables.md`:
- *"Payments may be unapplied or allocated across eligible invoices for the same customer and
  currency. Allocation cannot exceed the payment or invoice balance."* → credit-memo allocation
  reuses the same validation: same customer, same currency, valid invoice state, amount ≤ both
  the memo's remaining balance and the invoice's balance due.
- *"Credit memos and write-offs use explicit reason and approval rules."* → both carry a reason;
  independent approval deferred to Module C but the field/flow leave room.
- *"Refunds reference the customer credit or payment being refunded."* → `acc_customer_refund`
  references exactly one source (`payment_id` XOR `credit_memo_id`).
- *"Provide customer statements, AR ageing, overdue invoice queues, … and reconciliation of AR
  ageing to the Accounts Receivable control account."* → AR ageing + statements, and a
  reconciliation check that the ageing total equals the AR control-account balance from the
  ledger.

From `04_Vendors_Payables_and_1099.md`:
- *"Vendor credits are separate records and may be applied only to eligible vendor balances."*
  → `acc_vendor_credit` with allocation limited to the same vendor + currency + open bills.
- *"Provide AP ageing, … unapplied vendor credits, … and reconciliation of AP ageing to the
  Accounts Payable control account."* → AP ageing (incl. unapplied vendor credits) reconciled to
  the AP control account.

## 3. Data model

New migration; no changes to existing tables. All money in integer minor units. Every table
gets RLS mirroring existing `acc_*` policies (staff write, staff+viewer read) and is written
only through atomic RPCs.

**`acc_credit_memo`** — `id`, `credit_memo_number` (unique, assigned on issue), `customer_id`,
`memo_date`, `currency_code`, `subtotal_minor`, `tax_total_minor`, `total_minor`,
`balance_remaining_minor`, `status` (`draft`|`issued`|`partial`|`applied`|`void`), `reason`,
`journal_entry_id`, `memo`, audit columns.

**`acc_credit_memo_line`** — `id`, `credit_memo_id` (cascade), `line_order`, `description`,
`quantity`, `unit_price_minor`, `income_account_id`, `tax_code_id`, `line_subtotal_minor`,
`line_tax_minor`, `line_total_minor`. (Mirror of `acc_invoice_line`.)

**`acc_credit_memo_allocation`** — `id`, `credit_memo_id` (cascade), `invoice_id`,
`amount_minor` (>0), `created_at`, unique(`credit_memo_id`,`invoice_id`).

**`acc_vendor_credit`** — `id`, `vendor_credit_number` (unique on issue), `vendor_id`,
`credit_date`, `currency_code`, `total_minor`, `balance_remaining_minor`, `status`
(`draft`|`issued`|`partial`|`applied`|`void`), `vendor_ref`, `reason`, `journal_entry_id`,
`memo`, audit columns.

**`acc_vendor_credit_line`** — `id`, `vendor_credit_id` (cascade), `line_order`, `description`,
`expense_account_id`, `amount_minor`. (Mirror of `acc_bill_line`; US tax-inclusive, no separate
tax line.)

**`acc_vendor_credit_allocation`** — `id`, `vendor_credit_id` (cascade), `bill_id`,
`amount_minor` (>0), unique(`vendor_credit_id`,`bill_id`).

**`acc_customer_refund`** — `id`, `refund_number` (unique), `customer_id`, `refund_date`,
`currency_code`, `amount_minor` (>0), `source_type` (`payment`|`credit_memo`), `payment_id`
(nullable), `credit_memo_id` (nullable), `bank_account_id`, `status` (`posted`|`void`),
`journal_entry_id`, `memo`, audit columns. Constraint: exactly one of `payment_id`/`credit_memo_id`
set, matching `source_type`.

**`acc_write_off`** — `id`, `write_off_number` (unique), `side` (`ar`|`ap`), `invoice_id`
(nullable), `bill_id` (nullable), `write_off_date`, `currency_code`, `amount_minor` (>0),
`offset_account_id` (bad-debt expense for AR, other-income for AP), `reason` (not null),
`status` (`posted`|`void`), `journal_entry_id`, audit columns. Constraint: `side='ar'` ⇒
`invoice_id` set & `bill_id` null; `side='ap'` ⇒ `bill_id` set & `invoice_id` null.

## 4. Posting rules (pure builders in `lib/domain/`, persisted by atomic RPCs)

| Event | Debit | Credit |
|---|---|---|
| Credit memo issued | Income (per line `line_subtotal`); Tax Payable (`tax_total`) | Accounts Receivable = `total` |
| Vendor credit issued | Accounts Payable = `total` | Expense (per line `amount`) |
| Credit-memo → invoice allocation | (allocation only — updates `invoice.balance_due` and `credit_memo.balance_remaining`; **no posting**, both sit in AR already) | |
| Vendor-credit → bill allocation | (allocation only — updates `bill.balance_due` and `vendor_credit.balance_remaining`; **no posting**) | |
| Customer refund | Accounts Receivable = `amount` | Bank/deposit account = `amount` |
| Write-off AR | Bad Debt Expense (`offset_account_id`) = `amount` | Accounts Receivable = `amount` |
| Write-off AP | Accounts Payable = `amount` | Other Income (`offset_account_id`) = `amount` |
| Void (any of the above) | mark the journal entry `void` and restore the affected balances — same pattern as `acc_void_invoice`/`acc_void_bill` (reports exclude void; no separate reversal entry) | |

Allocation is a pure subledger link: a credit memo already credited AR on issue and the invoice
already debited AR, so applying one to the other nets within AR and needs no new journal entry —
it only moves `balance_due_minor`/`balance_remaining_minor` and advances document status
(`issued`→`partial`→`applied`/`paid`). Mirrors `acc_apply_payment`/`acc_pay_bills`.

Void constraints: a credit memo / vendor credit with any non-void allocations, or referenced by a
non-void refund, cannot be voided until those are voided first (prevents orphaned balances) — the
RPC raises a clear error.

## 5. Pure domain (`lib/domain/`, unit-tested)

- `posting.ts`: `buildCreditMemoPosting(input)` (reverse of `buildInvoicePosting`),
  `buildVendorCreditPosting(input)` (reverse of `buildBillPosting`), `buildRefundPosting(input)`
  (DR AR / CR bank), `buildWriteOffPosting(input)` (AR: DR offset / CR AR; AP: DR AP / CR offset).
  All call `assertBalanced`.
- `ageing.ts` (new): `computeAgeing(items, asOfDate, buckets)` where
  `items = { dueDate: string; balanceMinor: number }[]` and buckets are day thresholds; returns
  per-bucket totals + grand total. Pure and unit-tested; unapplied credits/payments carry a
  negative balance and land in "Current".
- `schemas.ts` (Zod): `creditMemoCreateSchema` (≥1 line, mirror invoice), `vendorCreditCreateSchema`,
  `creditAllocationSchema` (amount>0), `customerRefundSchema` (source XOR), `writeOffSchema`
  (side + target + offset account + non-empty reason).

## 6. RPCs (plpgsql, `security definer`, guard `acc_is_staff()`, append `acc_audit_log`)

- `acc_issue_credit_memo(p_credit_memo_id)` — compute totals server-side, post the reversed-invoice
  entry, set `balance_remaining = total`, status `issued`.
- `acc_apply_credit_memo(p_credit_memo_id, p_allocations jsonb)` — validate same customer/currency,
  invoice open, amount ≤ min(memo remaining, invoice balance_due); update both balances + statuses.
- `acc_void_credit_memo(p_credit_memo_id)` — block if allocations/refunds reference it; else void.
- `acc_issue_vendor_credit`, `acc_apply_vendor_credit`, `acc_void_vendor_credit` — AP mirror.
- `acc_record_customer_refund(...)` — validate the source has enough remaining (unapplied payment
  or open credit memo), post DR AR / CR bank, reduce the source's remaining, insert refund row.
- `acc_void_customer_refund(p_refund_id)` — void entry, restore the source's remaining.
- `acc_write_off(p_side, p_target_id, p_offset_account_id, p_amount, p_reason)` — validate offset
  account type (AR ⇒ expense; AP ⇒ income), amount ≤ target balance_due; post and reduce the
  target balance / advance status; `acc_void_write_off` restores it.
- Read RPCs for reports (SQL aggregation): `acc_ar_ageing(p_as_of)`, `acc_ap_ageing(p_as_of)`,
  `acc_customer_statement(p_customer_id, p_from, p_to)`, `acc_vendor_statement(p_vendor_id, p_from, p_to)`.

## 7. Service / Actions / UI

- Services: `lib/services/credits.ts` (credit memo, vendor credit, allocation, refund, write-off —
  all via RPC) and `lib/services/ageing.ts` (ageing + statements reads). No SQL in components.
- Server Actions per route guard by role: `accountant`/`admin` write, `viewer` read-only; write-off
  requires a reason.
- UI (Ant Design, matching existing pages):
  - `/credit-memos` — list + create (line grid like invoices) + issue + allocate-to-invoices modal + void.
  - `/vendor-credits` — AP mirror.
  - Customer Refund — action from `/payments` (or a customer credit) choosing the source.
  - Write-off — action on an open invoice (`/invoices`) and open bill (`/bills`): pick offset account + reason.
  - `/reports/ar-ageing`, `/reports/ap-ageing` — as-of date, buckets, drill-down to documents, CSV/PDF,
    and a visible reconciliation line (ageing total vs AR/AP control-account balance).
  - `/reports/customer-statement`, `/reports/vendor-statement` — entity + date range, activity + open
    items + ageing summary, standard report header (basis, base currency, generated-at), export.
  - Nav: add Credit Memos, Vendor Credits, and the four reports.

## 8. Security & audit
- RLS on every new table (staff write, staff+viewer read).
- Every write RPC appends `acc_audit_log` atomically (issue/apply/void/refund/write_off).
- Sensitive-amount handling unchanged; posted documents immutable, corrected by void.

## 9. Testing (per `ctyhp-accounting/CLAUDE.md`)
- **Unit:** each posting builder balances (concrete input/output); `computeAgeing` buckets a concrete
  set across boundaries (due today, 1, 30, 31, 90, 91 days); allocation schema rejects amount>balance
  and cross-currency; refund source XOR; write-off offset-account-type validation.
- **E2E verify script** (`scripts/verify-ar-ap.mjs`, runs over the pooler, self-cleaning with
  void-before-delete): issue invoice → credit memo → apply partial → refund the remainder → AR ageing
  equals the AR control-account balance; issue bill → vendor credit → apply → AP ageing ties to AP
  control; write off an invoice remainder → balance 0, Trial Balance balanced; void a credit memo with
  an allocation is rejected until the allocation is voided.

## 10. Build sequence
1. Migration: tables + RLS (credit memo/line/alloc, vendor credit/line/alloc, refund, write-off) + sequences.
2. Migration: posting/apply/void/refund/write-off RPCs + ageing/statement read RPCs.
3. Domain builders + `computeAgeing` + Zod schemas + unit tests.
4. Services (`credits.ts`, `ageing.ts`) + db/types rows.
5. Server actions + role guards.
6. UI: credit memos → vendor credits → refund → write-off actions → AR/AP ageing → statements → nav.
7. E2E verify script; full build + test + typecheck + lint clean.
