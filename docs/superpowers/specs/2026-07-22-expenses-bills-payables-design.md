# Expenses & Bills (Accounts Payable) — Design Specification

- **Date:** 2026-07-22
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Market:** United States (Sales Tax, not VAT; USD base; UI in English)
- **Related:** `docs/superpowers/specs/2026-07-15-ctyhp-accounting-webapp-design.md`,
  `QUICKBOOK_USER_MANUAL/15_Expenses_and_Bills.md`, `holy-grail-coding-guidebook-en.md`

## 1. Goal & Scope

Build the buy-side (Accounts Payable) of the accounting app — the mirror of the
existing Invoice→Payment flow. Phase 1 covers the full payables cycle:

- **Bill** — an amount owed to a vendor, paid later (`DR Expense / CR Accounts Payable`).
- **Bill Payment** — settling one or more bills (`DR Accounts Payable / CR Bank/Credit Card`).
- **Expense** — money already spent via bank/credit card, no payable tracked
  (`DR Expense / CR Bank/Credit Card`).

**US tax treatment (locked decision):** Sales tax paid on purchases is part of the
expense cost — there is **no recoverable input tax** and **no separate purchase tax line**.
Every line `amount_minor` is tax-inclusive. This is the correct US model and keeps the
design simple (Holy Grail Part 13).

### Out of scope (this phase)
- Products/Services on bill lines (lines are account-based; item catalog is a later module).
- Purchase Orders.
- A/P Aging report (P&L and Balance Sheet already reflect payables automatically).
- Recurring bills.
- VAT / recoverable input-tax mode.

## 2. Reuse principle (Holy Grail Part 14 — one rule, one implementation)

This module mirrors Invoicing and **reuses, never re-implements**:
- `assertBalanced`, `isBalanced`, `reverse` from `lib/domain/posting.ts`
- `Minor` money helpers from `lib/domain/money.ts`
- Atomic RPC posting pattern (like `acc_issue_invoice` / `acc_record_payment`)
- `writeAudit` from `lib/services/audit.ts`
- Role-based RLS pattern from existing `acc_*` tables

No business rule (posting map, balance invariant, sequence increment) is hand-written
a second time.

## 3. Data model — migration `0011_payables.sql`

Money stored as integer minor units (`_minor`), consistent with existing tables.

### `acc_vendor` (mirror of `acc_customer`)
`id`, `name`, `email`, `phone`, `currency_code` (→ `acc_currency`),
`ap_account_id` (→ `acc_account`, default AP account, nullable → system default),
`default_expense_account_id` (→ `acc_account`, nullable), `payment_terms` (text, nullable),
`is_active` (bool, default true), `created_at`, `updated_at`.

### `acc_bill`
`id`, `bill_number` (internal, sequenced, unique), `vendor_ref` (vendor's own invoice #,
free text, nullable), `vendor_id` (→ `acc_vendor`), `bill_date`, `due_date` (nullable),
`currency_code`, `total_minor`, `balance_due_minor`,
`status` (`draft|open|partial|paid|void`), `journal_entry_id` (nullable until posted),
`memo` (nullable), timestamps.
*No tax fields — tax is included in line amounts (avoids dead fields, Part 14 item 5).*

### `acc_bill_line`
`id`, `bill_id` (→ `acc_bill`, cascade), `line_order`, `description`,
`expense_account_id` (→ `acc_account`, must be `is_posting_account = true`),
`amount_minor` (tax-inclusive).

### `acc_expense` (immediate spend)
`id`, `expense_number` (sequenced, unique), `vendor_id` (→ `acc_vendor`, nullable),
`payment_account_id` (→ `acc_account` of type `bank` or `credit_card`),
`expense_date`, `currency_code`, `total_minor`, `status` (`posted|void`),
`journal_entry_id`, `memo` (nullable), timestamps.

### `acc_expense_line`
`id`, `expense_id` (→ `acc_expense`, cascade), `line_order`, `description`,
`expense_account_id`, `amount_minor`.

### `acc_bill_payment`
`id`, `payment_number` (sequenced, unique), `vendor_id` (→ `acc_vendor`),
`payment_date`, `currency_code`, `amount_minor`, `unapplied_minor`,
`payment_account_id` (→ `acc_account` of type `bank` or `credit_card`),
`method` (text, nullable), `status` (`unapplied|partial|applied|void`),
`journal_entry_id`, `memo` (nullable), timestamps.

### `acc_bill_payment_allocation`
`id`, `bill_payment_id` (→ `acc_bill_payment`, cascade), `bill_id` (→ `acc_bill`),
`amount_minor`. (Bill payments ↔ bills is n-n.)

