# CTYHP Accounting Webapp — Design Specification

- **Date:** 2026-07-15
- **Status:** Draft for review
- **Owner:** AI Team — CTYHP
- **Related:** `PRD/PRD_Accounting_Operations_Layer.md`, `QUICKBOOK_USER_MANUAL/`, `STORM/06_System_Architecture.md`

## 1. Goal & Scope

Build a full accounting web application (backend + UI), QuickBooks-style, grounded in
the workflows documented in `QUICKBOOK_USER_MANUAL/`. Build a solid foundation first
(double-entry ledger), then implement each module thoroughly — not superficially.

**MVP modules:** Chart of Accounts + Ledger, Invoice → Payment, Banking + Reconciliation,
Reports (Trial Balance, Profit & Loss, Balance Sheet).

### Decisions locked in

| Decision | Choice |
|---|---|
| Product | Full accounting webapp (backend + UI), QuickBooks-style |
| Stack | Next.js (App Router) + TypeScript + Supabase (Postgres/Auth/RLS) + Vercel |
| UI library | Ant Design (data-dense tables, forms, filters) |
| Tenancy | Single-tenant (CTYHP only); role-based access retained |
| Currency & tax | Multi-currency + configurable tax codes from day one |
| Ledger model | **Approach A — full double-entry.** Every document posts a balanced journal entry; all balances and reports derive from the ledger. |
| Supabase project | `ctyhp-accounting` (`-dev` / `-prod` when split) |
| Table prefix | `acc_` |
| Naming | `snake_case`, English (PRD NFR-06) |

### Out of scope (this phase)

- Vietnam e-invoice issuance / Decree 254 integration (blocked by Gate 0 — legal).
- Historical data migration.
- Payroll, purchase orders, inventory/FIFO costing, recurring transactions, class/location
  dimensions (later phases — foundation must not preclude them).

## 2. Architecture

Layered, single-tenant:

```
Next.js App Router (Server Components + Client Components, Ant Design)
        │
        ▼
Server Actions / Route Handlers  ── Zod validation ──► acc_audit_log
        │
        ▼
Service layer (pure TS business logic) — the ONLY writer of financial data
        │  every financial write goes through here; no SQL scattered in components
        ▼
Supabase Postgres — acc_* schema, RLS, plpgsql functions for atomic posting
```

**Foundation principles:**

1. **All financial writes go through the service layer.** No React component touches ledger
   tables directly.
2. **Posting is atomic in Postgres.** A document and its journal lines commit in one
   transaction via a plpgsql function; an unbalanced entry can never be persisted.
3. **Ledger is the single source of truth for balances.** Account balances and every report
   are computed from `acc_journal_line`, never from denormalized document totals.
4. **Currency and tax are configuration**, not hard-coded.
5. **RLS on every table.** Roles: `admin`, `accountant`, `viewer`.
6. **Immutable audit.** Every financial write appends to `acc_audit_log`.

### Directory structure

```
/app
  /(auth)/login
  /(app)/dashboard
  /(app)/accounts            # Chart of Accounts
  /(app)/invoices
  /(app)/payments
  /(app)/banking
  /(app)/reports
/lib
  /services   # ledger, account, invoice, payment, banking, reconciliation, reports
  /domain     # types, Zod schemas, pure accounting rules (normal balance, posting maps)
  /db         # Supabase server/client, generated types
/supabase/migrations   # SQL schema + posting functions + RLS + seed
/tests
  /unit         # accounting rules (balance, normal-balance, tax calc)
  /integration  # posting, reconciliation, report figures
```

## 3. Core Data Model (ledger backbone)

### 3.1 Foundation / configuration

**`acc_currency`** — `code` (PK, e.g. `VND`,`USD`), `name`, `symbol`, `decimal_places`, `is_base` (exactly one true).

**`acc_exchange_rate`** — `id`, `currency_code` → currency, `rate_date`, `rate_to_base` (numeric). Unique (currency_code, rate_date).

**`acc_tax_code`** — `id`, `code`, `name`, `rate_percent` (numeric), `direction` (`sales`|`purchase`|`none`), `tax_account_id` → account, `is_active`. Configurable VAT/GST rates.

