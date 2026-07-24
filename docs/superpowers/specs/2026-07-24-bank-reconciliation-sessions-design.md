# Bank Reconciliation — Statement Reconciliation Sessions (F1)

- **Date:** 2026-07-24
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Related:** `PRD/PRD_US_Accounting_Web_App.md` (US-FR-063, US-FR-064, US-FR-065),
  `US_ACCOUNTING_USER_MANUAL/05_Banking_and_Reconciliation.md`,
  `docs/superpowers/specs/2026-07-15-ctyhp-accounting-webapp-design.md`

## 1. Goal & Scope

Add period-end statement reconciliation for a bank account: reconcile the posted ledger
activity on the bank's GL account against a bank statement's ending balance, mark items
cleared, complete the session only when the unexplained difference is zero (or an explicitly
approved adjustment brings it to zero), lock the completed session, support a controlled
reopen, and produce reproducible reconciliation and discrepancy reports.

The banking foundation already exists (Module 3): `acc_bank_account` maps a GL account to a
bank; `acc_bank_transaction` holds immutable imported statement lines; `acc_reconciliation`
holds bank-line↔payment match suggestions. This module is a **separate concept** — a
period-end tie-out of the GL bank account's journal lines — so it uses a new table
`acc_statement_reconciliation` (per PRD §7) to avoid confusion with the existing
`acc_reconciliation`.

Bank GL activity to reconcile arrives from every existing flow that touches the bank
account: customer payments (deposit), expenses, bill payments, tax payments, refunds,
manual journals. The session reconciles those posted `acc_journal_line` rows regardless of
how they were created and regardless of whether a CSV statement was imported.

### In scope
- Reconciliation session per bank account: statement ending date, beginning balance
  (auto from the prior completed session), statement ending balance, status, preparer,
  completer, timestamps, optional statement reference.
- Cleared-item selection: list unreconciled posted journal lines on the bank's GL account
  dated on/before the statement ending date; user toggles each cleared.
- Live reconciliation math: `reconciled balance = beginning + Σ(cleared signed base amounts)`;
  `difference = statement ending − reconciled balance`.
- Completion requires `difference = 0`, or an **approved adjustment** entry that brings it to
  zero (posted to a user-selected offset account, e.g. bank charges / interest income, with a
  required reason).
- Lock on completion; cleared lines become permanently reconciled (linked to the session).
- Controlled reopen (admin + required reason, audited) → session back to in-progress; lines
  released.
- Reconciliation report (reproducible session detail) + discrepancy report (reconciled lines
  whose journal entry was later voided).

### Out of scope (own cycles / later)
- Transaction review: categorize / create / split / transfer / exclude bank lines (US-FR-061)
  → F2.
- Bank rules: versioned, approved auto-categorization (US-FR-062) → F3.
- Attaching the statement file → Module K (Documents); a free-text `statement_ref` is stored now.
- Full maker-checker approval on completion/reopen (US-FR-064 "approval") → Module C; reopen is
  gated to admin + reason now, and the schema leaves room for an approver.
- Auto-suggesting cleared items from imported `acc_bank_transaction` — manual ticking first;
  auto-suggest is a later enhancement.

## 2. Alignment with the user manual (§ Statement reconciliation, § Concurrency)

- *"A reconciliation session stores the account, statement ending date, beginning balance,
  ending balance, status, preparer, approver, and attached statement."* → all stored on
  `acc_statement_reconciliation` (approver/attachment deferred as above; fields present or
  represented by `statement_ref`).
- *"Beginning balance agrees with the previous completed reconciliation."* → beginning is
  computed server-side from the prior completed session's ending balance; not user-editable
  except for the first-ever session on an account.
- *"Cleared ledger activity is linked to reconciliation lines."* → `acc_reconciliation_line`
  links the session to each cleared `acc_journal_line`.
- *"Completion requires a zero unexplained difference or an explicitly approved adjustment."*
  → `acc_complete_reconciliation` rejects a non-zero difference; the adjustment RPC posts a
  balanced entry and auto-clears its bank line to reach zero.
- *"Completed sessions are locked and produce a reproducible reconciliation report."* →
  completion sets `status='completed'`; all figures are stored, so the report re-renders
  identically.
- *"Reopen requires reason, permission, and approval."* → `acc_reopen_reconciliation` requires
  admin + reason (approval deferred to Module C).
