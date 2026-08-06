# Saved reports — keeping a report from another system

Date: 2026-08-06
Slice 3 of 4 in the import work (guidance → bank transactions → **saved reports** → batch).

## Where this came from

Feedback on the import screen, recorded 2026-08-05:

> please include in this feature to import or saved a report coming from
> outside this One Book. Currently the feature is going to add the balance of
> the imported file to the balance of the ledger in One Book, Boss Alex want to
> save outside report in One Book, so every time he pull it.

Two different wants sit in that paragraph, and slices 1–2 answered only the
first. Importing a file **posts** it: the chart of accounts tab creates accounts,
the transactions tab posts journal entries. What is missing is the opposite —
a report produced somewhere else that should be **kept and read, never posted**.
A prior-year Profit and Loss from Wave, an accountant's closing pack, a bank's
own statement PDF. Nobody wants those balances added to anything; they want to
open them next quarter without hunting through email.

## Goal

An administrator or accountant saves a report file against the company it
belongs to, with enough description to find it again. Anyone in the company can
open it later — as a table on screen when the file is a CSV, as a download
otherwise. Saving a report changes no balance anywhere.

## Not in scope

- **Not a second import path.** Nothing here reads figures out of the file,
  reconciles them, or compares them to One Book's own numbers. The file is
  kept as it arrived.
- **Not a replacement for One Book's own reports.** `REPORT_CATALOG` keeps its
  22 generated reports; this adds one card that lists files instead.
- **Not virus scanning.** See *Stated limits*.
- **Not the Wave general-ledger parser.** Slice 4.

## Architecture

### Why a new bucket with no client policy

`acc_document_attachment` (migrations 0055–0057) already carries virus scanning,
retention, legal hold and an access log, and reusing it was the first idea. It
cannot be reused as it stands. Its `storage.objects` policies are global objects
pinned to `public.`:

```sql
-- 0055:333, replaced at 0056:48
and exists (select 1 from public.acc_document_attachment attachment
             where attachment.storage_path = name …)
```

`scopeOf()` holds global statements back from company schemas, so there is one
copy of that policy and it always consults `public`. Inside `co_pc_49` the
insert policy's `public.acc_document_storage_path_allowed(name)` cannot find the
entity, so the upload is refused outright. Document attachments are therefore
already broken outside the first company — a known gap that predates this work
(CLAUDE.md records the same shape for the two feedback storage policies), and
one this slice deliberately does not try to fix. Building saved reports on top
of it would mean shipping a feature that is broken for Pacific Four Nine, the
very company whose file prompted the request.

A second idea — a new bucket whose policy authorises from `onebook.company_member`
with the company id in the path — is writable entirely from global tables and so
survives multi-company. It was rejected because membership answers *may this
person open this company*, not *what may they do in it*: a viewer would be able
to upload.

**What this slice does instead:** bucket `onebook-reports`, private, **with no
`storage.objects` policy for `authenticated` at all**. RLS is on and no policy
means no access, so a browser session can neither read nor write an object
directly. Every transfer is authorised in application code, against the company
schema the request already resolved, and then carried by a signed URL:

- **Upload** — a server action checks `documents.manage`, then mints a signed
  upload URL with the service role. The browser PUTs the file to that URL.
- **Download** — a server action checks `documents.read`, confirms the row
  belongs to the company being read, then mints a signed download URL.

Signed URLs carry their own authorisation and do not consult RLS, which is
exactly why this arrangement works when a policy cannot. Authorisation moves to
the moment the ticket is issued, where the company schema is known for certain.

### Data — migration `0101_saved_reports.sql`

The bucket registration is global and reaches `storage.buckets` once. The table,
its policies and its functions are ordinary `public`-pinned statements, so
`retargetToSchema()` replays them into every company schema.

