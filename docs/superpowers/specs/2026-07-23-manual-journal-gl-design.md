# Module B — Manual Journal + Opening Balances + General Ledger/Journal

- **Date:** 2026-07-23
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Related:** `PRD/PRD_US_Accounting_Web_App.md` (US-FR-021..024),
  `US_ACCOUNTING_USER_MANUAL/02_General_Ledger.md`,
  `US_ACCOUNTING_USER_MANUAL/08_Reports_Documents_and_Operations.md`,
  `docs/superpowers/specs/2026-07-15-ctyhp-accounting-webapp-design.md`

## 1. Goal & Scope

Complete the general-ledger core: let accountants create balanced manual journal
entries, correct posted history through linked reversals, seed opening balances
through a controlled batch, and read the ledger through General Ledger and Journal
reports with drill-down and export.

The double-entry foundation already exists (`acc_journal_entry`, `acc_journal_line`,
the deferred balance-constraint trigger, the immutable-posted-line trigger, and the
atomic `acc_post_entry` RPC which already accepts `source_type` values `'manual'` and
`'opening_balance'`). This module adds the service, validation, UI, correction
mechanism, and reports on top of that foundation — it does not change existing tables.

### In scope

- Manual journal entry: multi-line, balanced, atomic post (`source_type='manual'`),
  with `description` and free-text `source_ref`.
- Reversal-based correction (US-FR-023): post a linked reversing entry; the original
  entry stays visible and posted.
- Opening balances (US-FR-022): a dedicated controlled-batch screen that previews a
  balancing Trial Balance (net difference booked to Opening Balance Equity) and must
  reconcile to zero before it commits one `source_type='opening_balance'` entry.
- General Ledger report (account activity + running balance) and Journal report, both
  with the standard report header and CSV/PDF export.
- Reversed-entries report (list of originals with their linked reversals).

### Out of scope (owned by other modules; do not build here, do not preclude)

- Approval / maker-checker on journals, and unposted/rejected/post-close exception
  reports → Module C (Users/Approvals) and Module A (Periods/Close).
- Attachments on journals → Module K (Documents).
- Scheduled/automatic reversal → later phase (Module A).
- Multi-currency FX gain/loss and revaluation → Module I. This module respects the
  existing `amount_base_minor` on each line but adds no new FX logic.
- Closed-period posting blocks → Module A. Reversals are dated independently of the
  original so historical reports stay reproducible regardless.

## 2. Alignment with the user manual

From `02_General_Ledger.md`:

- *"Manual journals support descriptions, source references, attachments, approval, and
  optional scheduled reversal."* → `description` + `source_ref` built now; attachments,
  approval, scheduled reversal deferred to their owning modules (schema/RPC leave room).
- *"Opening balances are imported through a controlled batch whose Trial Balance must
  reconcile before approval."* → dedicated screen with a preview step that must balance
  (control total = 0) before commit.
- *"Posted entries are immutable. Corrections create linked reversal or adjusting
  entries. The original entry remains available, and a later reversal cannot change a
  previously generated historical report."* → reversal-based correction with a link row;
  the original is never mutated or voided; the reversal carries its own entry date.
- *"Required reports: General Ledger, Journal report, Trial Balance, Account activity and
  balance detail, Unposted/rejected/reversed/post-close exception reports."* → General
  Ledger (which is the account-activity/balance-detail report), Journal, and a
  reversed-entries report are in scope; unposted/rejected/post-close depend on
  approval/close and are deferred.

From `08_Reports_Documents_and_Operations.md`:

- Every report shows active filters, accounting basis, date/time generated, company
  context, and base currency; users can drill down to journal entries and source
  documents; CSV/PDF exports preserve parameters. → standard report header + drill-down
  + export applied to General Ledger and Journal.

## 3. Data model

New migration; no changes to existing tables.

**`acc_journal_reversal_link`**
- `id` uuid pk
- `original_entry_id` uuid not null → `acc_journal_entry(id)`, **unique** (an entry is
  reversed at most once)