- *"Later changes to reconciled transactions create alerts and discrepancy history."* → posted
  entries are immutable except void; a reconciled line whose entry becomes `void` surfaces in
  the discrepancy report.
- *§ Concurrency: "Approval and matching are transactional."* → all session mutations are
  atomic RPCs with row locks; a journal line reconciled in a completed session cannot be
  cleared into another session (enforced in SQL).

## 3. Data model

New migration; no changes to existing tables. Money in integer minor units (base currency).

**`acc_statement_reconciliation`**
- `id` uuid pk
- `bank_account_id` uuid not null → `acc_bank_account(id)`
- `statement_ending_date` date not null
- `beginning_balance_minor` bigint not null default 0
- `statement_ending_balance_minor` bigint not null
- `status` `acc_reconciliation_session_status` not null default `'in_progress'` (`in_progress`|`completed`)
- `adjustment_entry_id` uuid → `acc_journal_entry(id)` (nullable)
- `adjustment_reason` text
- `statement_ref` text (file reference; Module K later)
- `prepared_by` uuid → `auth.users(id)`
- `completed_by` uuid → `auth.users(id)`
- `completed_at` timestamptz
- `reopened_by` uuid → `auth.users(id)`
- `reopen_reason` text
- `created_at` / `updated_at` timestamptz not null default now()
- Partial unique index: at most one `in_progress` session per `bank_account_id`.

**`acc_reconciliation_line`**
- `id` uuid pk
- `reconciliation_id` uuid not null → `acc_statement_reconciliation(id)` on delete cascade
- `journal_line_id` uuid not null → `acc_journal_line(id)`
- `cleared_at` timestamptz not null default now()
- unique(`reconciliation_id`, `journal_line_id`)
- A line reconciled by a completed session must not be cleared into another session; this is
  enforced in `acc_set_cleared` (see §6), not by an extra column.

New enum `acc_reconciliation_session_status`. RLS mirrors existing `acc_*` (staff write,
staff+viewer read).

## 4. Reconciliation math (pure domain, unit-tested)

The bank GL account is debit-normal: a deposit debits it (increase), a payment credits it
(decrease). For a cleared journal line on the bank account, `signed = debit_minor −
credit_minor` (base-currency `amount_base_minor` split by side).

```
clearedTotalMinor    = Σ signed(cleared lines)
reconciledBalanceMinor = beginningMinor + clearedTotalMinor
differenceMinor      = statementEndingMinor − reconciledBalanceMinor
isBalanced           = differenceMinor === 0
```

`computeReconciliation(beginningMinor, clearedLines, statementEndingMinor)` returns all four.
`buildAdjustmentPosting({ bankAccountId, offsetAccountId, amountMinor })` produces a balanced
2-line entry: if the bank needs to increase (statement > reconciled), DR bank / CR offset;
else CR bank / DR offset. `assertBalanced` enforced.

## 5. Where the difference/adjustment posts

The adjustment offset account is user-selected (an expense like *Bank Charges* or income like
*Interest Income*). The RPC validates it is a posting account of an income/expense type
(not the bank/AR/AP control accounts), posts the balanced entry dated the statement ending
date, sets `adjustment_entry_id`/`adjustment_reason`, and auto-inserts the adjustment's bank
journal line as a cleared `acc_reconciliation_line` so the difference resolves to zero.

## 6. RPCs (plpgsql, `security definer`, guard `acc_is_staff()`, append `acc_audit_log`)

- `acc_create_reconciliation(p_bank_account_id, p_ending_date, p_ending_balance_minor)` →
  rejects if an `in_progress` session already exists for the account; computes
  `beginning_balance_minor` from the latest completed session's `statement_ending_balance_minor`
  (0 if none); inserts `in_progress`; returns id.
- `acc_set_cleared(p_reconciliation_id, p_journal_line_id, p_cleared bool)` → only when the
  session is `in_progress`; validates the line belongs to the bank's GL account, its entry is
  `posted` and dated ≤ the session's ending date, and the line is not reconciled by any
  completed session; inserts or deletes the `acc_reconciliation_line` row.
- `acc_record_reconciliation_adjustment(p_reconciliation_id, p_offset_account_id, p_amount_minor, p_reason)` →
  validates offset account type; posts the balanced adjustment entry (`source_type='reconciliation'`);
  stores adjustment fields; auto-clears the adjustment's bank line into the session.
