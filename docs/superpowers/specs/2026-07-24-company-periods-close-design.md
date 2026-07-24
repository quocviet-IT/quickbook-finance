# Company Settings + Accounting Periods / Close (A)

- **Date:** 2026-07-24
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Related:** `PRD/PRD_US_Accounting_Web_App.md` (US-FR-001, US-FR-003, US-FR-004),
  `US_ACCOUNTING_USER_MANUAL/01_Company_Users_and_Close.md`,
  `docs/superpowers/specs/2026-07-15-ctyhp-accounting-webapp-design.md`

## 1. Goal & Scope

Give the ledger period protection and a versioned company profile: maintain company
settings (including fiscal-year start and accounting basis), organize the ledger into
monthly accounting periods, close/reopen periods under control, and **block any posting or
void whose date falls in a closed period** so previously reported figures stay reproducible.

`acc_post_entry` (migration 0001) is the single write path for every journal entry (invoice
issue, payment, bill, expense, manual journal, credit memo, vendor credit, refund, write-off,
reconciliation adjustment, opening balances). A single closed-period guard there covers all
new postings; a trigger on `acc_journal_entry` status changes covers voids.

### In scope
- **Company settings** (US-FR-001), versioned: legal name, DBA, EIN reference (masked,
  excluded from audit payloads), addresses, fiscal-year start month, base currency, time
  zone, accounting basis (accrual|cash — the flag is stored; cash-basis *reporting* is
  deferred), default payment terms. Each change writes a new version with an effective date.
- **Accounting periods** (US-FR-003): monthly periods auto-generated per fiscal year from the
  fiscal-year start month; each period is `open` or `closed`.
- **Close / reopen** a period (admin + required reason), with a period-event history.
- **Closed-period guard**: `acc_post_entry` rejects a posting dated in a closed period; a
  trigger rejects setting a journal entry to `void` when its date is in a closed period.
  Corrections to a closed period are made by a reversal dated in an open period (Module B).
- **Closing checklist**: an informational panel shown when closing a period, linking to the
  control reports (AR ageing, AP ageing, bank reconciliation, sales-tax liability).

### Out of scope (own cycles / later)
- Cash vs Accrual **reporting** (US-FR-002) — a large separate cycle touching every report;
  only the `accounting_basis` flag is stored now.
- `soft_closed` period state (manual lists open/soft_closed/closed) — this cycle is binary
  open/closed; soft-close is a later enhancement.
- Document-numbering **configuration UI** (US-FR-004) — atomic, unique, never-reused numbering
  already exists via `acc_sequence`; a prefix-config screen is deferred.
- Users, permissions, and full maker-checker **approval** (US-FR-010..012) → Module C; reopen
  is gated to admin + reason now, and the period-event table leaves room for an approver.
- Sensitive-identifier encryption/vaulting beyond masking + audit-exclusion → security review.

## 2. Alignment with the user manual (ch. 01)

- *"Administrators maintain legal business name, DBA, EIN reference, addresses, fiscal-year
  start, base currency, time zone, default payment terms, document numbering, and default Cash
  or Accrual report basis."* → company settings fields (numbering already atomic via
  `acc_sequence`; cash/accrual is a stored flag).
- *"Sensitive identifiers must be masked in normal views … excluded from ordinary audit
  payloads, and restricted to authorized roles."* → EIN masked in UI, never written to
  `acc_audit_log`, settings table admin-only.
- *"Accounting-sensitive configuration uses version history and effective dates."* →
  `acc_company_setting_version` with `effective_from`; current = latest effective row.
- *"Periods progress through open, soft_closed, closed, reopened."* → this cycle implements
  open/closed + reopen; soft_closed deferred.
- *"Closed periods reject new or changed postings."* → the `acc_post_entry` guard + the void
  trigger.
- *"Reopening requires permission, reason, and approval. Changes after reopening appear in an
  exception report."* → admin + reason now (approval deferred); the period-event log and a
  post-reopen activity view provide the exception history.