```sql
create table acc_saved_report (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(btrim(title)) > 0),
  source         text not null
                 check (source in ('quickbooks','wave','bank','spreadsheet','other')),
  period_start   date,
  period_end     date,
  notes          text,
  file_name      text not null check (length(btrim(file_name)) > 0),
  storage_bucket text not null default 'onebook-reports'
                 check (storage_bucket = 'onebook-reports'),
  storage_path   text not null unique check (storage_path !~ '\.\.'),
  mime_type      text not null,
  size_bytes     int  not null check (size_bytes between 1 and 10485760),
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status         text not null default 'active' check (status in ('active','archived')),
  uploaded_by    uuid references auth.users (id),
  uploaded_at    timestamptz not null default now(),
  archived_by    uuid references auth.users (id),
  archived_at    timestamptz,
  archive_reason text,
  check (period_end is null or period_start is null or period_end >= period_start)
);

create unique index acc_saved_report_sha_idx
  on acc_saved_report (sha256) where status = 'active';
```

`storage_path` is `<company_id>/<uuid>.<ext>`. The company id is there so an
object can be traced back to its company from the bucket listing alone; nothing
authorises on it.

`mime_type` is checked against the same allowlist the domain module holds:
`text/csv`, `application/pdf`,
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
`image/png`, `image/jpeg`.

The unique index on `sha256` means saving the same file twice is refused rather
than quietly duplicated. Archiving a report frees its hash, so a file can be
saved again after the old copy is retired.

### Writes go through functions, reads through RLS

```sql
alter table acc_saved_report enable row level security;

create policy acc_saved_report_sel on acc_saved_report
  for select using (acc_has_permission('documents.read'));
```

No insert, update or delete policy exists, so an application session has no way
to write the table except through two `security definer` functions:

- `acc_register_saved_report(p_title, p_source, p_period_start, p_period_end,
  p_notes, p_file_name, p_storage_path, p_mime_type, p_size_bytes, p_sha256)
  returns uuid` — refuses without `documents.manage`; raises
  `'This report is already saved'` on a duplicate hash (SQLSTATE 23505 mapped in
  the service); records `uploaded_by = auth.uid()`.
- `acc_archive_saved_report(p_id uuid, p_reason text)` — refuses without
  `documents.manage`; sets `status = 'archived'` with the actor, time and
  reason. **There is no hard delete**, matching every other record in the
  system.

`documents.read` and `documents.manage` are reused rather than invented. These
files are documents, the permissions are already seeded to the right roles
(read for every role, manage for admin and accountant), and adding a permission
means adding it to a fail-closed allow-list in three places.

**The central promise is enforced by what these functions do not contain.**
Neither calls `acc_post_entry`, writes `acc_journal_line`, or touches
`acc_bank_transaction`. The verification harness proves it by counting journal
entries either side of a save.

### Modules

| File | Responsibility |
| --- | --- |
| `lib/domain/saved-reports.ts` | Pure: `SAVED_REPORT_BUCKET`, `SAVED_REPORT_SOURCES`, `SAVED_REPORT_MIME_TYPES`, `SAVED_REPORT_MAX_BYTES`, `savedReportStoragePath(companyId, mimeType, uuid)`, `isTabularSavedReport(mimeType)`, `validateSavedReportFile(name, size, mimeType)`, and the Zod schemas for the register and archive inputs. |
| `lib/services/saved-reports.ts` | `createSavedReportUploadTicket`, `registerSavedReport`, `listSavedReports`, `createSavedReportDownloadUrl`, `readSavedReportText`, `archiveSavedReport`. Throws `SavedReportError`. |
| `app/(app)/reports/saved/actions.ts` | Server actions, each guarding by role before calling the service. |
| `app/(app)/reports/saved/page.tsx` | Thin server wrapper: resolves the active company, loads the list, renders the client. |
| `app/(app)/reports/saved/SavedReportsClient.tsx` | The list, the source/period filters, the archive action. |
| `app/(app)/reports/saved/SaveReportModal.tsx` | Upload: file, title, source, period, notes. |
| `app/(app)/reports/saved/SavedReportViewer.tsx` | Drawer: CSV as a table, everything else as a download. |

The client is split three ways from the start because one file holding list,
upload form and viewer would pass the 400-line ceiling on the first draft.

`readSavedReportText` downloads the object with the service role and returns its
text so the browser never needs a storage credential for the preview. It refuses
a file that is not tabular and caps what it returns.