**`acc_account`** (Chart of Accounts) — `id`, `account_code` (unique), `name`, `account_type` (enum below), `detail_type`, `parent_account_id` (self-FK, no cycles), `description`, `default_tax_code_id`, `currency_code`, `is_posting_account` (bool — distinguishes posting vs summary accounts), `status` (`draft`|`active`|`inactive`|`archived`), `effective_from`, `effective_to`, `created_by`, `approved_by`, timestamps.

`account_type` enum (drives Balance Sheet vs P&L, per manual §5): `bank`, `accounts_receivable`, `current_asset`, `fixed_asset`, `accounts_payable`, `credit_card`, `current_liability`, `equity`, `income`, `cost_of_goods_sold`, `expense`, `other_income`, `other_expense`.

`normal_balance` (debit/credit) is derived from `account_type` in a pure domain function — not stored.

### 3.2 Ledger

**`acc_journal_entry`** — `id`, `entry_number` (unique, sequenced), `entry_date`, `description`, `source_type` (`invoice`|`payment`|`manual`|`bank`|`reconciliation`|`opening_balance`), `source_id`, `currency_code`, `status` (`posted`|`void`), `created_by`, `posted_at`, `voided_at`.

**`acc_journal_line`** — `id`, `journal_entry_id`, `account_id`, `debit` (numeric ≥0), `credit` (numeric ≥0), `currency_code`, `amount_base` (converted to base currency), `tax_code_id` (nullable), `memo`, `line_order`.

Invariants (enforced in the posting function, not just app code):
- Each line: exactly one of `debit`/`credit` > 0.
- Per entry: `sum(debit) = sum(credit)` and `sum(amount_base debit) = sum(amount_base credit)`.
- Lines only reference `is_posting_account = true` accounts.
- Posted entries are immutable; corrections are made by voiding + reposting (reversal).

### 3.3 Documents

**`acc_customer`** — `id`, `name`, `email`, `currency_code`, `ar_account_id`, timestamps.
**`acc_vendor`** — mirror of customer for future AP (created now, minimal).

**`acc_invoice`** — `id`, `invoice_number` (sequenced), `customer_id`, `issue_date`, `due_date`, `currency_code`, `subtotal`, `tax_total`, `total`, `balance_due`, `status` (`draft`|`issued`|`partial`|`paid`|`void`), `order_id` (nullable — production link, PRD FR-01), `journal_entry_id` (nullable until issued), `created_by`, timestamps.

**`acc_invoice_line`** — `id`, `invoice_id`, `line_order`, `description`, `quantity`, `unit_price`, `income_account_id`, `tax_code_id`, `line_subtotal`, `line_tax`, `line_total`.

**`acc_payment`** — `id`, `payment_number`, `customer_id`, `payment_date`, `currency_code`, `amount`, `unapplied_amount`, `method`, `deposit_account_id` (bank account), `status` (`unapplied`|`partial`|`applied`|`void`), `journal_entry_id`, timestamps.

**`acc_payment_allocation`** — `id`, `payment_id`, `invoice_id`, `amount`. (Payments ↔ invoices n-n.)

### 3.4 Banking

**`acc_bank_account`** — `id`, `account_id` (→ `acc_account` of type `bank`), `bank_name`, `account_number_masked`, `currency_code`.

**`acc_bank_import_batch`** — `id`, `bank_account_id`, `filename`, `row_count`, `imported_by`, `imported_at`.

**`acc_bank_transaction`** — `id`, `bank_account_id`, `import_batch_id`, `txn_date`, `description`, `reference`, `amount` (signed: +credit/−debit), `running_balance` (nullable), `raw_line` (original text — immutable), `raw_hash` (dedupe key, unique per bank_account), `status` (`unmatched`|`matched`|`ignored`). **Raw bank data is immutable** (PRD FR-03).

**`acc_reconciliation`** — `id`, `bank_transaction_id`, `payment_id` (nullable), `journal_entry_id` (nullable), `rule_applied`, `confidence` (numeric), `status` (`suggested`|`approved`|`rejected`), `approved_by`, timestamps.

### 3.5 Cross-cutting

