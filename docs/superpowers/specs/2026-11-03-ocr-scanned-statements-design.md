# Scanned bank statements read by the company's OCR server — design

Date: 2026-11-03 · Release: 3.02 · Migration: `0188_ocr_jobs.sql`

## Goal

Import statement currently refuses a scanned PDF ("This PDF holds no text — it looks like a
scanned image…", `lib/domain/pdf-statement-view.ts`). After this change the dialog offers **Read
with OCR**. The file goes to the company's own OCR server (Unlimited-OCR on a GPU machine inside
the office network). The text comes back as statement lines, and the user reviews them in **the
same dialog and the same proof** (opening + lines = closing) as a text PDF before importing.

Out of scope: bills and receipts, reconcile-from-files (`lib/client/run-files.ts`), and
credit-card PDFs. Each of these can follow the same queue later.

## What exists and is reused

- `ImportStatementModal.tsx`: `readPdf` → `readPdfStatementFile` → `{ kind: "pdf", statements }`,
  then `StatementProofPanel`, `StatementLinesPreview` and `importStatementAction`. The import
  already accepts a `statementFileId`.
- `readPdfStatements(glyphs: PdfGlyph[])` (`lib/domain/pdf-statement.ts`) turns positioned text
  into `PdfStatement` (period, opening and closing, lines with running balance).
- Keeping a statement file: `keepStatementFile` puts the PDF in the private bucket
  `onebook-reports` as an `acc_saved_report` row (source `bank`). This requires
  `documents.manage`, caps the file at 10 MB and de-duplicates by sha256 (1.83, migration 0135).
- Server-to-server routes authorized by a bearer secret compared with `timingSafeEqual`, at least
  24 characters long (`app/api/backups/run`, the `CRON_SECRET` pattern).
- A global job queue in `onebook` with `skip locked` claim, complete and fail functions
  (`onebook.company_request`, migration 0097).

## Approach

The OCR server cannot be reached from the internet, and OneBook runs on Vercel. **The worker
pulls jobs.** It calls OneBook over HTTPS and makes outbound connections only, so no port is
opened into the office.

Alternatives considered:

- **A tunnel or open port to the OCR server, so OneBook pushes jobs.** Rejected: it exposes an
  office machine to the internet.
- **The worker talks to Supabase directly.** Rejected: the machine would hold the service-role
  key, which reaches every company's books.
- **A queue table per company.** Rejected: each poll would query every company schema. One
  global queue, as `company_request` uses, needs a single indexed query per poll.

## Components

1. **Database (`0188_ocr_jobs.sql`).**
   - `onebook.ocr_job`: schema, kept file id, storage path, status (pending, running, done,
     failed), attempts, pages, a lease, the result as jsonb (at most 5 MB), the error and who
     asked.
   - `onebook.ocr_worker`: a one-row heartbeat.
   - RLS is on with no policies, and the tables are revoked from `authenticated`, so they are
     reachable only through functions.
   - Functions for users (`authenticated`):
     - `request_ocr_job(schema, saved_report_id)` refuses unless the caller is a member of the
       company and holds `documents.manage` there. The same file returns the existing job, and a
       company may have at most three open jobs.
     - `ocr_job_status(id)` answers only the person who asked.
     - `ocr_worker_online()`.
   - Functions for the worker (`service_role` only): `claim_ocr_job`, `report_ocr_progress`,
     `complete_ocr_job` and `fail_ocr_job`.
   - Leases: a claim holds the job for 10 minutes, and each progress report extends that. An
     expired lease returns the job to the queue, up to 3 attempts, after which the job fails with
     a reason.
   - Every statement names `onebook.`, so the runner applies the file once and never replays it
     into a company schema (checked with `scopeOf`: 29 of 29 statements are global).
2. **Worker routes**, `app/api/ocr/{claim,progress,complete,fail}/route.ts`.
   - All four use bearer `OCR_WORKER_SECRET`, compared with `timingSafeEqual` and at least 24
     characters long, as `CRON_SECRET` is.
   - They call the onebook functions through a service-role client bound to the `onebook`
     schema.
   - `claim` returns the job and a signed download URL for the kept file, valid for 10 minutes
     (`createSavedReportStorageClient`).
   - `complete` validates the payload with zod before storing it: at most 20 pages, each with a
     page number and its text, and an engine name.
   - With the secret unset, the routes answer 404 and the button is hidden.
