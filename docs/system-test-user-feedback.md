# One Book — system test against user feedback

A running record of what the staff test round reported, what was tested, what was
fixed, and what was not built and why. Newest round at the top.

Environment: production database (Supabase project of `ctyhp-accounting`), app at
<https://ctyhp-accounting.vercel.app>, tester `admin@ctyhp.vn`.

---

## Round 2 — accounting review, 2026-07-31

Source: written review supplied by the accountant, item by item. Round 2 covers
**Issue #1** only; the remaining items of the round are listed as backlog at the
end of this section.

### Issue #1 — Missing invoice audit trail & timestamps

Reported severity: CRITICAL. Compliance references: IRS Pub. 583
(recordkeeping), SOX 302 (control certification), GAAP.

#### What the review asked for, and what was already there

| # | Recommendation | State before this round |
|---|---|---|
| 1 | `created_by` / `created_date` / `modified_by` / `modified_date` on invoices | `acc_invoice` had `created_by`, `created_at`, `updated_at`. **No `updated_by`.** `created_by` was written only by the create RPC, so any other write path left it null |
| 2 | Store a username for attribution from the authentication layer | Actor ids were stored; nothing in the product resolved an id to a person outside the users admin screen |
| 3 | Database triggers populate the stamps, manual override prevented | **Nothing.** `updated_at` moved only where an RPC remembered to set it, and a staff user could rewrite `created_by` with a direct update — RLS allows staff to write `acc_invoice` |
| 4 | `AUDIT_LOG` of transaction id, field changed, old value, new value, changed by, changed date | `acc_audit_log` existed with the *whole row* before and after each change (migration 0058), plus actor and timestamp. No field-level reading of it anywhere |
| 5 | Monthly audit trail report filtered by user, transaction type, date range | Settings → Audit History filtered by table, action, record id and date range. **No user filter, no export**, and no field-level view |

Verified before changing anything, so the report separates "was missing" from
"was there and invisible".

#### What was implemented

**Database — `supabase/migrations/0064_transaction_actor_stamps.sql` (applied to production 2026-07-31)**

- `acc_stamp_actor()`, a `BEFORE INSERT OR UPDATE` trigger function that writes
  `created_at`, `created_by`, `updated_at` and `updated_by` from `auth.uid()`
  and `now()`, only for the columns a given table actually has.
- On update, the creation stamps are forced back to their stored values, so an
  attempt to rewrite authorship is accepted as a statement and ignored as a
  fact. This is the "prevent manual override" requirement; it holds against a
  direct PostgREST update, not just against the application.
- Background writes (recurring runs, `service_role` imports) have no
  `auth.uid()`; there the supplied value stands and the UI reads it as `system`.
- `updated_by` added, and the trigger attached, to the thirteen transaction
  tables: invoice, payment, bill, bill payment, expense, tax payment, credit
  memo, vendor credit, customer refund, write-off, journal entry, purchase
  order, goods receipt. The review asked for invoices; every document an
  auditor traces alongside an invoice got the same treatment.
- `acc_actor_directory()` — user id → email/full name for any signed-in role.
  Attribution needs a name; `acc_list_users` carries roles and account status
  and stays behind `users.manage`.

**Database — `supabase/migrations/0065_backfill_document_actors.sql` (applied to production 2026-07-31)**

- Copies the actor of the earliest logged `insert`/`post` entry onto documents
  whose `created_by` was never set, and the actor of the entry that lands on
  the row's own `updated_at` onto `updated_by`. Nothing is attributed by
  proximity: a row the audit log cannot speak for keeps its null and reads as
  `system`.
- Recovered on the live database: invoices 6 → 7 of 13 attributed; payments
  8/8; bills 7/7; expenses 11/11; journal entries 64/64; purchase orders 4/4.
  Six invoices predate the audit triggers of migration 0058 entirely and stay
  unattributed — see "Not implemented" below.

**Application**

- `lib/domain/audit.ts` (new, pure): field-level diff of an audit entry's two
  snapshots, value/actor/timestamp formatting, per-document attribution, and
  the audit-trail report rows and CSV. 22 unit tests in
  `tests/unit/audit.test.ts`.
