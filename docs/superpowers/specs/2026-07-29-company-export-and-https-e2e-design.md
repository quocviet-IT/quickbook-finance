# Company data export and HTTPS end-to-end test — design

Date: 2026-07-29
Status: approved for planning

Two independent pieces of work, specified together because they share one
constraint: the Postgres port is unreachable from the team's network, so
everything must work over HTTPS.

- **Part A — HTTPS end-to-end test.** Make the document → ledger → report E2E
  runnable from any network, which is what unblocks verification of migration
  0058.
- **Part B — Company data export.** Satisfy US-FR-113 and PRD release gate 8
  ("Backup restoration and company-data export are demonstrated").

Each part ships on its own branch and can merge independently.

---

## Part A — HTTPS end-to-end test

### Problem

`tests/e2e/document-ledger-report.e2e.ts` opens a `pg.Client`, runs the whole
scenario inside `begin isolation level repeatable read`, impersonates an
administrator with `set_config('request.jwt.claims', …, true)`, and rolls the
transaction back. That design needs a direct Postgres connection. Port 5432 on
`aws-0-ap-southeast-2.pooler.supabase.com` times out from the team's IPv4-only
network, so the test has never run in this environment — including for the
0058 posting RPCs it is supposed to cover.

PostgREST cannot host that design: every request is its own transaction, so
there is no cross-statement rollback and no session-level `set_config`.

### Decision

Replace the Postgres transport with HTTPS and delete the `pg` variant rather
than maintain two copies of one scenario. The HTTPS path is what production
actually uses (PostgREST, RLS, function grants), so the replacement tests more
of the stack than the original did, and it runs from any network.

Isolation moves from "roll the transaction back" to "mark every row, then prove
the ledger returned to its opening state".

### Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `tests/e2e/support/session.ts` | Sign in and return an authenticated `supabase-js` client, plus the marker string for the run | `@supabase/supabase-js`, env |
| `tests/e2e/support/ledger-snapshot.ts` | Read trial balance and AR/AP ageing totals; compare two snapshots and describe the difference | RPC `acc_ledger_balances`, `acc_ar_ageing`, `acc_ap_ageing` |
| `tests/e2e/support/cleanup.ts` | Delete every artefact carrying the run marker; safe to call twice | authenticated client |
| `tests/e2e/document-ledger-report.e2e.ts` | The scenario and its assertions | the three modules above, `lib/domain/reports` |

Authentication uses the **anon key** with `E2E_EMAIL` / `E2E_PASSWORD`
(defaulting to `SMOKE_EMAIL` / `SMOKE_PASSWORD`, the pair
`scripts/smoke-pages.mjs` already uses). The service-role key is never used —
running as a real signed-in administrator is what makes the test exercise RLS
and the `authenticated` grants.

Missing environment variables fail the test with a message naming the variable.
The test never silently skips.

### Scenario

1. **Snapshot** the opening trial balance and AR ageing total.
2. **Sweep** any leftovers from an earlier interrupted run with the same marker
   prefix.
3. **Create** a draft invoice through `acc_create_draft_invoice` — the 0058 RPC
   this test exists to cover — with the marker in the memo.
4. **Issue** it.
5. **Assert**: the journal entry balances; invoice lines reconcile to the
   journal lines; trial balance debit and credit both rise by the invoice
   total; AR ageing rises by the same amount; and the Trial Balance and Profit
   and Loss built by `lib/domain/reports` from `acc_ledger_balances` match the
   database figures.
6. **Void** it and assert the reversal restores every figure.
7. **Delete** the marked rows, then assert the closing snapshot equals the
   opening snapshot **to the minor unit**.

Cleanup runs in `finally`, so a failed assertion still leaves the ledger clean.
`scripts/cleanup-test-ledger.mjs` remains the manual safety net.

### Accepted consequences

- The test writes to the production database for the duration of the run. The
  closing-equals-opening assertion is what makes that safe to repeat; if it
  ever fails, the run has left residue and the failure says so explicitly.
- Invoice numbers are consumed. Numbers are never reused after posting or
  voiding (US-FR-004), so each run leaves a gap in the sequence. This is
  correct behaviour, not a defect, and the runbook says so.

### Testing

`npm run test:e2e:document-ledger-report` keeps its name and its
`--env-file=.env.local`. The unit suite is untouched. CI does not run this test
— it needs real credentials, and CI deliberately holds none.

---

## Part B — Company data export