3. **Worker**, `ctyhp-accounting/ocr-worker/`: a Python script using only the standard library
   and `pdftoppm`, run under systemd on the OCR machine.
   - The loop: claim → download → render the PDF at 300 dpi (at most 20 pages, or fail with a
     reason) → call the local vLLM server one page at a time (`<image>document parsing.`) →
     report progress after each page → complete.
   - It runs around the clock, because the books are kept in the US and the people using them
     work in US hours, evenings included. Polling adapts to keep the call count down: every 30
     seconds when idle, every 5 seconds for 15 minutes after any job, so a burst of statements
     is picked up at once.
   - The secret lives in a root-readable env file on the machine and never in the repo.
4. **Parser**, `lib/domain/ocr-statement.ts` (pure, unit-tested).
   - `glyphsFromOcrPages(pages)` turns the OCR text into `PdfGlyph[]`. Table cells sit on a
     column grid, one row per table row. Text blocks become lines in reading order.
   - The glyphs then go through **the existing `readPdfStatements`**, so a scanned statement is
     read by the same rules as a text one.
   - If a bank layout defeats that, a table-only fallback maps the column headers (Date,
     Description, Withdrawals/Debits, Deposits/Credits, Amount, Balance) directly.
5. **Dialog**, `ImportStatementModal.tsx`.
   - On a scanned PDF, when `ocr_worker_online()` is true, the dialog shows **Read with OCR**.
     When it is false, it shows today's message plus "The OCR server is offline".
   - Clicking the button keeps the file (`keepStatementFile`), calls `request_ocr_job`, then
     polls `ocr_job_status` every 3 seconds. The dialog shows "Waiting for the OCR server" and
     then "Reading page 2 of 5".
   - When the job is done, the dialog parses the text and continues as `{ kind: "pdf",
     statements }` with the kept file's id.
   - A banner reads: "Read by OCR from a scanned image. Check the lines against the statement
     before importing."
   - When lines carry a balance, each line where previous balance ± amount ≠ printed balance is
     marked, so a misread digit points to its own row.
6. **Words.** The reading note currently says "The file never leaves your browser". For a
   scanned file it becomes "OneBook sends this file to your company's own OCR server. It is
   never sent to an outside service." The changelog gets Release 3.02.

## Errors

| Case | What the user sees |
|---|---|
| OCR server offline | Today's scanned message plus "The OCR server is offline"; no button |
| More than 20 pages, or a locked or damaged PDF | The job fails with that reason |
| Worker stops mid-file | The job is retried automatically (3 attempts), then fails with the reason |
| No statement found in the text | The existing "no lines" message |
| Proof does not balance | The existing "Import anyway…" path, administrator only |

## Testing

- **Unit tests.**
  - `glyphsFromOcrPages` followed by `readPdfStatements` on a fixture: the OCR output of the
    made-up 14-line statement already used to test the server (no real data). The test expects
    14/14 amounts and balances, the period, and opening and closing balances.
  - The per-line balance check.
  - Route authorization: missing, short or wrong secret gives 401; unset secret gives 404.
- **Database.**
  - A verify script runs request → claim → progress → complete, plus lease expiry and the third
    attempt, inside a transaction that is always rolled back.
  - `verify:company-provisioning` must still pass.
- **Live**, on PC-Test with the made-up statement exported as a scanned PDF. Screenshot the
  dialog at each step before reporting done.

## Rollout

1. Approve and apply 0188. This adds tables and functions only and changes nothing existing.
2. Merge with `OCR_WORKER_SECRET` unset; the feature stays hidden.
3. Install the worker on the OCR machine, then set the same secret in Vercel and on the machine.
4. Try it on PC-Test, then use it with real scanned statements.

## Decisions (approved 2026-11-03)

1. **Who may use it.** `documents.manage`, the same as keeping a statement file.
2. **When it runs.** Around the clock, because US users may import in their evening, which is
   night at the OCR machine. Adaptive polling keeps this to about 90,000 Vercel function calls a
   month: 86,400 idle calls at one per 30 seconds, plus short 5-second bursts after jobs. A
   first page waits at most about 30 seconds to start.
3. **Page limit.** 20 pages per file. That is about 5 minutes of reading at about 15 seconds a
   page.
