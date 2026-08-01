# One Book — system test against user feedback

A running record of what the staff test round reported, what was tested, what was
fixed, and what was not built and why. Newest round at the top.

Environment: production database (Supabase project of `ctyhp-accounting`), app at
<https://ctyhp-accounting.vercel.app>, tester `admin@ctyhp.vn`.

---

## Open questions — see the separate sheet

Eight decisions need an answer from the reviewer or the accountant before the
work they block can be built. They are written up for a non-engineer, grouped by
who should answer, with a space for the answer, in
**[questions-for-review.md](questions-for-review.md)** — one file to hand over
rather than a section buried in this log.

**State of the queue, 2026-08-01.** Five reports still open. Two are buildable
today: bulk invoice import (`/invoices`) and the master-data half of the
QuickBooks/Wave import (`/settings`). Three are blocked: both multi-company
reports (`/fixed-assets`, `/reports`) on **Q2**, the Claude AI request on
**Q8**; the QuickBooks import needs **Q7** before its second half is scoped.

---

## Issue #5 — GL posting verification: assessed, then built

Filed as **CRITICAL / financial reporting risk HIGH**: *"Transactions in
subledgers shown but no indication of GL posting status. Financial statements
could include unposted or incorrectly posted transactions. No reconciliation
between subledger totals and GL control accounts."*

The recommendation asks for six things. Assessed one at a time against what is
actually in the database, because two of them describe a system this is not, and
building them as written would make the books **less** safe, not more.

### The architectural difference that decides most of this

The review assumes the common design: subledgers are the working records, and a
posting routine copies them into the general ledger later — so a document can
sit unposted, post wrongly, or post twice, and you need a status column and a
daily reconciliation to catch it.

**This system has no posting step to fail.** The ledger is the only record of a
number. Issuing an invoice *is* writing the journal entry — the same database
transaction does both, inside one RPC. There is no window in which a document
exists and its entry does not, and no code path that creates one without the
other. Every reported figure is derived from `acc_journal_line` at read time; no
balance is stored anywhere to drift.

Two guards enforce it below the application, where no code can get around them:

- `acc_post_entry` refuses an unbalanced entry: *"Unbalanced posting: debit X <>
  credit Y"*.
- A row-level trigger, `acc_check_entry_balanced`, re-checks every line as it
  lands — so even a direct `INSERT` cannot leave a lopsided entry behind.

### What the live books actually show (2026-08-01)

Every document that should be on the ledger, is:

| Subledger | Live documents | Without a journal entry |
|---|---:|---:|
| Invoices | 13 | **0** |
| Bills | 6 | **0** |
| Customer payments | 8 | **0** |
| Vendor payments | 4 | **0** |
| Expenses | 11 | **0** |
| Credit memos | 1 | **0** |
| Vendor credits | 1 | **0** |
| Draft invoices/bills (must **not** be posted) | 1 | 0 wrongly posted |

And the ledger itself: **95 entries** (57 posted, 38 void), **0 unbalanced**, 0
entries without lines, 0 lines without an entry.

So the stated risk — *"financial statements could include unposted or incorrectly
posted transactions"* — is not present in these books, and the structure makes it
hard to create. That does not make the report wrong. What it gets right is the
second half: **none of this is visible.** A reviewer cannot tell any of the above
from the screens, and an assurance you cannot see is not one you can rely on.

### The six recommendations, one at a time

| # | Recommendation | Assessment |
|---|---|---|
| 1 | `posting_status` column (PENDING/POSTED/REJECTED) + `posting_date` + `GL_journal_entry_id` on transaction tables | **Half already there, half should not be built.** Every document table already carries `journal_entry_id`. A PENDING/REJECTED state should *not* be added: it would invent a failure mode that cannot currently occur, and a status column can disagree with the ledger — a second version of the truth. What the review is reaching for is **visibility**, and that is worth building. |
| 2 | Create a `GL_POSTINGS` table | **Already exists, and is the source of truth.** `acc_journal_entry` + `acc_journal_line` hold exactly the proposed fields (entry, account, debit, credit, date, source document). A second postings table would be a copy that can drift. |
| 3 | Automatic posting on approval/payment — zero-touch | **Already how it works.** Posting is inside the issuing RPC, atomic with the document. There is no manual post button to forget. |
| 4 | Daily reconciliation: subledger totals vs GL control accounts | **Partly built, and scattered.** A/R and A/P reconcile to their control accounts inside the ageing reports; inventory valuation reconciles to the inventory control accounts. Three checks, three screens, and **nothing at all for sales tax payable, goods received not invoiced, or undeposited funds**. There is no one place that answers "is everything tied out today?" |
| 5 | GL posting report: every transaction with its posting status, account and entry reference | **Genuinely missing, and the most useful item on the list.** `journal_entry_id` is stored on every document and shown on none of them — the bills screen uses it as a condition and never displays it. No screen walks from a document to the entry it produced. |
| 6 | Month-end close checklist: verify zero variance before finalising | **Partly built.** Periods can be closed and closing is enforced in the database — a posting into a closed period is refused by `acc_post_entry` itself, not merely hidden in the UI. But closing checks **nothing**: an administrator can close a period while a control account is out. |

### What is worth building

In the order the value falls out:

