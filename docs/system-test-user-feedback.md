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

### Issue #2 — Invoice sequencing & gap detection

Reported severity: CRITICAL, fraud risk HIGH. References: AICPA AS 1301 (risk
assessment), IRS Rev. Proc. 86-19.

#### What the review asked for, and what was already there

| # | Recommendation | State before this round |
|---|---|---|
| 1 | Auto-incrementing numbers enforced by the database, no manual override | Numbers came from `acc_sequence` inside the SECURITY DEFINER issue/post RPCs, and no screen offers a number field. **But RLS grants staff `for all` on the document tables**, so a direct API call could set or rewrite `invoice_number` — and could delete a numbered invoice outright |
| 2 | `INVOICE_SEQUENCE` table with last and next expected number | `acc_sequence` already holds prefix and `next_value` per document type. Nothing recorded *where* a sequence's numbers live, so nothing could reconcile them |
| 3 | Reconciliation of the subledger against the expected sequence | **Nothing.** At review time the invoice counter stood at 28 with fourteen issued numbers on no document, and the product never said so |
| 4 | Alert when a gap is detected | **Nothing** |
| 5 | Monthly report listing invoices by number, breaks flagged | **Nothing.** The invoice list was sorted by creation time, which is what made the numbers look shuffled in the screenshot |

#### What was implemented

**Database — `0066_document_number_integrity.sql`, `0067_number_guard_runs_as_caller.sql` (both applied to production 2026-07-31)**

- `acc_guard_document_number()`, a `BEFORE UPDATE OR DELETE` trigger on all
  thirteen numbered document tables: a number cannot be assigned, changed, or
  cleared from an application session, and a numbered document cannot be
  deleted at all — it is voided instead. The guard runs as the *caller*
  (SECURITY INVOKER), which is what lets it tell a PostgREST session
  (`authenticated`) from the issuing RPC (runs as the table owner). 0067 exists
  because 0066 defined it as SECURITY DEFINER and the check never fired; the
  end-to-end test caught that before it shipped.
- `acc_number_source`: the registry saying which table, number, date and status
  column each sequence's numbers live in. Adding a numbered document type later
  is one insert.
- `acc_number_gap_note`: why a number is missing, who said so, and when —
  writable only with `settings.manage`, and itself audited. An undocumented
  break stays an open exception; a documented one is closed and keeps its
  reason on the report.
- `acc_sequence_catalog()` and `acc_sequence_documents(key)` report what the
  database holds. Which numbers are *missing* is worked out in one place in the
  application, so unit tests can hold that rule to account.

**Application**

- `lib/domain/sequence.ts` (new, pure) + 13 unit tests: the whole number line of
  a sequence, gaps split into explained and unexplained, documents numbered
  *above* the counter reported rather than hidden, the banner sentence, and the
  CSV listing.
- **Reports → Document Number Sequence** (new): every document type with issued
  / on file / explained / unaccounted-for counts, then the number line of the
  selected type — "breaks only" or every number — with Export CSV. An
  administrator can record why a number is missing from the same row.
- Invoices screen: an error banner naming the missing numbers with a link to
  the report, the list now ordered **by invoice number** (drafts first) instead
  of by creation time, and every column sortable.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 47 files, 410 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded, `/reports/number-sequence` compiled |
| `scripts/smoke-pages.mjs` | 48 of 48 pages rendered (200), including the new report |
| `npm run test:e2e:document-ledger-report` (whole HTTPS suite) | 9 files, 13 tests passed |
| `tests/e2e/invoice-sequence.e2e.ts` (new, HTTPS, live DB) | 2 tests passed |

The end-to-end test proves the control on the real database: assigning
`INV-999999` to a draft is refused, the number the sequence hands out at issue
matches `INV-\d{6}`, rewriting it is refused, deleting the numbered invoice is
refused and the row is still there afterwards, and the sweep that removes test
data with the service role leaves a documented reason for the number it frees.

#### State of the live invoice sequence after this round

Counter at `INV-000028`. Numbers 22–27 are documented as removed by end-to-end
test sweeps. Numbers **7, 8, 15, 16, 17, 18, 19 and 20 remain unexplained** —
they disappeared before any of this existed and nothing records why. They are
what the banner and the report now show, which is the point: the product no
longer hides them. Someone who knows what happened should document them, or
they stay an open exception.