### Flow

**Saving.** The browser hashes the file with `calculateFileSha256`
(`lib/client/documents.ts`, already written for attachments) and validates it
with `validateSavedReportFile`. It asks the server for an upload ticket, PUTs to
the signed URL, then calls the register action. **If registering fails the
client removes the object it just uploaded**, the same orphan cleanup
`AttachmentDrawer` performs — otherwise a failed save leaves a file nobody can
see and nobody can delete.

**Reading.** The list comes from the page's server render. Opening a row calls
the preview action for a CSV — which returns text the server read itself, so the
browser is handed no storage credential at all — or the download action for
anything else, which returns a signed URL issued with `{ download: file_name }`
and a 60 second life. The download button is offered for a CSV too.

### Screen

A card in `REPORT_CATALOG`, group `accounting`:

```ts
{
  id: "saved-reports",
  title: "Saved Reports",
  description: "Keep a report from QuickBooks, Wave or a bank and read it here later.",
  href: "/reports/saved",
  group: "accounting",
}
```

`REPORT_ICONS` in `components/reports/ReportsHub.tsx` gains an entry, or the
card falls back to a generic icon.

The page header states the rule in one line: *Reports saved here are kept as
they arrived. Nothing on this page affects a balance in One Book.* The import
screen gains a matching line pointing here, so someone holding a report rather
than a data file is sent to the right place before they map a single column.

### Error handling

Every failure is reported with what to do about it, and none is swallowed:

| Situation | What the user sees |
| --- | --- |
| File over 10 MB, or a type not on the allowlist | Refused before any upload starts, naming the limit or the accepted types |
| Same file already saved | *This report is already saved* — with the title it was saved under |
| Upload succeeds, register fails | The object is removed and the error is shown; nothing is left behind |
| Viewer tries to save | The action refuses; the button is not rendered for them either |
| CSV preview on a 9 MB file | First 500 rows, with a line saying so and a download button |
| A non-tabular file | The drawer says the format cannot be shown as a table and offers the download |

### Testing

**Unit — `tests/unit/saved-reports.test.ts`.** Concrete input and output for
`savedReportStoragePath`, `isTabularSavedReport`, `validateSavedReportFile`
(over-size, wrong type, accepted), and the Zod schemas (blank title, period end
before period start, unknown source).

**Service — `tests/unit/saved-reports-service.test.ts`.** A stubbed Supabase
client proving the duplicate-hash error is translated, and that
`readSavedReportText` refuses a PDF instead of returning bytes as text.

**Behavioural — `scripts/verify-saved-reports.mjs`.** Rollback-only, on the
pattern of `verify-import-transactions.mjs`: apply 0101 inside one transaction,
authenticate through `request.jwt.claims`, and always `ROLLBACK`. It proves:

1. An accountant registers a report and the row is readable.
2. **The journal entry count is unchanged** — the promise this feature makes.
3. The same `sha256` a second time is refused.
4. A viewer's register call is refused.
5. `acc_archive_saved_report` archives with actor and reason, and the archived
   hash can then be registered again.
6. A viewer's archive call is refused.

**Gates.** `npm test`, `npm run typecheck`, `npm run lint`,
`npm run security:check-source`, `npm run build`, and `scripts/smoke-pages.mjs`
against the built server — the new route brings the sweep to 56 pages.

## Stated limits

- **No virus scanning.** `acc_document_attachment` has a fail-closed scan state
  machine; rebuilding it for this table would duplicate an intricate mechanism
  for a second time. `feedback-attachments` (0070) set the precedent of a bucket
  without one. The compensations are a narrow MIME allowlist and signed URLs
  always issued with `download`, so a file that slipped through cannot execute
  in the application's origin. If scanning is later wanted here, the honest fix
  is to repair the multi-company gap in 0055–0057 and move this table under it.
- **Table preview is CSV only.** Reading XLSX in the browser would mean a new
  parser dependency for a convenience view. The drawer says so plainly rather
  than failing after the click.
- **No full-text search inside a saved file.** Reports are found by title,
  source and period.