- *"Closing checklists cover bank reconciliation, AR/AP reconciliation, sales-tax controls…"*
  → an informational checklist panel linking those reports.

## 3. Data model (new migration; no changes to existing tables)

**`acc_company_setting_version`**
- `id` uuid pk, `version` int (monotonic), `effective_from` date not null
- `legal_name` text not null, `dba_name` text, `ein_ref` text (masked in UI; never audited)
- `address_line1`, `address_line2`, `city`, `region`, `postal_code`, `country` text
- `fiscal_year_start_month` int not null default 1 check 1..12
- `base_currency_code` text not null references `acc_currency(code)` default `'USD'`
- `time_zone` text not null default `'America/New_York'`
- `accounting_basis` `acc_accounting_basis` not null default `'accrual'` (`accrual`|`cash`)
- `default_payment_terms_days` int not null default 30
- `created_by` uuid → auth.users, `created_at` timestamptz
- Current settings = the row with the greatest `effective_from` (tiebreak `version`).
- RLS: staff+viewer read; **admin** insert. (Table is append-only; no update/delete.)

**`acc_accounting_period`**
- `id` uuid pk, `fiscal_year` int not null, `period_month` int not null check 1..12
- `period_start` date not null unique, `period_end` date not null
- `label` text not null (e.g. `'2026-07'`)
- `status` `acc_period_status` not null default `'open'` (`open`|`closed`)
- `closed_by`/`closed_at`/`close_reason`, `reopened_by`/`reopened_at`/`reopen_reason` (nullable)
- `created_at`; unique(`fiscal_year`,`period_month`)
- RLS: staff+viewer read; admin write.

**`acc_period_event`**
- `id` uuid pk, `period_id` → `acc_accounting_period` (cascade)
- `event` text (`close`|`reopen`), `reason` text not null, `actor_id` uuid → auth.users,
  `created_at` timestamptz
- RLS: staff+viewer read; admin insert.

New enums `acc_accounting_basis`, `acc_period_status`.

## 4. Closed-period guard (the core protection)

**`acc_is_period_closed(d date) returns boolean`** — true iff a period row covers `d` and its
`status='closed'`. A date with no period row is **not** closed (periods block only when
explicitly closed), so the guard is inert until an admin generates and closes periods.

- **Post guard:** redefine `acc_post_entry` (0001) to add, right after the balance/empty
  checks, `if acc_is_period_closed(p_entry_date) then raise exception 'Accounting period for %
  is closed'; end if;`. Everything else in the function is unchanged.
- **Void guard:** a `before update` trigger on `acc_journal_entry` that raises when
  `new.status='void'` and `old.status<>'void'` and `acc_is_period_closed(old.entry_date)`.
  This blocks every document void path (they all `update acc_journal_entry set status='void'`)
  when the entry sits in a closed period.
- **Corrections:** Module B's `acc_reverse_entry` posts a NEW entry dated `p_reversal_date`
  through `acc_post_entry`, so a reversal into an open period is allowed while the closed
  original stays intact — the sanctioned correction path.

## 5. RPCs (plpgsql, `security definer`, admin-gated where noted, append `acc_audit_log`)

- `acc_generate_periods(p_fiscal_year int) returns int` — idempotent; reads the current
  settings' `fiscal_year_start_month`, inserts the 12 monthly periods for that fiscal year
  (`on conflict (fiscal_year, period_month) do nothing`), returns the count created. Admin.
- `acc_close_period(p_period_id uuid, p_reason text)` — admin; requires a non-empty reason;
  sets `status='closed'`, stamps `closed_by/at/close_reason`, inserts a `close` period-event,
  audits.
- `acc_reopen_period(p_period_id uuid, p_reason text)` — admin; requires a non-empty reason;
  sets `status='open'`, stamps `reopened_by/at/reopen_reason`, inserts a `reopen` event, audits.
- `acc_save_company_settings(...) returns uuid` — admin; inserts a new
  `acc_company_setting_version` (version = prior max + 1) with the supplied fields; the EIN is
  stored but never written to `acc_audit_log` (audit records the action + version, not the EIN).

