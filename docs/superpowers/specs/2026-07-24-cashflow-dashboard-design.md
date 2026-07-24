# Cash Flow Statement + Dashboard (J)

- **Date:** 2026-07-24
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Related:** `PRD/PRD_US_Accounting_Web_App.md` (US-FR-100, US-FR-103),
  `US_ACCOUNTING_USER_MANUAL/08_Reports_Documents_and_Operations.md`,
  `docs/superpowers/specs/2026-07-15-ctyhp-accounting-webapp-design.md`

## 1. Goal & Scope

Complete the report suite with a Cash Flow Statement and replace the placeholder dashboard
with an actionable-metrics dashboard. Both derive from the existing ledger and the services
already built for AR/AP ageing (Module D/E), bank reconciliation (Module F), and accounting
periods (Module A).

### In scope
- **Cash Flow Statement** (direct, cash-account based) at `/reports/cash-flow`: over a chosen
  date range, the net movement of cash (`account_type='bank'`) accounts split into Operating,
  Investing, and Financing, with the bottom line reconciling to the change in cash balances
  (opening → closing).
- **Dashboard** rebuilt at `/dashboard` with actionable cards: cash position, overdue
  receivables, overdue payables, unreconciled bank items, open-period/close blockers, and net
  income for the current month — each linking to its detail page.

### Out of scope (own cycles / later)
- Indirect cash-flow method — the direct method is chosen (ties out to cash-balance change).
- Cash-basis P&L (US-FR-002) — separate cycle; unrelated to this statement.
- Saved/scheduled reports (US-FR-104) — later.
- Dashboard cards for **pending approvals** (Module C) and **failed imports/integrations**
  (Module K) — those subsystems are not built; omit rather than fake.
- CSV/PDF export parity beyond reusing the existing Reports export affordance.

## 2. Alignment with the user manual (ch. 08)

- *"Required reports include … Cash Flow Statement …"* → the direct Cash Flow Statement.
- *"The dashboard emphasizes actionable exceptions: overdue receivables, bills due,
  unreconciled bank items, pending approvals, failed imports or integrations, close blockers,
  and unusual balance conditions."* → the dashboard implements the ones whose data exists today
  (overdue receivables, overdue/ due payables, unreconciled bank items, close blockers) plus
  cash position and month-to-date net income; pending approvals and failed imports are omitted
  until Modules C and K exist.

## 3. Cash Flow method (direct, ledger-derived, ties out)

Cash = accounts of `account_type = 'bank'`. For a period `[from, to]` over posted entries:

- **Net cash change** = Σ over bank-account journal lines of `(debit_base − credit_base)` in the
  window. By construction this equals `closing cash − opening cash`.
- **Category totals**: consider every posted journal entry in the window that touches at least
  one bank account; sum its **non-bank** lines as `(credit_base − debit_base)`, grouped by
  `cashFlowCategoryOf(account_type)`. Because each such entry is balanced, the sum of the
  non-bank category contributions equals the entry's bank movement — so
  `operating + investing + financing == net cash change` (the tie-out).
- A bank-to-bank transfer has only bank lines (no non-bank lines) → contributes 0 to every
  category and nets to 0 across cash accounts. Correct.

**Category mapping** (pure domain `cashFlowCategoryOf`):
- **Investing** — `fixed_asset` (buying/selling equipment/property).
- **Financing** — `equity` (owner contributions/draws), `credit_card` (repaying short-term
  borrowing from a bank account).
- **Operating** — everything else: `income`, `other_income`, `expense`, `cost_of_goods_sold`,
  `other_expense`, `accounts_receivable`, `accounts_payable`, `current_asset`,
  `current_liability`, and tax/other.

**Documented simplification:** with no long-term-liability account type in the chart today,
loan-type financing that lands in `current_liability` classifies as Operating. This is a known
limitation to revisit if a long-term-liability type is added; it never breaks the tie-out
(totals still reconcile to the cash change).

## 4. Data model / RPC

No new tables. New migration (`0030`) adds a read-only aggregation RPC:

`acc_cash_flow(p_from date, p_to date)` returns rows:
- one row per category (`operating`/`investing`/`financing`) with `amount_minor` (base, signed:
  positive = cash in), computed as Σ non-bank lines `(credit_base − debit_base)` for
  bank-touching posted entries in the window;