**`acc_audit_log`** — `id`, `table_name`, `record_id`, `action` (`insert`|`update`|`delete`|`post`|`void`), `actor_id`, `before_json`, `after_json`, `created_at`.

**`acc_sequence`** — `key` (PK, e.g. `invoice`,`payment`,`journal_entry`), `prefix`, `next_value`. Atomic increment via `SELECT ... FOR UPDATE` inside the posting function.

## 4. Posting Rules (document → ledger)

Implemented as pure domain functions that produce balanced journal lines, then persisted
by the atomic plpgsql posting function.

| Event | Debit | Credit |
|---|---|---|
| Invoice issued | Accounts Receivable = `total` | Income (per line `line_subtotal`); Tax Payable = `tax_total` |
| Payment received | Deposit bank account = `amount` | Accounts Receivable = `amount` |
| Payment applied to invoice | (allocation only — updates `balance_due`, no new posting) | |
| Invoice void | reverse the original entry | |
| Opening balances | per COA setup | balanced against Opening Balance Equity |

Multi-currency: document currency lines carry `amount_base` converted at
`acc_exchange_rate` for the document date; ledger balances report in base currency, with
document currency preserved.

## 5. Modules (each built thoroughly)

### 5.1 Chart of Accounts (manual ch. 06)
CRUD; account type + detail type; subaccount hierarchy with **no-cycle** validation;
posting vs summary distinction; default tax code; status lifecycle (deactivate, never
delete accounts with postings); duplicate code/name checks; filter/sort/search/pagination;
batch actions with confirmation; audit history. Seed a default CTYHP COA.

### 5.2 Invoice → Payment (manual ch. 13)
Invoice draft → issued (posts entry) → partial → paid → void. Line items with tax codes;
subtotal/tax/total computed and verified server-side. Payment receipt, allocation to one or
more invoices, `balance_due` maintained. Optional `order_id` link (PRD FR-01).

### 5.3 Banking + Reconciliation (manual ch. 12, 21; PRD FR-03/04)
CSV statement import into immutable `acc_bank_transaction` (dedupe by `raw_hash`).
Reconciliation engine v0: rule-based match (amount + reference + date window) → suggestions
with confidence; ≥80% auto-match target (PRD FR-04); unmatched → manual review queue;
approve/reject; approval confirms/creates the payment↔invoice link.

### 5.4 Reports (manual ch. 23)
All derived from the ledger:
- **Trial Balance** — per-account debit/credit totals; must balance.
- **Profit & Loss** — Income − COGS − Expenses + Other Income − Other Expenses, over a period.
- **Balance Sheet** — Assets = Liabilities + Equity, at a date.
Date range, accrual basis (cash basis later), drill-down to entries, CSV/PDF export.
Advanced report groups/scheduling from the manual are later-phase.

## 6. Security & Audit

- Supabase Auth (email/password) → app users with a `role`.
- RLS on all `acc_*` tables; write policies gated by role (`viewer` read-only,
  `accountant` operational writes, `admin` config + COA approval).
- API secrets in Vercel env / Supabase Vault, never committed (PRD NFR-02).
- Every financial write appends to `acc_audit_log`.

## 7. Testing Strategy

- **Unit:** normal-balance derivation, tax calculation, posting-map balance (debit=credit),
  COA hierarchy cycle detection, reconciliation rule matching.
- **Integration:** issue invoice → assert journal entry balanced & AR increased;
  payment → AR cleared; import statement → reconcile → report figures correct;
  void → reversal balances.
- **End-to-end verify:** invoice → payment → reconcile → Trial Balance balances and
  P&L/Balance Sheet tie out on a seeded dataset.

## 8. Build Sequence

1. Scaffold (Next.js + TS + Supabase + Ant Design + lint/test).
2. Foundation SQL: currency, tax_code, account, journal_entry/line, audit_log, sequence,
   RLS, atomic posting function + seed COA.
3. Auth + roles + app layout/navigation.
4. Module 1 — Chart of Accounts.
5. Module 2 — Invoice → Payment.
6. Module 3 — Banking + Reconciliation.
7. Module 4 — Reports.
8. End-to-end verification.

Each module: schema (if any) → service + domain rules + tests → API/actions → UI → verify.
