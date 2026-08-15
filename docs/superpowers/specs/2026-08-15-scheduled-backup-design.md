# Scheduled backups, and a restore that proves itself — design

**Status:** approved in brainstorming, 2026-08-15. Ready for an implementation plan.

## What is actually missing

The repository already exports a company. `exportCompanyDataAction` reads every
table in `EXPORT_TABLES`, records control totals and the schema version, and
returns a ZIP to the browser. It is gated by the `company.export` permission.

Three things are missing, and only the first is obvious:

1. **Nothing runs on a schedule.** Somebody has to remember.
2. **Nothing is kept.** The ZIP goes to the browser as base64. Close the tab and
   it is gone. No copy stays on the system.
3. **The way back has never been run.** There is an export and no import. A
   backup nobody has restored is not a backup; it is a file.

The cron infrastructure needed for the first already exists: `vercel.json` runs
four daily jobs, each guarded by `CRON_SECRET`, and `/api/companies/provision`
already shows the shape of a job that walks every company.

## What this protects against, and what it does not

**It protects against a company damaging its own books** — a bad import, a wrong
void, an edit nobody can retrace. This is not hypothetical: on 2026-08-15 a
company's balance sheet was out by $17.8m against the books it was migrated
from, and what rescued it was a copy of the source file that happened to be kept
under Saved Reports. A snapshot of the previous day would have turned a day of
forensics into five minutes.

Supabase's own backups do not cover this. Restoring them restores the **whole
database**, so rescuing one company would discard every other company's work.
Nobody will ever press that button. The gap is not "another copy" — it is a copy
**at the granularity of one company**.

**It does not protect against losing Supabase itself.** The snapshots live in
Supabase Storage and share the blast radius. What it gives is a downloadable
file, so a copy can be taken off-platform by a person, or by a second
destination added later without redesigning any of this.

**Long-term archiving is a retention number**, not separate machinery.

## Design

### The snapshot

The existing export logic is lifted out of the server action into a pure service
both callers share, so the button and the cron produce byte-identical output.

A new job at `/api/backups/run`, guarded by `CRON_SECRET`, walks every company
the way `/api/companies/provision` does. `vercel.json` gains a fifth entry at
12:00 UTC, after the four that already run.

Each snapshot is written to a private bucket `onebook-backups` at
`<company_id>/<YYYY-MM-DD>-<hash8>.zip`, the same shape `onebook-reports`
already uses for Saved Reports.

A registry table `acc_backup` lives **in each company's own schema**, like
`acc_import_batch`, so row-level security applies without a cross-company
function. It records the date, the content hash, the storage path, the byte
size, the schema version, the control totals, and — for a night that produced no
file — the fact that it was skipped and why.

### Skipping a night when nothing changed

Four of five companies today hold under 400 rows and may not change for weeks.
Thirty identical snapshots is not safety, it is noise that hides the snapshots
worth looking at.

So the job hashes the snapshot content and compares it with the last successful
one. Equal means a `skipped` row and no new file. The list of backups then reads
as **the history of days the books actually moved**, which is useful in itself.

**A prerequisite, not a detail.** `readTable` currently pages with `.range()`
and no `.order()`. Postgres does not promise an order without one, so the same
data can come back in a different order on two runs, the hash differs, and the
job writes a new snapshot every night while believing it is comparing them.
Adding `.order("id")` is required before the hash means anything. It also makes
two exports comparable to each other, which is the thing that had to be done by
hand on 2026-08-15.

### Retention

Keep the most recent 30 snapshots per company; delete the blob and the row
together beyond that. Size is not a constraint: the largest company holds 28,273
rows in its main tables and compresses to roughly 0.5–1 MB, so thirty of them is
tens of megabytes. Nothing here should be designed around saving space.

### Restore, as a new company

Restoring means: create an empty company through the existing provisioning path,
load the snapshot into it, then **recompute the control totals and compare them
with the ones recorded in the snapshot**, and report the result.

That last step is the point of the whole feature. It turns "it should work" into
evidence, and it runs on every restore rather than once when the code was
written.

Restoring beside the running books, rather than over them, is what suits the
failure this exists for. On 2026-08-15 nobody needed to go back to yesterday —
they needed to know **which figures were wrong and by how much**, which meant
putting two sets of books side by side. It also means the feature can never
damage the thing it is protecting.

Four rules that would be holes if left implicit:

- **The user list is not restored.** The export carries `acc_app_user` and the
  role assignments. Loading them into the copy would silently grant access to a
  set of books nobody has said those people may see. The person who ran the
  restore is the copy's only user. The books themselves restore in full.
- **A snapshot newer than the running code is refused.** The snapshot carries
  `acc_schema_migrations`. An older one loads — columns added since take their
  defaults. A newer one holds columns this code does not know about, and loading
  it anyway loses data in silence. Refuse, and say why.
- **Attachments are not in a snapshot, and the screen must say so.** The export
  is table data. Document scans, attachments and feedback images live in storage
  and are not covered. Unwritten, this is the kind of misunderstanding that only
  surfaces at the worst moment.
- **A restore never writes to the source company.** No path from this feature
  reaches the running books. That belongs in a test, not only in the intent.

### Permissions and where it lives

`company.export` already exists and is enforced. Listing and downloading a
snapshot is the same data by the same means, so it reuses that permission.

Restoring creates a company and copies an entire book, which is strictly larger
than reading one, so it takes a new `company.restore`.

Settings gains a **Backups** card through the same declare-once gate the other
cards use. The page lists date, size, control totals, and the nights that were
skipped because nothing had changed. Two actions: **Download**, and **Restore as
a new company**.

## Testing

Pure and fast:

- the hash is **stable** across two runs over the same data — the test that
  makes skip-if-unchanged meaningful, and the one that would have caught the
  missing `.order()`
- which snapshots retention selects for deletion, including the boundary at
  exactly thirty
- the skip decision: same hash skips, different hash writes, no previous
  snapshot writes
- the schema-version rule: older loads, equal loads, newer refuses

And one round trip that decides whether any of this is real: export a company
that has data, restore it into a new one, and compare control totals on both
sides. Without that test the feature is writing files to disk and hoping.

## Open question, to be measured before the plan is final

The largest company reads 28,273 rows through PostgREST in pages of 1,000 —
roughly 30 round trips, plus compression. Whether that fits inside a Vercel
function's time limit is **not yet known**. It will be measured against a real
export before the plan commits to a shape. If it does not fit, the job splits by
table or moves to a background run; that changes the plan, not this design.

## Explicitly out of scope

- Restoring over an existing company. It can be layered on later once restore
  has a record of working. The reverse order is not available.
- A second storage provider off Supabase. The downloadable file is the manual
  path until there is a reason to build the automatic one.
- Backing up attachments and stored documents.
- Monthly or yearly retention tiers. They stack on top of this if wanted.