1. **A GL posting report** (#5). Every document, its status, the entry it
   produced, that entry's date and amount, and a link to it — plus, prominently,
   any document that should have an entry and does not. Today the answer to "did
   this post, and where?" requires database access.
2. **One reconciliation screen** (#4) covering *every* control account, not the
   three that have one each today: A/R, A/P, inventory, sales tax payable, goods
   received not invoiced, undeposited funds. Subledger total, control balance,
   variance, and when it was checked. This is also what the month-end checklist
   reads.
3. **A close gate** (#6): closing a period runs those checks and refuses — or
   demands a written reason, like every other override in this system — if a
   control account is out. A checklist nobody is forced to complete is
   decoration.
4. **The entry reference on the document itself**: invoice, bill and payment
   screens showing the entry number they produced, as a link. Small, and it is
   the first thing an auditor asks for.

What will **not** be built: a `posting_status` column, and a second postings
table. Both create a record that can disagree with the ledger. The review's
underlying goal — that nobody has to take posting on trust — is met by showing
the ledger, not by copying it.

### What was built (2026-08-01)

All four, in the order agreed.

**1. The posting report** — `/reports/gl-posting`, "Documents → ledger".
Every document in a date range beside the journal entry it produced: type,
number, date, name, status, amount, the entry as a **link into the journal**,
and a verdict. A banner across the top answers the question without reading a
row. Six verdicts, each meaning something different:

| Verdict | What it means |
|---|---|
| Posted | Live document, posted entry, entry carries the document total |
| No journal entry | Live document that never reached the ledger — the serious one |
| Entry not posted | The entry exists but is not posted |
| Amount differs | The entry does not carry the document's own total |
| Not on the ledger | Draft or void, correctly absent |
| Posted in error | Draft or void that nonetheless has a posted entry |

An entry **larger** than its document is not an exception: tax, splits and
multi-line postings ride on the same entry. Only a shortfall is.

**2. The control account screen** — same page, "Control accounts". Six
accounts, each with the subledger total, the ledger balance, and the variance:

| Control account | Subledger it is checked against |
|---|---|
| Accounts Receivable | Open invoices less unapplied credit memos |
| Accounts Payable | Open bills less unapplied vendor credits |
| Inventory | Quantity on hand at weighted average cost |
| Goods Received Not Invoiced | Received on a purchase order, not yet billed |
| Sales Tax Payable | Tax charged on live documents, less tax remitted |
| Undeposited Funds | *No subledger* — see below |

Undeposited Funds has nothing feeding it. Rather than invent a total so the row
could show a comforting zero variance, it reports the ledger balance and says
there is no subledger: anything sitting there arrived by manual journal and
deserves an explanation. A fake tie-out is worse than an honest gap.

**3. The close gate** — `acc_close_period` now runs that reconciliation at the
period's own end date and **refuses to close** over a variance. Refusal alone
would be a wall rather than a control, so there is an override: it demands the
difference be written down, stores that on the period, and records it in the
period event and the audit log. A month closed over a known variance says so
forever. The screen asks the database *before* the button is pressed, so the
person sees the problem instead of hitting a refusal.

**4. The entry number on the document** — the invoice and bill lists now carry
a **Journal entry** column that links straight into the journal. `journal_entry_id`
was stored on every document and displayed on none; it is the first thing an
auditor asks for.

### Evidence

| Gate | Result |
|---|---|
| `npm test` | 59 files, 588 tests passed (23 new for the posting and control rules) |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 51 of 51 pages rendered |
| `tests/e2e/gl-posting.e2e.ts` (new, HTTPS, live DB) | 4 passed |
| Migrations 0073, 0074 | applied to production |

The end-to-end test is the standing proof, and it asserts more than the screen
shows. Beyond "no document is missing its entry" and "every control account
ties out", it checks the A/R and A/P control balances against the **ageing
reports**, which compute the same figures by a different route. Two
implementations agreeing is worth more than one implementation asserting.

Against the live books today, every control account ties **to the cent**:

| Control account | Subledger | Ledger | Variance |
|---|---:|---:|---:|
| Accounts Receivable [1100] | 8,591.00 | 8,591.00 | 0.00 |
| Accounts Payable [2000] | 15,865.00 | 15,865.00 | 0.00 |
| Inventory [1200] | 19,765.00 | 19,765.00 | 0.00 |
| Goods Received Not Invoiced [2150] | 800.00 | 800.00 | 0.00 |
| Sales Tax Payable [2100, 2110] | 3,266.66 | 3,266.66 | 0.00 |
| Undeposited Funds [1210] | (none) | 0.00 | 0.00 |

46 documents, 45 posted, 1 correctly unposted (a draft bill), 0 exceptions.

One thing that table shows in passing: **Sales Tax Payable resolves to two
accounts, 2100 and 2110** — a tax code points at `2110 Sales Tax Receivable`,
which is an asset. The two net correctly today so nothing is misstated, but it
is the same chart-of-accounts untidiness noted below, now visible in a report.

### Not implemented, and why

| Recommendation | Decision |
|---|---|
| `posting_status` column (PENDING/POSTED/REJECTED) | **No.** It would invent a failure mode that cannot occur here and create a second record that can disagree with the ledger. The report reads the ledger directly instead. |
| A separate `GL_POSTINGS` table | **No.** `acc_journal_entry` + `acc_journal_line` already are it, and are the source of truth. A copy can drift. |
| A scheduled *daily* reconciliation job | **Not built.** The check runs on demand and at every period close, which is when it matters. A nightly job that emails a green tick trains people to ignore it; a close that will not proceed does not. |

### Two things the review did not mention, found while assessing

- **`1590 Accumulated Depreciation` is typed as a fixed asset, so the chart of
  accounts prints its normal balance as *Debit*.** It is a contra-asset and
  carries a *credit* balance. The balance sheet total is unaffected — assets are
  summed as debits minus credits either way — but the label is wrong to anyone
  who reads it, and there is no contra-account concept in the system to type it
  correctly. The account is at zero today, so nothing is misstated **yet**; the
  first depreciation run is when it starts to read oddly.
- **`2110 Sales Tax Receivable` is a current asset numbered in the 2000
  liability block.** Nothing computes wrongly; it breaks the convention the rest
  of the chart follows, and an accountant scanning the 2000s expects
  liabilities.

Both are small and neither is the reported issue. Flagged rather than silently
fixed: renumbering an account in a live chart is not a decision to take alone.

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
test sweeps. Numbers **7, 8, 15, 16, 17, 18, 19 and 20 were unexplained** — they
disappeared before any of this existed and nothing recorded why. They were what
the banner and the report showed, which was the point: the product no longer
hides them.

**Closed on 2026-08-01.** The reviewer confirmed those eight were test data from
the pre-launch trial round — no real invoice ever held them. Each now carries a
note saying so, written through `acc_record_number_gap_note` as the
administrator, so the note is attributed and audited like any other governance
act. The live sequence reads: 45 allocated, 13 present, 32 missing, **32
explained, 0 unexplained.** The banner is clear.

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

### Issue #5 — The floating help buttons cover the numbers

Raised directly by the tester with a screenshot: Report, Ask AI and Guide float
over the bottom-right corner of every page, which is exactly where a list puts
its last rows, its record count and its pager. In the screenshot they sit on
top of "12 records" and the page selector.

#### What was implemented

- **A collapse handle.** A small chevron above the cluster hides it down to one
  round button; that button brings it back. The handle is faint until the
  pointer is over the cluster or it takes keyboard focus, so it does not become
  a fourth thing competing for attention.
- **The choice sticks.** It is stored in `localStorage` and read through
  `useSyncExternalStore`, so a collapsed cluster stays collapsed across
  navigation, reloads and other tabs. A toggle that reset on every page change
  would not have solved anything. The server renders it expanded and React
  swaps in the stored state on hydration — no mismatch.
- **Room to scroll past it.** The page content now reserves 96px at the bottom,
  so even expanded the cluster no longer overlaps the last row, the totals or
  the pager; they scroll clear of it.
- `tests/unit/launcher-preferences.test.ts`: 5 tests, including the two cases
  that would otherwise bite — no `window` on the server, and a browser where
  `localStorage` throws (private mode), where the launcher must still work and
  simply forget.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 49 files, 429 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 48 of 48 pages rendered, in 16s on the built server |

#### Not implemented, and why

| Idea | Decision |
|---|---|
| Hide the cluster automatically while scrolling | **Not built.** A control that disappears on its own is harder to trust than one the user closed on purpose, and it would fight the collapse the user already chose. |
| Let each page decide where the cluster sits | **Not built.** Help that moves between screens is help nobody can find. One position, one collapse. |

### Issue #6 — No customer credit status before invoicing

Reported severity: CRITICAL, credit risk HIGH. References: NFCC credit policy
guidance, AICPA CECL.

#### What reproduced, and what did not

**"All 12 customers show 'Not set' for billing address" — no longer true.** The
columns existed (migration 0060); the records were simply empty when the review
was written. All twelve were filled in on 2026-07-31 between 10:41 and 10:46
(the audit log dates the edits), and a page fetched from a built server as
`admin@ctyhp.vn` now contains real street addresses and zero occurrences of
"Not set". The blank strips in the screenshot were the width of the Billing
address column when every value in it was the short "Not set" tag.

**Everything about credit did reproduce.** A search of the codebase found no
`credit_limit`, no credit terms, no hold, no exposure, and no DSO anywhere. The
invoice screen showed nothing about the customer beyond their name, and nothing
stopped an invoice of any size.

#### What was implemented

**Database — `0069_customer_credit_control.sql` (applied to production 2026-07-31)**

- `acc_customer` gains `credit_limit_minor`, `credit_terms_days`, `credit_hold`,
  `credit_reviewed_at`, `credit_review_note`. A null limit means none is
  enforced; **0 means cash only**, and the two are kept distinct end to end.
- Permission `credit.override`, seeded to administrators only — the point of a
  limit is that the person raising the invoice cannot wave it through.
- `acc_customer_credit_status(as_of, window_days)`: per customer, the open
  balance, what is past due, the oldest due date, and what was invoiced over
  the window — all read from the invoices at call time.
- **The control itself is inside `acc_issue_invoice`**: an invoice that puts the
  customer past their limit, or any invoice for an account on hold, is refused
  unless the caller holds `credit.override` *and* gives a written reason. The
  reason is written to `acc_audit_log` as its own `credit_override` action with
  the limit, the balance and the invoice total it was decided on. A reason
  supplied where none is needed is also refused, so an override always means
  something.

**Application**

- `lib/domain/credit.ts` (new, pure) + 19 unit tests: limit states (hold, over,
  near at 80%, within, none set), what an invoice would do to the account, and
  days sales outstanding.
- Customers screen: credit limit, owed now, available and a colour-coded status
  per row; limit, terms, hold and a review note in the edit dialog.
- Invoice dialog: a credit panel the moment a customer is chosen — status, owed
  now, limit, the balance *after* this invoice, headroom left, DSO — colour-coded,
  and it recalculates as lines are typed. Issuing a blocked invoice opens an
  override dialog that demands a reason; a user without the permission is told
  what stands in the way instead.
- **Reports → Customer Credit Exposure**: owed, past due, over-limit exposure,
  accounts on hold and portfolio DSO across the top; a "needs attention" list
  first; CSV export. This is the A/R credit dashboard the review asked for.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 50 files, 448 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 49 of 49 pages rendered |
| `tests/e2e/customer-credit.e2e.ts` (new, HTTPS, live DB) | passed |

The end-to-end test proves the control on the real database: with a $100 limit,
invoices of $40 and $30 issue normally; a reason offered where none is needed is
refused; the $100 invoice that would take the balance to $170 is refused even
for an administrator until a reason is given; with the reason it issues and the
`credit_override` entry in the audit log carries the limit, the $70 balance and
the $100 total; the exposure then reads as $170 owed, $70 over; and once the
account is put on hold even a $1 invoice is refused.

#### Not implemented, and why

| Recommendation | Decision |
|---|---|
| A `CUSTOMER_CREDIT_STATUS` table holding `current_balance` and `available_credit` | **Deliberately not stored.** Both follow from the open invoices; a stored copy is a second number that can disagree with the ledger, and the project's rule is that the ledger is the single source of truth. They are computed on read, in one place, by rules that have unit tests. Everything the recommendation asks to see is on screen — none of it is a saved balance. |
| `last_review_date` as part of that table | **On the customer instead** (`credit_reviewed_at`, set whenever the credit terms are saved, with a free-text `credit_review_note`). |
| Manager approval for an override | **As a permission, not a workflow.** `credit.override` is held by administrators only, and using it demands a written reason that is audited. Routing it through the existing maker-checker approval queue would stop the invoice until someone signs in — worth doing if the business wants it, but it is a different control from the one asked for. |
| Blocking an invoice for a customer with no billing address | **Warning only**, as agreed. A missing address makes a poor-looking invoice, not a wrong entry. |
| Shipping address as a separate field | **Not added.** Nothing in the product ships goods to an address yet; adding a field no screen reads would be a place for stale data to live. |

### Issue #7 — A report could not carry the file that proves it

From the in-app queue (`/settings/feedback`, 2026-07-30 14:26): "Các suggestion
và issues trong report a problem, phải cho người sử dụng bổ sung thêm
attachment, hình ảnh, PDF, v.v."

The dialog captured a screenshot of the page — what the *reporter* was looking
at. It could not carry the vendor's PDF that disagrees with the bill, a photo of
a printed invoice, or the spreadsheet the numbers came from, which is usually
what makes a report actionable.

#### What was implemented

**Database — `0070_feedback_attachments.sql` (applied to production 2026-07-31)**

- `acc_feedback_attachment`: one row per file, with its storage path, name,
  type and size. Insert is allowed only onto a report the caller filed; reading
  needs `feedback.read` or ownership of the report. **No update or delete
  policy** — the same evidence rule the report itself follows: what a report
  shows cannot change after filing. Audited by the 0058 trigger.
- Private bucket `feedback-attachments`, 10 MB a file, limited to images, PDF,
  CSV, plain text and xlsx. The path must be `<report id>/<uuid>.<ext>` **and
  the report must belong to the caller**, so a file can never be planted on
  someone else's report.

**Application**

- `lib/domain/feedback-attachment.ts` (new, pure) + 17 unit tests: the accepted
  types, the 10 MB and five-file limits, human-readable sizes, and the storage
  path shape.
- Report a problem: an "Add a file" picker holding up to five files, each shown
  with its size and removable before sending; the same rules run in the dialog,
  again in the server action, and again in the bucket.
- Files go **from the browser straight to storage**, not through the server
  action: a Next server action carries a 1 MB body by default and an attachment
  may be ten times that. The action records the paths afterwards.
- Feedback triage: an Attachments column with a short-lived signed link per
  file, beside the existing screenshot link.
- An upload that fails costs its file, not the report — the words are worth
  more than the attachment, and the reporter is told which files did not make
  it.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 51 files, 465 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 49 of 49 pages rendered |
| `tests/e2e/feedback-attachment.e2e.ts` (new, HTTPS, live DB) | passed |

The end-to-end test files a report on the live project, uploads a PDF to it,
reads it back through a signed link (HTTP 200), and then proves the three
refusals: a path under a report that does not exist, a `text/javascript` file,
and a client trying to delete an attachment row it filed.

#### Not implemented, and why

| Idea | Decision |
|---|---|
| Virus scanning the uploads | **Not here.** The product already has a scanning pipeline for accounting documents (migrations 0056–0057). Feedback attachments are read only by staff with `feedback.read`, through short-lived signed links, and never executed; wiring the scanner in is worth doing, but it is its own change with its own failure modes. |
| Letting a reviewer add files to someone else's report | **Refused by design.** An attachment is part of what the reporter is saying. A reviewer's evidence belongs in the triage note or in a new report. |
| Removing an attachment after filing | **Not possible, deliberately.** Same rule as the report text and the screenshot: filed is filed. |

### Issue #8 — Payment status and the history behind it

Reported severity: CRITICAL, cash-flow impact HIGH.

#### What reproduced, and what did not

Most of the recommendation was already in place, and the report's own screenshot
shows it: the invoice list has a **Status** column (Draft / Issued / Partially
paid / Paid) and a **Balance due** column; `acc_payment_allocation` is the
payment-to-invoice link table; `acc_record_payment` updates the invoice's status
and balance in the same transaction as the ledger entry; and the AR aging report
with Current / 1–30 / 31–60 / 61–90 / 90+ buckets reconciles to the Accounts
Receivable control account. So "cannot determine which invoices are paid" did
not reproduce.

Four things genuinely did:

1. **No payment history on the document.** You could see $401.05 outstanding but
   not how many payments made up the rest, on what dates, by what method. The
   data sat in three tables — payments, credit memo applications, write-offs —
   that no screen joined.
2. **No payment reference.** `method` said "check"; nothing recorded *which*
   check, which is what a bank statement is reconciled by.
3. **No days outstanding** on an invoice row.
4. **No cash flow forecast.** The Cash Flow report is historical. Nothing
   projected receipts from due dates, and nothing knew how late customers
   actually pay.

#### What was implemented

**Database — `0071_settlement_history_and_forecast.sql` (applied to production 2026-07-31)**

- `reference` on `acc_payment` and `acc_bill_payment` — the check number, wire
  reference or ACH trace — and both recording RPCs (`acc_record_payment`,
  `acc_pay_bills`) redefined to carry it.
- `acc_invoice_settlements(invoice_id)` and `acc_bill_settlements(bill_id)`:
  every payment, credit applied and write-off against one document, oldest
  first, with voided documents left out.
- `acc_open_items(as_of)` and `acc_settlement_lag(since)`: what is still open by
  due date, and how late settled documents actually were. Raw rows — the
  projection is computed in the application, where it is unit tested.

**Application**

- `lib/domain/settlement.ts` (11 tests) — the running balance of a document, and
  the age/overdue arithmetic — and `lib/domain/forecast.ts` (14 tests) — weekly
  buckets, median collection lag, cumulative position.
- Invoice dialog: **Payments & settlements** — date, type, number, method,
  reference, amount, and the balance after each. It states plainly if the
  settlements do not add up to the invoice's own balance rather than papering
  over the difference.
- Bills screen: the same history behind a **Payments** action, covering vendor
  credits and write-offs as well as payments.
- Invoice list: a **Paid** column and an **Age** column reading "N d overdue" or
  "N d old".
- Both payment forms take a **Reference**, shown on the payments list and in the
  history.
- **Reports → Cash Flow Forecast**: 13 weeks of expected receipts and payments
  from open invoices and bills, on two bases — the dates the documents say, and
  those dates shifted by the median lag actually observed. Overdue money is
  expected in the current week, never in the past; money expected past the
  horizon is reported separately instead of being crammed into the last week.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 53 files, 490 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 50 of 50 pages rendered |
| `npm run test:e2e:document-ledger-report` | 12 files, 16 tests passed |

The new end-to-end test invoices $1,000, takes a $400 transfer and a $250 check
carrying `CHK-10428`, and proves the history reads back both payments with the
reference intact, that the running balance ends at the $350 the ledger holds,
and that every open receivable lands somewhere in the projection.

The test also exposed a gap in the cleanup: a customer payment has no void path
in the application (a received payment is refunded, not un-received) and an
invoice with payments applied cannot be voided, so the sweep now unwinds a test
payment with the service role — returning the allocation to the invoice before
removing the payment — instead of leaving an invoice nothing could clear.

#### Not implemented, and why

| Recommendation | Decision |
|---|---|
| `amount_paid` and `payment_date` columns on INVOICES | **Deliberately not added.** Both follow from the allocations; a stored copy is a second number that can disagree with the ledger. `balance_due_minor` stays because the posting RPC maintains it atomically with the journal entry and the end-to-end gate proves it matches. |
| A new `INVOICE_PAYMENTS` table | **Already exists** as `acc_payment_allocation`, and two more tables settle an invoice besides payments. The new RPC joins all three rather than adding a fourth. |
| Forecasting from "historical collection patterns" per customer | **Portfolio-wide for now.** The median lag is computed across all settled documents, not per customer: with a dozen customers and a handful of settled invoices each, a per-customer median would be a number computed from two data points and read as if it meant something. |

### Issue #9 — Bank setup offered Cash on Hand as the ledger account

Reported as Finding 12: adding a bank account offered "1000 — Cash on Hand" as
the General Ledger account, which risks classifying a bank balance as physical
cash on the balance sheet.

#### What the cause actually was

The seeded chart types **both** `1000 Cash on Hand` and `1010 Operating Bank
Account` as `account_type = 'bank'`. That is correct and is what QuickBooks
does — "Bank" is the type that carries checking, savings, money market *and*
cash on hand, and all of them belong to Cash and cash equivalents. The balance
sheet was never misclassified.

What was missing is the **detail under the type**. `acc_account.detail_type`
existed but was null on every account and no screen used it, so the bank setup
picker offered every Bank-type account and Cash on Hand — the lowest code —
came first in the list. Nothing stopped a bank feed or an imported statement
being attached to the petty cash tin.

#### What was implemented

**Database — `0072_bank_account_detail_types.sql` (applied to production 2026-07-31)**

- A check constraint fixing the classifications a Bank-type account may carry:
  checking, savings, money market, cash on hand, other bank. Null stays legal —
  an account written before this is unclassified, not assumed to be checking.
- Backfill from what the account's own name settles: `1000 Cash on Hand` →
  cash on hand, `1010 Operating Bank Account` → checking. Nothing else is
  guessed at.
- `acc_bank_account_ledger_guard`: attaching a bank account to a cash-on-hand
  ledger, or to an account that is not Bank-type at all, is refused by the
  database — not only by the screen.

**Application**

- `lib/domain/bank-account-detail.ts` (new, pure) + 14 unit tests: the
  classifications, which of them can hold a statement, which ledger accounts a
  bank account may attach to, and what to suggest.
- Banking → Add bank account now asks **what kind of account this is** first
  (checking, savings, money market, other — cash on hand is not offered), then
  offers only ledger accounts of that kind plus any unclassified ones, and
  preselects the match when exactly one exists. Two candidates are left to the
  person; guessing between them is not a suggestion.
- Choosing a kind **classifies an unclassified ledger account** as a side
  effect of using it, so an older chart classifies itself as it is used. An
  account that already says what it is is never overwritten here.
- Chart of Accounts shows a **Detail** column for bank accounts and requires
  the classification when creating or editing one.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 54 files, 504 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 50 of 50 pages rendered |
| `tests/e2e/bank-account-ledger.e2e.ts` (new, HTTPS, live DB) | 2 tests passed |

The end-to-end test proves the refusals on the live database: attaching a bank
account to the cash-on-hand ledger fails with "physical cash, not a bank
balance" and creates nothing, and an expense account is refused as "must be
linked to a Bank-type ledger account".

#### Not implemented, and why

| Idea | Decision |
|---|---|
| Creating the ledger account from inside the bank dialog | **Not built.** A new account in the chart is a deliberate act with a code, a parent and a statement position; making it a side effect of connecting a bank is how charts fill up with near-duplicate accounts. The dialog says what is missing and Chart of Accounts is one click away. |
| Reclassifying `1000 Cash on Hand` out of the Bank type | **Left as it is.** It is the correct type — the same one QuickBooks uses for a cash-on-hand account — and every report that groups cash already treats them together. The problem was never the type; it was the missing detail under it. |
| Guessing a classification for accounts whose name says nothing | **Left null.** "Unclassified" is visible in the chart and still usable in the bank dialog. Writing a guess into the ledger is how a balance sheet ends up quietly wrong. |

### Issue #10 — The twelve customer records were incomplete

Raised directly: the customer data is missing pieces, and the test data has to
be defensible as bookkeeping.

#### What was missing

- **No credit terms at all.** Every one of the twelve had a null credit limit
  and null terms, so the credit control shipped the same day enforced nothing
  and the exposure report opened with "12 of 12 customers have no credit limit
  set".
- **The state was a name, not a code.** `region` held "Texas", "Illinois",
  "California". An American invoice prints `Houston, TX 77006`, and the
  destination-based tax default matches on the two-letter code — so with
  "Texas" in the field it could never fire.

#### What was done

**`scripts/seed-customer-credit.ts` (new, run against production 2026-07-31)**

- Signs in as a real user rather than using the service role, so the audit log
  names who set each limit. Idempotent: it only writes a field that is empty or
  in the wrong form, so a limit an accountant changes later is never
  overwritten. `--dry-run` prints what it would do.
- **Limits from trading history, not from thin air.** The rule lives in
  `lib/domain/credit.ts` as `suggestCreditLimitMinor` with unit tests, and the
  script imports it — Node runs the TypeScript directly, so there is no second
  copy of the arithmetic. Twice the largest invoice, at least a quarter above
  what is currently owed, floor $1,000, rounded up to the nearest $500: enough
  to cover a repeat order of the biggest thing they have bought while the last
  one is still unpaid.
- **Terms by how the account trades**, named explicitly rather than guessed
  from the customer's name: the four trade accounts (Grand Avenue Jewelers,
  Maison Luxe Boutique, North Star Bridal, Acme Studio) net 30, the eight
  retail buyers net 15. A private buyer carrying a piece for a month is a
  collections problem, not a credit facility.
- Each record keeps a **review note** stating the basis — invoice count,
  largest invoice, balance at review, terms — and the review date.
- **States normalised to USPS codes** from `acc_us_state`: TX, IL, AZ, CA, NY,
  MN, FL, OR, GA, WA.

Result on the live data:

| Customer | State | Limit | Terms | Basis (largest invoice) |
|---|---|---|---|---|
| North Star Bridal | MN | $35,000 | net 30 | $17,320.00 |
| Maison Luxe Boutique | NY | $21,000 | net 30 | $10,337.88 |
| Grand Avenue Jewelers | CA | $12,500 | net 30 | $6,191.90 |
| Sophia Reynolds | FL | $6,000 | net 15 | $2,906.51 |
| Sophia Bennett | GA | $5,500 | net 15 | $2,744.14 |
| Elena Brooks / Liam Anderson | IL / TX | $4,000 | net 15 | $1,759.07 / $1,786.13 |
| Daniel Carter | TX | $3,500 | net 15 | $1,667.05 |
| Emma Rodriguez | AZ | $3,000 | net 15 | $1,385.60 |
| Olivia Thompson | FL | $2,500 | net 15 | $1,093.33 |
| Michael Chen | WA | $2,000 | net 15 | $801.05 |
| Acme Studio | OR | $1,000 | net 30 | $162.38 (floor) |

Every limit clears the customer's current balance, so nobody was pushed over a
limit by the act of setting one — the exposure report reads twelve accounts
within limit, which is what the ledger actually says.

**So the data means something in use**

- The customer dialog's State field is now a **picker of the 52 states**, so
  "Texas" cannot come back through the front door.
- Selecting a customer on a new invoice now **sets the due date from their
  terms** (issue date + net 15 or net 30, falling back to the company default),
  alongside the destination tax rate it already suggested. Terms that no
  document uses are decoration.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 54 files, 509 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 50 of 50 pages rendered |
| Live check | Customer Credit Exposure no longer warns about unset limits; every customer reads "Within limit" with a DSO |

#### Not done, and why

| Idea | Decision |
|---|---|
| Putting a customer on credit hold for a livelier test set | **No.** A hold blocks invoicing for a customer who has done nothing to earn it. Test data that lies about an account is worse than test data that is quiet. |
| Seeding state sales tax rates now that customers carry state codes | **Still no.** Same reason as Issue #3: a rate this product invented would be wrong somewhere and trusted anyway. The destination default will start working the day real rates are entered. |
| Backdating the review to look like an established policy | **No.** The review date is today, because today is when it was reviewed. |

### Issue #11 — Balance Sheet Comparison: chart position, comparison period, variance

From the in-app queue (`/reports?report=balance`, 2026-07-30 20:19): "I would
suggest that the graph move to the bottom part. second that the report must
have multiple year comparison not just months, or can we add another filter to
have 12 months comparison. remove the variances we can get that or can we have
turn on/off button for the variance report. Overall this report is good."

#### What the screenshot showed

The attached screenshot settles what the words leave open. The chart panel took
the **left half** of the report and the numbers were squeezed into the right
half — so the Variance column was cut off at the edge and needed a horizontal
scroll to read. The comparison was fixed to the prior month end (2026-05-31
beside 2026-06-30) with no way to ask for anything else.

#### What was implemented

- **The numbers come first.** The comparison table now runs full width with the
  chart underneath it, on both the Balance Sheet and the Profit & Loss
  comparison. Nothing is cut off any more.
- **Comparison period is a choice**: prior month end, prior quarter end, prior
  year end, or the same date last year.
- **Multi-period columns**: "Last 12 months" gives twelve month-end columns,
  "Last 3 years" gives two year ends plus the current position. Accounts run
  down the side, periods across the top, with a bar per period underneath.
- **Variance is a switch, off by default** — the reviewer can subtract two
  columns and said so. Turning it on brings back both the Variance and
  Variance % columns.
- `lib/domain/report-periods.ts` (new, pure) + 18 unit tests covering the date
  arithmetic that always breaks — the prior month end of 31 March is 28
  February, the prior quarter of a January date is last December, 29 February
  a year earlier is 28 February — and the multi-period table, including that an
  account which cleared mid-window still gets a row of zeros rather than
  disappearing.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 55 files, 527 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 50 of 50 pages rendered |
| Rendered check | `/reports?report=balance` returns the totals **before** the chart in the HTML, with the period picker and the variance switch present |

A first smoke run failed eight untouched pages with "the client reference
manifest for route … does not exist". That is a stale `.next` from building over
a directory a running server still held, not a defect: a clean rebuild passed
50 of 50. Written into `CLAUDE.md` so the next person does not go hunting.

#### Not implemented, and why

| Idea | Decision |
|---|---|
| Removing the variance columns outright | **Made a switch instead.** The reviewer offered both; a toggle costs nothing and the next reader may want them. Default off, which is what they asked for first. |
| Variance columns in the 12-month view | **No.** Variance against which of twelve columns? A trend is read across, not against a single base. |
| A per-account line chart across the 12 periods | **Not built.** The bar under the table is total assets per period, which is the shape of the business. Twelve series of account balances is a chart nobody reads. |

### Issue #12 — "Could we add an Accounts Payable Aging report?"

From the in-app queue (`/reports`, 2026-07-31 00:39): "Could we add additional
report? Accounts Payable Aging Report? this report will show which vendor are
due and over due. same like AR."

#### What the screenshot showed

**The report already existed.** The screenshot is the Report Center sitting on
the *Business Overview* tab, which shows five of the nineteen reports; AP Aging
was one click away under *Payables*. Two things hid it:

1. It was called "Accounts Payable **Ageing**" at the time, so searching the
   report list for "aging" found nothing. Fixed in Issue #4.
2. The hub opened on a single category. Fourteen reports were behind tabs
   nobody had a reason to click.

But the sentence after the question is a real gap: "this report will show which
vendor are due and over due". The report listed **documents** — one row per
bill, with its bucket. It never said what *Gemstone Partners* owes in total or
how much of that is late. Answering that meant adding rows up by hand.

#### What was implemented

- **By vendor, and by customer.** Both aging reports now open on a party view:
  one row per vendor or customer, a column per bucket (Current, 1–30, 31–60,
  61–90, 90+), an **Overdue** column, a row total, and a totals row along the
  bottom. Rows are ordered by overdue money first — the accounts that need a
  call, in the order they need it. The document list is still there behind a
  toggle. This is also what the AR reviewer asked for in the same round.
- Each party with anything late is tagged with its **oldest due date**, so the
  worst item on the account is visible without opening it.
- `pivotAgingByParty` in `lib/domain/aging.ts` + 9 unit tests, including the
  cases that matter: a credit on account stays negative rather than being
  dropped, two parties with the same name stay apart, and a party with nothing
  late reports no oldest date.
- **Report Center opens on "All reports (19)"**, with the categories still
  there as tabs. A report nobody can find is a report that gets asked for
  again.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 56 files, 536 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 50 of 50 pages rendered |
| `tests/e2e/aging-by-party.e2e.ts` (new, HTTPS, live DB) | passed |
| Rendered check | `/reports` lists all 19 reports including Accounts Payable Aging on the default tab |

The end-to-end test runs both aging reports against the live ledger and checks
the rollup: the party totals equal the report total, every bucket column equals
the report's own bucket, overdue equals everything outside Current, and any
party with overdue money has an oldest due date in the past.

#### Not implemented, and why

| Idea | Decision |
|---|---|
| A separate new "AP Aging" report | **There was nothing to add.** Building a second one would have left two reports with the same name and different numbers. |
| Statement-style vendor detail inside the party view | **Not built.** The document list already gives it, and Vendor Statements is a report of its own. |

### Issue #13 — The customers table did not fit on the screen

From the in-app queue (`/customers`, 2026-08-01 07:36): "i need this table to
see in glance. rather than moving horizontally. make necessary changes here".

#### What the screenshot showed

Two things, and the second is the one that mattered.

1. The table was cut off after **Owed now** — Available, Credit status, Status
   and Actions were all behind a horizontal scrollbar. The **Billing address**
   column was the culprit: a full one-line address ("1250 Westheimer Road ·
   Suite 420 · Houston, TX 77006 · United States") took roughly a third of the
   table on its own.
2. The reporter's viewport was **2160px wide**, and the page was using 1280 of
   them. `.app-shell__content-inner` capped every page at 1280px, so on a wide
   monitor **the table scrolled sideways while 40% of the screen sat empty**.

#### What was implemented

- **The page uses the monitor**: the content cap is now 1680px. Prose does not
  stretch with it — the page description caps itself at 760px and forms live in
  modals — so only the tables gained the room.
- **Customers reads in eight columns instead of nine**: the name and email
  share one cell, and the address column became **Location** (`Houston, TX`)
  with the full address in a tooltip. Nobody scans a table by street address;
  they scan it by who and how much.
- **Invoices**, the other table that had grown past the screen, keeps its
  Created column to a date, with the author and the edit history in the tooltip
  (both are already spelled out in the invoice dialog).

Together the customers table now needs about 850px plus the name column, so it
fits without scrolling even on a 1280px laptop.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 56 files, 536 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 50 of 50 pages rendered |
| Rendered check | `/customers` shows Customer, Location, Credit limit, Owed now, Available and Credit status; "Billing address" is gone and the city reads `Houston, TX` with the full address in the tooltip |

#### Not implemented, and why

| Idea | Decision |
|---|---|
| A user-configurable column picker | **Not built.** It is the right answer for a table nobody agrees on, but it is a feature with its own storage and defaults. The eight columns here are the ones the screen is for; if the next round still wants columns hidden, that is the time to build it. |
| Removing the address from the list entirely | **No.** "No address" still needs to be visible — an invoice for a customer without one prints with no Bill to block. It is now a short cell that says the city, or an orange tag when there is nothing. |
| Making every table full-bleed | **No.** 1680px keeps a readable measure for the report and settings pages that are mostly text; unlimited width would make those worse to read, not better. |

### Issue #14 — "More than 10 companies, each with its own financial statements"

From the in-app queue (`/reports`, 2026-07-31 01:05, and the same point again on
`/fixed-assets`): "There would be more than 10 companies I need to have clear
financial statement of the companies each not mixed FS."

#### What the code says today

This is not a defect to fix. **One Book is single-entity by construction**, and
the evidence is unambiguous:

- No `company_id` column exists anywhere: 72 migrations, 65 tables, zero hits.
- `acc_company_setting_version` is *settings*, not a tenant — one legal name,
  fiscal year and accounting basis, versioned over time. The live database
  holds one: Aurora Fine Jewelry LLC.
- Every statement reads `acc_journal_line` with no entity dimension, and the
  120 RLS policies scope by *role*, never by company.

So if a second company's invoices were entered here today, **every report would
mix them silently**. The reviewer's fear is exactly right; the product simply
does not have the concept yet.

#### What was done now

Two honest changes that are right whichever way the architecture goes, and one
that was deliberately not made.

- **Every statement names its entity.** The Trial Balance, Profit & Loss,
  Balance Sheet and the balance sheet trend now print "Aurora Fine Jewelry LLC"
  above the title on screen, as the exports already did. A statement that does
  not say whose books it is gets filed against the wrong company.
- **Settings → Company states the scope**: "This workspace holds one company's
  books — a second company needs its own workspace, so its statements can never
  mix with these."
- **No company filter was added.** A dropdown that filters reports while the
  ledger stays shared is worse than nothing: it looks like separation and is
  not, and the first path that forgets the filter mixes two companies' numbers
  in a signed statement.

#### The decision that has to be made

| | A. A workspace per company | B. Multi-tenant in one database |
|---|---|---|
| What it is | One Supabase project + one deployment per company, as today's is | `acc_company`, a `company_id` on every table, RLS by company membership, a company switcher |
| Separation | Absolute — different databases cannot mix | By policy — correct only if every one of ~153 SECURITY DEFINER functions and 120 policies is company-scoped, and stays that way |
| Effort | Hours per company, mostly configuration | Weeks: a retrofit of every table, every RPC, every sequence, every period lock, plus a data migration of the existing books |
| Consolidated reporting | Not possible without a separate roll-up | Natural once it exists |
| Users | Invited per workspace | One account, many companies |
| Risk to the books that exist | None | Real: the retrofit touches every posting path |

**Recommendation: A now, B only if consolidation is actually needed.** Ten
companies that never consolidate are ten sets of books, and ten workspaces give
that with no chance of leakage and no rewrite. B earns its cost when somebody
needs a group balance sheet, one login across all ten, or shared master data —
none of which has been asked for yet.

If B is chosen, the order of work is: `acc_company` and membership → `company_id`
on the ledger and every document table, backfilled to the existing company →
company scoping inside every RPC → RLS by membership → per-company sequences,
periods and settings → the switcher → a consolidation report. Each step is a
migration and an end-to-end test; none of it should be attempted in one pass.

**This is the one item in the round that cannot be answered by writing code
today.** It needs the business decision first.

### Issue #15 — An accountant's view and a management view

From the in-app queue (`/reports/cash-flow`, 2026-07-30 20:22): "Same thing
here, I want the Graphs at the bottom part. We need to see the numbers not the
graphs, or if the management want the graph report. Create me a different
interface as an accountant. You can create a toggle button for accountant user
or management user".

#### How this was read

Two requests, and the second is the interesting one. Moving the chart down is a
layout fix — the same one made to the balance sheet in Issue #11. But the
reviewer then says why: **an accountant and a manager open the same statement
for opposite reasons.** One reads figures and ties them out; the other wants
the shape of the month. Neither is wrong, so the reader says which they are —
once — and every report remembers.

#### What was implemented

- **A view toggle, Accountant / Management**, in the chrome above every report
  and in the filter bar of the internal statements. The choice is stored per
  browser and followed across every report and every tab, so a bookkeeper sets
  it once and never scrolls past a chart again.
- **Accountant (the default)**: figures first, chart underneath. This is an
  accounting product; the numbers are the report.
- **Management**: the chart leads, the figures sit below it.
- Applied to the **Statement of Cash Flows** (the report in question, where the
  tie-out line now sits with the numbers rather than after the chart),
  **Balance Sheet Comparison**, **Balance Sheet Trend**, **Profit & Loss
  Comparison**, and both **aging** reports.
- One implementation of the ordering (`ReportBody`), so no report can drift
  into its own idea of it.
- `lib/client/report-audience.ts` + 6 unit tests, including the two that bite:
  a browser where `localStorage` throws, and a stored value that is neither of
  the two — treated as the default rather than trusted.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 57 files, 542 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 50 of 50 pages rendered |
| Rendered check | the toggle is present on `/reports/cash-flow`, `/reports?report=balance` and `/reports/ap-aging` |

#### Not implemented, and why

| Idea | Decision |
|---|---|
| Tying the view to the user's role instead of a toggle | **No.** The roles in this product are about permission, not preference — an administrator is often the bookkeeper. Making the layout follow the role would give the wrong view to the person who does the work. |
| A separate "management dashboard" of charts | **Not built.** There is already a Dashboard, and the request was about these reports. Two places showing the same numbers differently is how they start disagreeing. |
| Hiding the charts entirely in accountant view | **They move, they do not vanish.** The reviewer asked for the graphs at the bottom, not for their removal, and the same person often wants both — in that order. |

### Issue #16 — The aging report, in the layout an accountant prints

From the in-app queue (`/reports/ar-ageing`, 2026-07-30 20:15): "Header will be
the company name, there would be 7 rows, 1st row Customer Name, 2nd Row
current 3rd row 1-30days, 4th row 31-60 days, 5th 61-90 days, 6th row over days
and 7th row would be total of each customer. then at the bottom part would be
total of each row (2-7)."

#### What the words and the screenshot together settle

Issue #12 gave the aging report a by-customer view: customers down the side,
buckets across. Reading this description again against the screenshot, that is
the **transpose** of what was asked for. "1st row Customer Name" means the
customer names are the *header row* — customers are columns — with the five
buckets and a total as the rows beneath, a total column on the right, and the
company name above the whole thing. That is the classic one-page aging summary,
and it is what gets printed and handed round.

#### What was implemented

- A **Summary grid** view, now the one both aging reports open on: company name
  and "As of" date as the heading, customer (or vendor) names across the top,
  rows for Current, 1–30, 31–60, 61–90, 90+ and **Total**, a **Total** column on
  the right, and the total row picked out in bold.
- The other two views stay one click away: **By customer/vendor** (Issue #12)
  and **By document** (the original detail).
- The grid **exports to Excel and PDF** through the same buttons the other
  reports use — this layout exists to be handed to someone.
- `agingSummaryGrid` is the transpose of `pivotAgingByParty`, built from the
  same numbers, so the three views cannot disagree. 6 more unit tests, one of
  which walks every column of the grid and checks it against the party view it
  came from, to the cent.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 57 files, 548 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 50 of 50 pages rendered |

Also checked while here: the screenshot showed "Ageing total 8,343.10 does not
match Accounts Receivable control 8,505.48 — investigate". **Both aging reports
reconcile to their control accounts today** — asserted against the live ledger
— so that warning was a moment-in-time state, not a standing break.

The grid itself renders after **Run report**, so a server-side fetch of the page
cannot show it; its arithmetic is what the unit tests cover.

#### Not implemented, and why

| Idea | Decision |
|---|---|
| Making the grid the only view | **No.** It is the right shape for a dozen customers and the wrong one for two hundred — at that point the columns run off the page and the by-customer view is the readable one. The reader picks. |
| Freezing the customer columns as well as the age column | **The age column is fixed; the customers scroll.** Freezing both leaves nothing to scroll, and with twelve customers the grid fits the 1680px page anyway. |

### Issue #17 — "The ledger should be the bank account, not cash on hand"

From the in-app queue (`/banking`, 2026-07-31 07:41 local): "under add account,
the ledger would not be the cash on hand, it should be the bank account. ask me
if you need some explanation."

#### This one was already fixed, and it is live

The report was filed at 07:41; the fix went out at 15:55 the same day as
Issue #9. Verified against **production**, not just locally: signed in against
`ctyhp-accounting.vercel.app`, fetched `/banking`, and read the deployed
JavaScript — it carries both "What kind of account is this?" and the note that
cash on hand is not offered because "physical cash has no bank statement". The
database guard behind it is the same one the end-to-end test exercises.

So: the dialog now asks what kind of account it is (checking, savings, money
market, other), offers only ledger accounts that could be one, **never offers
cash on hand**, and the database refuses the link even if something tried it
another way.

#### What was added today, because the fix left a dead end

The chart has one usable bank ledger account (1010 Operating Bank Account) and
it is already linked. So the very next thing the reviewer does — adding a
second bank account — met "No ledger account of this kind is free. Create one
in Chart of Accounts, then come back."

The dialog now offers **"+ New ledger account for a savings account"** (or
whichever kind was chosen). It proposes the first free code in the 1000 block
and a name built from the bank's name — `1020 — First National Bank savings
account` — creates it with the right type and classification, and selects it.
Still a deliberate act, with the code and name in front of the person; just not
a detour through another screen and back.

Issue #9 declined inline creation on the grounds that a chart account should be
deliberate. That reasoning was right about *silent* creation and wrong about
this: the account is named, coded, classified and confirmed on screen.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 57 files, 548 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 50 of 50 pages rendered |
| Production check | the deployed `/banking` bundle contains the account-kind question and the cash-on-hand exclusion |

#### Still open with the reviewer

They offered an explanation ("ask me if you need some explanation"), and there
is one question worth putting back to them: should cash on hand be reachable
from Banking at all? It is **Q1** in
[questions-for-review.md](questions-for-review.md).

### Issue #18 — Import the statement from inside the reconciliation

From the in-app queue (`/banking/reconcile`, 2026-07-31 07:52): "I would say
this is a perfect example of the reconciliation page. I would recommend to add
an import bank statement option where in the system would recognized each
transaction from the statement and add those transaction under reconciliations.
ask me if you have a questions."

#### What was already there, and what the screenshot shows

Statement import existed — on the **Banking** screen, with CSV parsing, a
duplicate rule and a matcher that suggests which ledger entry each line belongs
to. The screenshot is the **Reconcile** screen: a list of sessions with
beginning and ending balances. The two halves of one job sat on two screens,
and the reconciliation assumed somebody had already loaded the statement
somewhere else.

#### What was implemented

- **Import bank statement, inside the reconciliation.** The workspace takes the
  CSV directly: it imports into the account that reconciliation belongs to,
  runs the matcher, and reports what happened — "12 transaction(s) imported, 3
  already on file, 9 matched to a ledger entry". It refuses if the
  reconciliation is completed; reopen it first.
- **A Statement lines panel** in the reconciliation, listing every imported
  line up to the statement date with its date, description, reference, amount
  and what the matcher paired it with. A line dated after the period belongs to
  the next reconciliation and is left out of this one.
- The ledger table underneath is now labelled for what it is — "Ledger lines in
  this reconciliation" — so the two lists cannot be confused.
- **`lib/domain/statement-import.ts` (new, pure) + 17 unit tests.** The parsing
  rules were inline in the Banking screen and now live in one tested place, and
  they got better in the move: `7/31/2026`, `31/07/2026` and `2026-07-31`; a
  first number over 12 read as a day whatever the setting says; `(1,234.56)`
  as negative; `1.234,56` as a European decimal; separate **debit and credit
  columns** as well as a single signed amount; and the column headings banks
  actually use (`posting date`, `narrative`, `check number`, `money in`…).
  A row it cannot read is skipped **and counted**, never guessed at.

#### Evidence

| Gate | Result |
|---|---|
| `npm test` | 58 files, 565 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, same 12 pre-existing warnings |
| `npm run build` | succeeded |
| `scripts/smoke-pages.mjs` | 50 of 50 pages rendered |
| `tests/e2e/statement-import.e2e.ts` (new, HTTPS, live DB) | passed |
| Rendered check | the in-progress reconciliation shows "Import bank statement", "Statement lines" and "Ledger lines in this reconciliation" |

The end-to-end test imports a two-line statement in the shape a US bank exports
— US dates, thousands separators, separate debit and credit columns — checks
the amounts land as +2,806.51 and −3,200.00 with the check number intact, then
imports the identical file again and asserts **nothing is added**: a
re-uploaded statement must not double the reconciliation.

#### Not implemented, and why

| Idea | Decision |
|---|---|
| Clearing the matched lines automatically | **Not yet.** The matcher suggests; a person approves. Auto-clearing a suggested match would let a wrong match complete a reconciliation, which is the one thing a reconciliation exists to prevent. The next step worth taking is a "clear all approved matches" action — approved, not suggested. |
| Creating ledger entries for statement lines that match nothing | **No.** A bank line with no entry behind it is either a missing document or a bank error; both need a person. Inventing an entry to make the reconciliation balance is how a difference gets buried. |
| OFX/QFX/QBO import | **Not built.** CSV is what every bank offers and what the reviewer had. The parser is a pure module with tests, so another format is a new reader beside it, not a rewrite. |

### Backlog from the same round (not started)

Recorded from the 14 in-app reports of 2026-07-30/31 (`acc_feedback_report`):

1. ~~`/reports` — spell "Aging", not "Ageing".~~ Done, see Issue #4 above.
2. `/banking` — Add account should default the ledger to a bank account, not
   Cash on hand.
3. ~~`/reports` — add an AP Aging report alongside AR.~~ It already existed;
   see Issue #12 for what was actually missing.
4. ~~`/reports/ar-ageing` — matrix layout: customer × Current/1-30/31-60/61-90/
   Over, with row and column totals.~~ Done alongside Issue #12.
5. ~~`/reports?report=balance` — chart below the numbers, multi-year and
   12-month comparison, variance columns toggleable.~~ Done, see Issue #11.
6. ~~`/reports/cash-flow` — chart below the numbers; accountant vs management
   view.~~ Done, see Issue #15.
7. ~~`/sales-tax` — tax rates differ by state; offer a rate list.~~ Done, see
   Issue #3 above.
8. ~~`/settings/feedback` — let a reporter attach images and PDFs.~~ Done, see
   Issue #7 above.
9. ~~`/reports`, `/fixed-assets` — separate statements per company (10+
   companies).~~ Assessed in Issue #14 — needs an architecture decision, not a
   code change.
10. ~~`/banking/reconcile` — import a bank statement and match it
    automatically.~~ Done, see Issue #18.
11. `/invoices` — bulk invoice import with AI field mapping.
12. `/settings` — import a QuickBooks or Wave CSV backup.

Items 9–12 are new modules rather than fixes; they need their own scoping round.