### Goal

An authorised user downloads one archive that contains the company's accounting
data in a documented, machine-readable format, with enough control totals to
prove a restored database matches it.

Restore itself is a documented and rehearsed operational procedure over
Supabase point-in-time recovery — not an in-app importer. Building an importer
is explicitly out of scope.

### Flow

Button on `/settings/company` → Server Action `exportCompanyData()` →
permission check → read each table with the caller's own client → build the
archive in memory → return the bytes → the browser saves the file. The client
half mirrors `lib/client/report-export.ts`, which already builds `.xlsx` and
`.zip` payloads with `fflate`.

### Archive layout

```
manifest.json              schema version, generated_at, actor, per-file row
                           counts and sha256, control totals, omissions
data/<table>.csv           one file per exported table, header = column names
sensitive/vendor-tax.csv   vendor tax profiles including TIN
attachments.csv            attachment inventory: id, owning document, file
                           name, size, sha256, scan status, storage path
README.txt                 how to read the archive; pointer to the runbook
```

CSV is the interchange format because it is the format the PRD's portability
requirement (US-NFR-007) is written against and the one every accounting tool
reads. `manifest.json` carries everything CSV cannot express.

### Control totals

The manifest records, as of the export instant:

- trial balance total debit and total credit, in minor units;
- AR ageing total and AP ageing total;
- `acc_journal_line` row count;
- row count and sha256 for every file in the archive.

These four accounting figures are the acceptance test for a restore: recompute
them on the restored database and compare. That is how gate 8 gets
demonstrated rather than asserted.

### Table scope

All 67 `acc_*` relations are exported except:

| Excluded | Reason |
|---|---|
| `acc_bank_connection_secret` | Feed tokens encrypted with an environment key; useless once restored elsewhere and a live secret in the meantime |

`acc_schema_migrations` **is** exported — knowing which migration the data was
written under is what makes the archive interpretable later.

`acc_vendor_tax_profile` is exported to `sensitive/vendor-tax.csv` rather than
`data/`, because it carries taxpayer identification numbers. A backup without
TINs cannot support 1099 preparation after a restore, so omitting them would
defeat the purpose; isolating them keeps the decision visible. The manifest
flags the file as sensitive, the UI warns before download, and the audit entry
records that a TIN-bearing export was taken.

### Components

| Unit | Responsibility | Pure? |
|---|---|---|
| `lib/domain/company-export.ts` | Table catalogue and exclusions, CSV serialisation, sha256, manifest construction, file naming | yes — unit tested |
| `lib/services/company-export.ts` | Page through each table with the caller's client; gather control totals from the reporting RPCs | no |
| `app/(app)/settings/company/actions.ts` | Permission gate, orchestration, audit write, return bytes | no |
| `components/settings/CompanyExportCard.tsx` | Button, sensitivity warning, progress and error states, triggers the download | no |

Reads are paged at 1000 rows so a large table cannot blow the request budget,
and the service reports the row count it actually read into the manifest.

### Authorisation and audit

A new permission `company.export` (category `Governance`, `is_enforced = true`)
gates the action, following the Module C model — role alone is not the gate.
Migration `0059_company_export.sql` inserts the permission and grants it to the
administrator role only; other roles can be granted it from the permissions
matrix.

Every export writes one `acc_audit_log` row: actor, generated_at, per-table row
counts, the manifest sha256, and whether the sensitive file was included. The
audit row records the shape of the export, never its contents, and never a TIN.

### Restore runbook

`docs/operations/backup-and-restore.md` covers: what Supabase retains and for
how long; the recovery point and recovery time objectives; step-by-step
point-in-time recovery; how to verify a restored database against an export
manifest's control totals; how often the drill runs; and a log of drill results
with dates and outcomes. Gate 8 is met when that log has its first entry.

### Testing

- `tests/unit/company-export.test.ts`: CSV escaping (quotes, commas, newlines,
  leading `=` for spreadsheet-injection safety), manifest construction, sha256
  stability, the exclusion list, and the guarantee that TIN columns never
  appear in a `data/` file.
- `tests/unit/access.test.ts`: extend so the new permission appears in the
  matrix with the right category.
- A live run of the export against the real company, with its manifest control
  totals compared against the same figures read directly from the database,
  recorded in the runbook as the first drill entry.

### Non-goals

Importing an archive back into the application; scheduled or automated exports;
exporting attachment bytes; multi-company or consolidated export.