#### Not implemented, and why

| Recommendation | Decision |
|---|---|
| `INVOICE_SEQUENCE` table keyed by year and month, numbering resetting each period | **Not done.** It would renumber a live ledger — invoices already issued to customers cannot change — and a per-month reset makes every month's sequence start at 1, which is harder to reconcile, not easier. The continuous sequence plus `acc_number_source` gives the same two facts the recommendation wants (last issued, next expected) without touching a single existing number. |
| Daily reconciliation query and alerting | **Partly.** The check runs whenever the invoice screen or the report is opened, and the banner is the alert. Nothing runs it on a schedule or emails the result: the deployment has no job runner and no outbound mail. |
| Monthly reconciliation report | **As an on-demand export.** Reports → Document Number Sequence lists every number in order with breaks flagged and exports to CSV. It is not sliced by month, because a break has to be judged against the whole sequence — filtering by date would hide any gap whose neighbours fall outside the filter. |
| Blocking deletion for every role | **Application sessions only.** The service role and the database owner can still delete — migrations, seeds, and test cleanup have to be able to correct data. Both are outside the application and outside RLS by design; the control is that nobody signed into One Book can remove a numbered document. |

### Issue #3 — Sales tax rates differ by state

Source: the one in-app report sitting in **Reviewing**
(`acc_feedback_report`, `/sales-tax`, 2026-07-30 22:42, `admin@ctyhp.vn`):
"Tax rates are different with each states, could you please create taxes rates,
like a drop down."

#### What was already there

Sales Tax → Tax rates could already create, edit, activate and deactivate a
rate, and the invoice line already picked one from a dropdown. What it could
not do is say **which state a rate belongs to**: the picker read
`TAX (8.25%)`, the rates list was a flat alphabetical list of codes, and the
liability could only be read per code — never per state, which is how a return
is filed. Five codes existed, none tied to a jurisdiction.

#### What was implemented

**Database — `0068_tax_code_jurisdiction.sql` (applied to production 2026-07-31)**

- `acc_us_state`: the 50 states plus DC and Puerto Rico, readable by any
  signed-in role. It gives the picker its options.
- `acc_tax_code.state_code`: the jurisdiction a rate is filed in. Null stays
  valid — an exemption or a use-tax code belongs to no single state, and the
  rates list groups those under "No state".

**Application**

- `lib/domain/tax-jurisdiction.ts` (new, pure) + 14 unit tests: grouping rates
  by state, the `CA — CA-SALES (7.25%)` label, rolling the liability up per
  state, and choosing the rate for a customer's state.
- Sales Tax → **Tax rates**: a State column with a per-state filter, rates
  ordered by state, and a searchable state picker in the rate dialog.
- Sales Tax → **Liability**: an "Owed by state" table above the per-rate
  detail — one line per state, largest first, listing the codes behind it.
  Tax collected under a code that no longer carries a state still appears
  under "No state" rather than vanishing from the total.
- Invoices: the tax dropdown is now grouped by state and searchable. Selecting
  a customer fills the rate registered in that customer's state on lines that
  have none yet — destination sourcing — and fills nothing when the company has
  no rate there or the state has more than one.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 48 files, 424 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | `/sales-tax` and `/invoices` rendered |

#### Not implemented, and why

| Recommendation | Decision |
|---|---|
| Ship the 50 state rates ready to use | **Deliberately not seeded.** A state rate is only half of what is charged — county, city and district add to it — and every rate changes by legislature. A number this product invented would be wrong somewhere and would be trusted anyway. The states are seeded; the rates are the accountant's, entered once per state they are registered in. |
| Automatic rate lookup by address | **Not built.** Correct rooftop-level rates mean a paid tax service (Avalara, TaxJar) and an address-validation step; that is an integration to scope, not a field to add. |
| Existing codes classified into states | **Left alone.** `TAX (8.25%)` looks like a Texas combined rate but nothing in the data says so. Guessing a jurisdiction onto a rate already used on issued invoices would be a fabrication; the codes show under "No state" until someone who knows sets them. |

### Issue #4 — "Ageing" is not how the report is spelled

Source: the in-app report moved to **Reviewing** after Issue #3
(`acc_feedback_report`, `/reports`, `admin@ctyhp.vn`): "Accounts Receivable
Aging report not Ageing, change it, Thanks!"