- `acc_complete_reconciliation(p_reconciliation_id)` → recomputes the difference server-side
  from cleared lines; rejects if ≠ 0; sets `status='completed'`, `completed_by/at`; the
  session's lines are now final (reconciled).
- `acc_reopen_reconciliation(p_reconciliation_id, p_reason)` → requires `acc_is_admin()` and a
  non-empty reason; sets `status='in_progress'`, records `reopened_by`/`reopen_reason`; lines
  become editable again (no longer final).
- Read RPCs: `acc_reconciliation_uncleared_lines(p_reconciliation_id)` (candidate + currently
  cleared lines with signed amounts), `acc_reconciliation_detail(p_reconciliation_id)` (report),
  `acc_reconciliation_discrepancies(p_bank_account_id)` (reconciled lines whose entry is now void).

"Final" enforcement: a line reconciled by a completed session must not be cleared elsewhere.
Implemented by checking, in `acc_set_cleared`, that no `acc_reconciliation_line` exists for the
same `journal_line_id` under a **different** session whose `status='completed'`.

## 7. Pure domain (`lib/domain/`) + schemas

- `lib/domain/bankrec.ts` (new): `computeReconciliation`, the bank-line signing helper, and
  `buildAdjustmentPosting` (reuses `assertBalanced`/`JournalLineInput` from `posting.ts`).
- `lib/domain/schemas.ts`: `reconciliationCreateSchema` (bank_account_id, ending_date,
  ending_balance_minor), `reconciliationAdjustmentSchema` (offset_account_id, amount_minor>0,
  reason), `reconciliationReopenSchema` (reason non-empty).

## 8. Service / Actions / UI

- `lib/services/bankrec.ts`: `createReconciliation`, `setCleared`, `recordAdjustment`,
  `completeReconciliation`, `reopenReconciliation`, `listReconciliations`,
  `getReconciliationDetail`, `getUnclearedLines`, `getDiscrepancies` — all via RPC / read
  queries; `BankRecError`. Row types in `lib/db/types.ts`.
- Server Actions guard by role: `accountant`/`admin` operate; **reopen is admin-only**; viewer
  read-only. Never trust client math — the server recomputes the difference on complete.
- UI `app/(app)/banking/reconcile/`:
  - list of sessions per bank account (status, dates, balances) + "New reconciliation".
  - session workspace: header (bank account, ending date, beginning, statement ending), a table
    of candidate bank GL lines with a cleared checkbox, and a live summary panel (cleared total,
    reconciled balance, statement ending, **difference**). "Record adjustment" modal (offset
    account + amount + reason). "Complete" disabled until difference = 0. "Reopen" (admin) with
    reason.
  - reconciliation report page (reproducible) and a discrepancy list.
  - Nav: a "Reconcile" entry under Banking.

## 9. Security & audit
- RLS on both new tables. Every write RPC appends `acc_audit_log` (create/clear/adjust/complete/reopen).
- Completed sessions are immutable except through the controlled reopen; the adjustment entry
  follows the standard posted-entry immutability.

## 10. Testing (per `ctyhp-accounting/CLAUDE.md`; Release Gate #5)
- **Unit:** `computeReconciliation` with concrete inputs (partial clear; with/without
  adjustment; difference sign both directions); `buildAdjustmentPosting` balances in both
  directions; schemas reject bad input.
- **E2E verify script** (`scripts/verify-bankrec.mjs`, over the pooler, void-before-delete
  self-cleanup): record a customer payment (posts to bank) → create a session with the matching
  ending balance → clear the line → difference 0 → complete → the line no longer appears as a
  candidate in a new session; a session with a residual → record an adjustment → difference 0 →
  complete; void a reconciled entry → it appears in the discrepancy report; reopen a completed
  session (as admin) → its lines become clearable again. Concurrency: a second `in_progress`
  session for the same account is rejected.

## 11. Build sequence
1. Migration: `acc_statement_reconciliation` + `acc_reconciliation_line` + enum + RLS + indexes.
2. Migration: create/set-cleared/adjustment/complete/reopen RPCs + read RPCs.
3. Domain `bankrec.ts` + schemas + unit tests.
4. Service + db/types.
5. Server actions + role guards.
6. UI: session list + workspace → adjustment modal → complete/reopen → reconciliation report →
   discrepancy list → nav.
7. E2E verify script; full build + test + typecheck + lint clean.