## 6. Pure domain (`lib/domain/periods.ts`, unit-tested) + schemas

- `computePeriods(fiscalYearStartMonth: number, fiscalYear: number): { fiscalYear: number; periodMonth: number; periodStart: string; periodEnd: string; label: string }[]` —
  12 monthly ranges starting at the fiscal-year start month. **`fiscalYear` is the calendar
  year in which the fiscal year begins**: e.g. `computePeriods(7, 2026)` yields Jul 2026 …
  Jun 2027. `periodMonth` is 1..12 as the ordinal within the fiscal year (period 1 = the start
  month), independent of the calendar month. `label` is the ISO `YYYY-MM` of `periodStart` (so
  labels stay chronological even when the FY spans two calendar years). For a January start,
  `computePeriods(1, 2026)` yields Jan..Dec 2026 with `period_month` = calendar month.
- `periodLabelOf(date: string, fiscalYearStartMonth: number): string` — the period label a
  date falls into (helper for display).
- `lib/domain/schemas.ts`: `companySettingsSchema` (legal_name required; fiscal_year_start_month
  1..12; accounting_basis enum; terms ≥ 0; …), `closePeriodSchema` / `reopenPeriodSchema`
  (reason non-empty).

## 7. Service / Actions / UI

- `lib/services/periods.ts` (`generatePeriods`, `closePeriod`, `reopenPeriod`,
  `listPeriods(fiscalYear)`) and `lib/services/company.ts` (`getCurrentCompanySettings`,
  `listCompanySettingVersions`, `saveCompanySettings`). All writes via RPC; reads via queries.
  Row types in `lib/db/types.ts`.
- Server Actions guard by role: reading is staff/viewer; **all period and settings writes are
  admin-only** (`isAdmin`). Never trust client math.
- UI (Ant Design):
  - `/settings/company` — view current settings + edit form (admin) that saves a new version;
    EIN shown masked (e.g. `••• ••1234`); a version-history table.
  - `/settings/periods` — pick fiscal year, "Generate periods", a table of the 12 periods with
    status and Close/Reopen actions (admin, reason modal); a closing-checklist panel linking to
    `/reports/ar-ageing`, `/reports/ap-ageing`, `/banking/reconcile`, `/sales-tax`.
  - Nav: a "Settings" group (Company, Periods).

## 8. Security & audit
- RLS on all three new tables (admin write; staff+viewer read). Period close/reopen and
  settings changes append `acc_audit_log` atomically. EIN is masked in the UI and excluded
  from audit payloads. The closed-period guard and void trigger are enforced in the database,
  so no client path can bypass them.

## 9. Testing (per `ctyhp-accounting/CLAUDE.md`; Release Gate #6)
- **Unit:** `computePeriods` for fiscal-year start = January (periods Jan–Dec, one calendar
  year) and = July (Jul–Jun, spanning two years) with exact start/end/label; `periodLabelOf`
  boundary dates; schemas reject bad input.
- **E2E verify script** (`scripts/verify-periods.mjs`, over the pooler, self-cleaning): generate
  periods for a year → post a manual JE in an open month → close that month → posting another JE
  and voiding the first are both **rejected** with a closed-period error → reverse the first via
  `acc_reverse_entry` into an open month **succeeds** → reopen the month → posting succeeds again;
  save company settings twice → two versions, current = latest; EIN not present in the audit row.

## 10. Build sequence
1. Migration: enums + `acc_company_setting_version` + `acc_accounting_period` + `acc_period_event`
   + RLS.
2. Migration: `acc_is_period_closed`, redefined `acc_post_entry` (guard), void trigger,
   `acc_generate_periods`, `acc_close_period`, `acc_reopen_period`, `acc_save_company_settings`.
3. Domain `periods.ts` + schemas + unit tests.
4. Services (`periods.ts`, `company.ts`) + db/types.
5. Server actions + admin guards.
6. UI: company settings → periods list + close/reopen → checklist panel → nav.
7. E2E verify script; full build + test + typecheck + lint clean.