The product is US English (USD, Sales Tax not VAT); `ageing` is the British
spelling and it had spread from the first AR/AP work into the report titles,
the URLs, the dashboard, the work areas, the charts, the period close screen,
and the manual the in-app assistant answers from.

#### What was implemented

- **Report names**: Accounts Receivable Aging, Accounts Payable Aging, and
  every "ageing" in a description, column header, chart title, tile label or
  helper text — 27 files.
- **URLs**: `/reports/ar-ageing` → `/reports/ar-aging`, `/reports/ap-ageing` →
  `/reports/ap-aging`. The old addresses are kept as permanent redirects in
  `next.config.ts`: a report gets bookmarked and the old address is already in
  screenshots, so it redirects rather than 404s.
- **The manual**: the five chapters of `US_ACCOUNTING_USER_MANUAL` that used
  the British spelling, with `lib/ai/manual-context.generated.ts` regenerated
  from them, so the assistant answers in the same spelling as the screens.
- **The code**: `lib/domain/ageing.ts` → `aging.ts`, `lib/services/ageing.ts` →
  `aging.ts`, their tests, and every identifier (`AgeingSnapshot`,
  `getArAgeing`, `AGEING_BUCKETS`, the `ageing-chart` CSS classes). One
  spelling in the codebase is what stops the old one coming back.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 48 files, 424 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded, `/reports/ar-aging` and `/reports/ap-aging` compiled |
| `scripts/smoke-pages.mjs` | 48 of 48 pages rendered, on a dev server and again on the built server |
| Old URLs | `/reports/ar-ageing` and `/reports/ap-ageing` answer 308 to the new paths |

#### Also in this change: the smoke sweep got 20× faster

The sweep was taking 25–40 minutes because it ran against `npm run dev`, which
compiles each route on its first request — 30–100 seconds per page, for a
request that takes 200ms. Against the built server (`npm run build` 47s +
`npm start`) the same 48 pages finish in 78s. `scripts/smoke-pages.mjs` also
takes `--only=invoices,sales-tax` to check one screen in about 5 seconds, and
`--concurrency=N` (6 by default, 1 against a dev server, where parallel
compiles just fight over the CPU). The procedure in `CLAUDE.md` now says to
use the built server.

It cannot move to CI: the workflow deliberately runs with placeholder Supabase
keys so the pipeline cannot reach the production database, and the smoke script
has to sign in as a real user to render a page.

#### Not implemented, and why

| Item | Decision |
|---|---|
| Renaming the database functions `acc_ar_ageing` / `acc_ap_ageing` | **Left as they are.** Renaming a live SECURITY DEFINER function means dropping and recreating it while reports read from it, for a name no user ever sees. The ten call sites keep the database's spelling; everything above them uses the product's. |
| The QuickBooks manual in `QUICKBOOK_USER_MANUAL/` | **Left as it is.** It documents QuickBooks, where those screens really are labelled "Ageing" in some locales. Rewriting it would misquote the product it describes. |

### Backlog from the same round (not started)

Recorded from the 14 in-app reports of 2026-07-30/31 (`acc_feedback_report`):

1. ~~`/reports` — spell "Aging", not "Ageing".~~ Done, see Issue #4 above.
2. `/banking` — Add account should default the ledger to a bank account, not
   Cash on hand.
3. `/reports` — add an AP Aging report alongside AR.
4. `/reports/ar-ageing` — matrix layout: customer × Current/1-30/31-60/61-90/
   Over, with row and column totals.
5. `/reports?report=balance` — chart below the numbers, multi-year and
   12-month comparison, variance columns toggleable.
6. `/reports/cash-flow` — chart below the numbers; accountant vs management view.
7. ~~`/sales-tax` — tax rates differ by state; offer a rate list.~~ Done, see
   Issue #3 above.
8. `/settings/feedback` — let a reporter attach images and PDFs.
9. `/reports`, `/fixed-assets` — separate statements per company (10+ companies).
10. `/banking/reconcile` — import a bank statement and match it automatically.
11. `/invoices` — bulk invoice import with AI field mapping.
12. `/settings` — import a QuickBooks or Wave CSV backup.

Items 9–12 are new modules rather than fixes; they need their own scoping round.