- `reversal_entry_id` uuid not null → `acc_journal_entry(id)`, unique
- `reason` text not null
- `created_by` uuid → `auth.users(id)`
- `created_at` timestamptz not null default now()
- RLS: staff (`accountant`/`admin`) insert; staff + viewer select. Mirrors existing
  `acc_*` policies.

**`acc_sequence`**: add key `('opening_balance', 'OB-', 1)`. Manual entries reuse the
existing `'journal_entry'` / `'JE-'` sequence; reversals also use `'journal_entry'`.

No new enum values are needed — `'manual'` and `'opening_balance'` already exist in
`acc_journal_source`.

## 4. Postgres RPCs (plpgsql, `security definer`, guard `acc_is_staff()`)

All follow the existing pattern in `0006`/`0012`/`0016`: atomic, validate up front,
reuse `acc_post_entry` for the actual line insert where possible, write an audit row.

**`acc_post_manual_journal(p_entry_date date, p_description text, p_source_ref text, p_lines jsonb) returns uuid`**
- Validate ≥2 lines, each line exactly one positive side, referenced accounts are
  `is_posting_account = true` and `status = 'active'` (reject summary/inactive per manual).
- Add a nullable `source_ref text` column to `acc_journal_entry` in this module's
  migration (existing rows default null). This RPC inserts the entry with `source_ref`
  set, then inserts the lines using the same JSON-array logic as `acc_post_entry` (the
  shared balance/immutability triggers still enforce invariants). `acc_post_entry` itself
  is left unchanged.
- Append `acc_audit_log` (`action='post'`).

**`acc_reverse_entry(p_entry_id uuid, p_reason text, p_reversal_date date) returns uuid`**
- Reject if entry is not `status='posted'`, or already appears as
  `acc_journal_reversal_link.original_entry_id` (already reversed once), or already
  appears as `reversal_entry_id` (a reversal cannot itself be reversed).
- Build reversed lines (swap debit/credit, preserve `amount_base_minor`), post a new
  entry (`source_type` = original's, `source_id` = original entry id) dated
  `p_reversal_date`, insert the link row, audit (`action='reverse'`).
- The original entry is **not** mutated and **not** set to `void` — it stays in reports;
  the reversal nets it out from `p_reversal_date` forward.

**`acc_post_opening_balances(p_as_of date, p_lines jsonb) returns uuid`**
- `p_lines`: `{account_id, debit_minor, credit_minor}` per account (base currency).
- Compute net = Σdebit − Σcredit; append one balancing line to Opening Balance Equity
  (resolve the equity account by a known detail_type/code; error if missing) so the
  entry balances. Refuse if a non-reversed `opening_balance` entry already exists for the
  same `p_as_of` (idempotency / no double seed).
- Post as `source_type='opening_balance'`, audit.

## 5. Pure domain (`lib/domain/`, unit-tested)

- `posting.ts`: `reverse()` already exists — reuse. Add
  `buildOpeningBalancePosting(lines, equityAccountId)` that computes the balancing
  Opening Balance Equity line and calls `assertBalanced`.
- `reports.ts`: add `computeRunningBalance(openingMinor, rows, normalBalance)` — pure,
  produces the per-row running balance for the General Ledger given the account's normal
  balance (from the existing `normalBalance(accountType)` helper in `domain/accounts.ts`).
- `schemas.ts` (Zod):
  - `manualJournalSchema`: `entryDate`, `description?`, `sourceRef?`, `lines` (≥2), each
    line `{ accountId, debitMinor≥0, creditMinor≥0 }` with a refinement that exactly one
    side is positive; a top-level refinement that Σdebit === Σcredit.
  - `openingBalanceSchema`: `asOf`, `lines` (≥1) `{ accountId, debitMinor, creditMinor }`.
  - `reverseEntrySchema`: `entryId`, `reason` (non-empty), `reversalDate`.

## 6. Service (`lib/services/journal.ts`)

Thin wrappers over the RPCs and read queries; the only writer path. No SQL in
components.

- `createManualJournal(sb, input)` → `acc_post_manual_journal`
- `reverseEntry(sb, input)` → `acc_reverse_entry`
- `postOpeningBalances(sb, input)` → `acc_post_opening_balances`
- `listJournalEntries(sb, filters)` — filters: date range, source_type, account, status;
  returns entries with a lines summary for the Journal report.
- `getGeneralLedger(sb, accountId, from, to)` — opening balance before `from` +
  in-range posted lines; running balance computed via `computeRunningBalance`.
- `listReversedEntries(sb, filters)` — join `acc_journal_reversal_link`.

Reads use RPCs where aggregation belongs in SQL (opening balance before a date), mirroring
`acc_ledger_balances`.

## 7. UI (`app/(app)/`, Ant Design)

- `journal/` — Journal Entries list (filters: date/source/account/status) + "New Journal
  Entry" form: editable line grid (account picker limited to active posting accounts,
  debit/credit columns), a live totals row showing debit total, credit total, and
  difference; **Post disabled until difference = 0**. Row action "Reverse" opens a modal
  (reason + reversal date) → `reverseEntry`. Reversed originals badged, linked to their
  reversal.