- `components/audit/DocumentAuditTrail.tsx` (new): "created by / created /
  last modified by / last modified" plus the change history of one document,
  each entry expandable to field, old value, new value.
- Invoices screen: a **Created** column showing timestamp, author, and whether
  the invoice has been edited since; the invoice dialog now opens with the
  attribution block and the full change history above the lines.
- Settings → Audit History: filter by **user**, month presets (this month,
  last month, last 90 days), a "Changed" column summarising the fields that
  moved, a changed-fields table in the expanded row, and **Export CSV** — one
  row per changed field (`Changed at, Changed by, Table, Record id, Action,
  Field changed, Old value, New value`), named `audit-trail-2026-07.csv` for a
  whole calendar month.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 46 files, 397 tests passed (375 before this round) |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 12 pre-existing warnings in `scripts/verify-*.mjs` |
| `npm run build` | succeeded, all routes compiled |
| `tests/e2e/invoice-audit-trail.e2e.ts` (new, HTTPS, live DB) | passed |
| `npm run test:e2e:document-ledger-report` (whole HTTPS suite) | 8 files, 11 tests passed — every reported figure returned to its opening value, so the new triggers changed no posting |
| `scripts/smoke-pages.mjs` | 47 of 47 authenticated pages rendered (200) |

The end-to-end test signs in as an administrator against the production schema
and asserts, on a real invoice it creates and then removes: creation is
attributed to the signed-in user; a direct update that sets `created_by` to
null and `created_at` to 2000-01-01 leaves both unchanged while moving
`updated_at`; issuing the invoice is logged as `post` with `status` and
`invoice_number` among its changed fields; and every audit entry names its
actor.

#### Not implemented, and why

| Recommendation | Decision |
|---|---|
| A separate `AUDIT_LOG` table with `field_changed`, `old_value`, `new_value` columns | **Deliberately not added.** `acc_audit_log` already stores the complete before/after row image, which is strictly more evidence than a per-field triple, and it is written inside the same transaction as the change. A second table would be a copy that can drift from the snapshots it was derived from, and duplicating a rule across two places is what the project rulebook forbids. The field-level view the review asked for is derived from the snapshots — in the UI, in the CSV export, and in the unit tests that pin the derivation. |
| "Monthly Audit Trail Report" as a scheduled, generated document | **Partly.** The report exists on demand: pick a month preset and a user, then Export CSV. It is not generated and delivered on a schedule — the deployment has no job runner or outbound mail, so a monthly delivery would need infrastructure that is not part of this round. |
| `system_username` stored on each transaction | **Stored as the user id, resolved to the email for display.** The authentication layer's identity is the email; copying it onto every row would freeze a stale copy when an address changes, and it would put an identifier into tables that today hold none. The directory resolves it at read time, and the audit log keeps the id. |
| Retroactive attribution for every existing invoice | **Only where evidence exists.** Migration 0065 recovered authorship from the audit log wherever the log recorded it. Six of the thirteen invoices were created before the audit triggers of migration 0058 (2026-07-27) and no record of their author survives anywhere; they read as `system`. Inventing an author for them would be worse than an honest gap. |

### Backlog from the same round (not started)

Recorded from the 14 in-app reports of 2026-07-30/31 (`acc_feedback_report`):

1. `/reports` — spell "Aging", not "Ageing".
2. `/banking` — Add account should default the ledger to a bank account, not
   Cash on hand.
3. `/reports` — add an AP Aging report alongside AR.
4. `/reports/ar-ageing` — matrix layout: customer × Current/1-30/31-60/61-90/
   Over, with row and column totals.
5. `/reports?report=balance` — chart below the numbers, multi-year and
   12-month comparison, variance columns toggleable.
6. `/reports/cash-flow` — chart below the numbers; accountant vs management view.
7. `/sales-tax` — tax rates differ by state; offer a rate list.
8. `/settings/feedback` — let a reporter attach images and PDFs.
9. `/reports`, `/fixed-assets` — separate statements per company (10+ companies).
10. `/banking/reconcile` — import a bank statement and match it automatically.
11. `/invoices` — bulk invoice import with AI field mapping.
12. `/settings` — import a QuickBooks or Wave CSV backup.

Items 9–12 are new modules rather than fixes; they need their own scoping round.