### `acc_sequence`
Insert keys `bill`, `expense`, `bill_payment` (with prefixes, e.g. `BILL-`, `EXP-`, `BP-`).

## 4. Posting rules (pure builders added to `lib/domain/posting.ts`)

Each builder produces balanced lines by construction and calls `assertBalanced`.
The DB posting function independently enforces balance (deferred trigger, migration 0001).

| Event | Debit | Credit |
|---|---|---|
| Bill posted (draft → open) | Expense, grouped per `expense_account_id` = each line amount | Accounts Payable = `total_minor` |
| Expense recorded | Expense, grouped per `expense_account_id` | `payment_account_id` (bank/credit card) = `total_minor` |
| Bill Payment | Accounts Payable = `amount_minor` | `payment_account_id` = `amount_minor` |
| Payment applied to bill | allocation only — updates `balance_due_minor`, no new posting | |
| Void (any document) | `reverse()` of the original entry | |

Multi-currency: document lines carry `amount_base` converted at `acc_exchange_rate` for
the document date, computed inside the RPC (mirrors invoice/payment behaviour).

New builders: `buildBillPosting`, `buildExpensePosting`, `buildBillPaymentPosting`.

## 5. Service & domain layers

- **New service:** `lib/services/payables.ts` — vendors CRUD, bills (create draft / post /
  void / list / lines), expenses (record / void / list), bill payments (list open bills for
  vendor / record / void). Mirrors `lib/services/invoicing.ts`. All financial writes go
  through atomic RPCs. If a file approaches 400 lines, split by concern (Part 09).
- **Domain:** posting builders in `posting.ts`; Zod input schemas in `lib/domain/schemas.ts`.
- **Atomic RPCs (migration `0012_payables_functions.sql`):** `acc_post_bill`,
  `acc_void_bill`, `acc_record_expense`, `acc_void_expense`, `acc_pay_bills`,
  `acc_void_bill_payment`. Each: increments its sequence via `SELECT ... FOR UPDATE`,
  computes `amount_base`, writes the balanced journal entry + lines, updates document
  status / `balance_due_minor` / `unapplied_minor`, all in one transaction. Amounts are
  recomputed server-side — never trusted from the client (Part 10).

## 6. UI (Next.js App Router + Ant Design, mirroring existing `(app)/*`)

- `app/(app)/vendors` — list + create/edit vendor.
- `app/(app)/bills` — list, create draft (line editor with expense account picker), post, void.
- `app/(app)/expenses` — list, record (payment account + line editor), void.
- `app/(app)/pay-bills` — pick vendor → list open bills → allocate payment → record.
- Add nav entries alongside Invoices/Payments.
- Bonus bar: data tables scroll horizontally on narrow screens; layout responsive.

## 7. Security (Holy Grail Part 12)

- RLS on every new table: `viewer` read-only, `accountant` operational writes,
  `admin` config (vendor setup). No table ships without a policy.
- Backend service-role writes check role/ownership before mutation — never assume RLS
  covers a service-role path.
- Every financial write appends to `acc_audit_log`.
- Generic errors to unauthenticated callers; no PII in logs.

## 8. Testing (Holy Grail Part 10)

Unit tests (real code path, concrete input/output — no mocked rules):
- `buildBillPosting`: DR Expense total == CR Accounts Payable; balanced.
- `buildExpensePosting`: DR Expense == CR payment account; balanced.
- `buildBillPaymentPosting`: DR AP == CR payment account; balanced.
- Bill payment allocation: sum of allocations == payment applied amount.
- `reverse` of each posting: balanced and signs flipped.

Verification before "done": run `npm run build`, `npm test`, `tsc --noEmit`, lint — zero
errors — and paste the actual test output.

## 9. Reports impact

None. Trial Balance, P&L (expenses), and Balance Sheet (Accounts Payable, bank/credit
card) all derive from `acc_journal_line` and reflect the new documents automatically.

## 10. Foundational prerequisite (Holy Grail Part 05)

Before feature work: bring `ctyhp-accounting/CLAUDE.md` up to the guidebook's 5 mandatory
sections (run commands, how to verify, architecture & where logic lives, gotchas, things
NOT to do), so the guidebook self-enforces in future sessions.

## 11. Build sequence

1. Update `CLAUDE.md` to guidebook standard (Part 05).
2. Migration `0011_payables.sql` — tables, sequences, RLS.
3. Posting builders + unit tests (Part 10) — verify balanced.
4. Migration `0012_payables_functions.sql` — atomic RPCs.
5. Service layer `payables.ts` + Zod schemas.
6. UI: vendors → bills → expenses → pay-bills + nav.
7. End-to-end verify: bill → pay → Trial Balance still balances; P&L/Balance Sheet tie out.