- `opening-balances/` — grid of accounts with a balance column; a live preview panel
  shows the resulting balancing line to Opening Balance Equity and the net difference;
  **Commit disabled until the previewed Trial Balance reconciles**. Confirmation before
  posting.
- `reports/general-ledger/` — account + date-range filters; opening balance, per-line
  activity, running balance, closing balance; drill-down from each line to its source
  document (`source_type` + `source_id`) or manual entry.
- `reports/journal/` — entry list with expandable lines; drill-down to source.
- All three reports render the standard header (active filters, accounting basis, date/
  time generated, company context, base currency) and offer CSV/PDF export that preserves
  parameters.
- Navigation: add an "Accountant" group (Journal Entries, Opening Balances) and the two
  new report links under Reports.
- Server Actions in each route's `actions.ts` guard by role: `accountant`/`admin` may
  write; `viewer` read-only. Consistent with existing modules.

## 8. Security & audit

- RLS on `acc_journal_reversal_link` matching existing `acc_*` tables.
- Every write RPC appends to `acc_audit_log` atomically (post / reverse / opening_balance).
- Reversal preserves the original entry (immutability); no posted line is ever mutated —
  the existing `acc_journal_line_immutable` trigger continues to hold.

## 9. Testing (per `ctyhp-accounting/CLAUDE.md`)

- **Unit (`tests/unit/`):**
  - `buildOpeningBalancePosting` produces a balanced set (concrete input/output).
  - `reverse` swaps debit/credit and preserves `amount_base_minor`.
  - `computeRunningBalance` with a concrete sequence for a debit-normal and a
    credit-normal account.
  - `manualJournalSchema` rejects unbalanced input and lines with two positive sides;
    `openingBalanceSchema` / `reverseEntrySchema` reject empty/invalid input.
- **End-to-end verify script** (run via Supabase SQL Editor, following the existing
  `verify-*` scripts, because the DB is not reachable over the IPv4-only network):
  1. Post a manual JE → General Ledger and Trial Balance reflect it and Trial Balance
     still balances.
  2. Reverse it in a later period → original stays posted and visible; net effect from
     the reversal date = 0; a report generated before the reversal date is unchanged.
  3. Post opening balances → Balance Sheet balances and Opening Balance Equity carries the
     net difference.

## 10. Build sequence

1. Migration: `acc_journal_reversal_link`, `source_ref` column, `opening_balance`
   sequence, RLS.
2. Migration: `acc_post_manual_journal`, `acc_reverse_entry`,
   `acc_post_opening_balances` RPCs.
3. Domain helpers + Zod schemas + unit tests.
4. Service layer.
5. Server Actions + role guards.
6. UI: journal list/form → opening balances → General Ledger → Journal → reversed report
   → navigation.
7. E2E verify script; run build + test + typecheck + lint with clean output.