- plus `opening_cash_minor` (bank balance strictly before `from`) and `closing_cash_minor`
  (bank balance through `to`) — returned as two extra labeled rows or as a companion function
  `acc_cash_position(p_as_of date)`. **Decision:** a single function
  `acc_cash_flow(p_from, p_to)` returns `(category text, amount_minor bigint)` for the three
  categories, and the service computes opening/closing via the existing `acc_ledger_balances`
  (summing `bank`-type accounts) — keeping cash-position logic in one place.

`language sql stable` (runs as invoker; RLS applies).

## 5. Pure domain (`lib/domain/cashflow.ts`, unit-tested)

- `CashFlowCategory = "operating" | "investing" | "financing"`.
- `cashFlowCategoryOf(accountType: AccountType): CashFlowCategory` — the mapping in §3.
- `assembleCashFlow(categories: { category: CashFlowCategory; amountMinor: number }[], openingMinor: number, closingMinor: number): { operating: number; investing: number; financing: number; netChange: number; tiesOut: boolean }` —
  sums per category, `netChange = closing − opening`, `tiesOut = (operating+investing+financing === netChange)`.
- Zod: `cashFlowRangeSchema` (from/to) — or reuse the existing report date-range pattern.

## 6. Service / Actions / UI

- `lib/services/cashflow.ts`: `getCashFlow(sb, from, to): Promise<CashFlowReport>` — calls
  `acc_cash_flow`, computes opening/closing cash from `acc_ledger_balances` (bank-type net),
  assembles via the domain helper. `CashFlowReport = { operating; investing; financing; netChange; openingMinor; closingMinor; tiesOut }`.
- `lib/services/dashboard.ts`: `getDashboardMetrics(sb): Promise<DashboardMetrics>` — aggregates:
  cash position (Σ bank balances via `acc_ledger_balances` to today), overdue AR (getArAgeing
  today: sum of non-current buckets), overdue AP (getApAgeing), unreconciled bank items (posted
  bank GL lines not linked to a completed reconciliation — a count + amount), open-period count
  (periods with `status='open'` whose `period_end < today`), MTD net income (P&L over the
  current calendar month). Each metric is independent; a failure in one does not blank the page
  (aggregate defensively, but never swallow — surface per-metric errors as nulls with a note).
- Server Actions: read-only; any authenticated role may read (no write).
- UI:
  - `/reports/cash-flow` — date-range picker + Run; a table of Operating/Investing/Financing
    with Net change, and a reconciliation line "Opening + Net = Closing" (green when `tiesOut`);
    standard report header (base currency, accrual basis, generated-at). Nav link under Reports.
  - `/dashboard` — a responsive grid of metric `Card`s (Ant Design `Statistic`), each linking
    to its page (`/reports/ar-ageing`, `/reports/ap-ageing`, `/banking/reconcile`,
    `/settings/periods`, `/reports/cash-flow`). Money via `fromMinor`. Replaces the current
    account/entry count cards.

## 7. Security & audit
- Read-only module: no financial writes, no new audit events. RLS on the queried tables already
  applies (the RPC runs as invoker). No sensitive data surfaced beyond existing report figures.

## 8. Testing (per `ctyhp-accounting/CLAUDE.md`)
- **Unit:** `cashFlowCategoryOf` for every account type; `assembleCashFlow` tie-out (a balanced
  set where operating+investing+financing == netChange and opening+net == closing), and a
  non-tying set flagged `tiesOut=false`.
- **E2E verify script** (`scripts/verify-cashflow.mjs`, over the pooler, self-cleaning): post a
  sales-receipt (DR bank / CR income) → Operating; a fixed-asset purchase (DR fixed_asset / CR
  bank) → Investing; an owner contribution (DR bank / CR equity) → Financing; assert
  `acc_cash_flow` buckets each correctly and `operating+investing+financing == net cash change ==
  closing − opening`; a bank-to-bank transfer contributes 0. Dashboard metrics: assert overdue
  AR/AP and cash position match direct queries.

## 9. Build sequence
1. Migration `0030`: `acc_cash_flow` read RPC.
2. Domain `cashflow.ts` + schema + unit tests.
3. Services `cashflow.ts` + `dashboard.ts` (+ any db/types).
4. Server actions (cash-flow, dashboard).
5. UI: Cash Flow report page → Dashboard rebuild → nav.
6. E2E verify script; full build + test + typecheck + lint clean.
