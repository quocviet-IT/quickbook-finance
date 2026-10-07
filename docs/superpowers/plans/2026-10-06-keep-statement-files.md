# Keep the statement file as evidence (1.83) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every statement OneBook reads keeps its file — once per SHA-256 — in the Reports › Saved store; the reconciliation or import read from it points at it; the file is viewed inside OneBook; a reconciliation without one can be given its file later, only if the file reads to its statement.

**Architecture:** Migration 0135 lets the Reports › Saved store keep bank downloads as `text/plain`, adds `statement_file_id` to reconciliations and statement imports (written only by OneBook's functions, behind a trigger), keeps a file through `acc_keep_statement_file` (deduplicated by SHA-256, refused outside the company's own folder `<schema>/<uuid>.<ext>`), sets a reconciliation's file together with its statement lines, attaches one later only where there is none, and refuses to archive a file in use. In the browser the file is hashed, uploaded once through a one-time ticket and recorded before the import or reconciliation it belongs to; a file that cannot be kept never stops the work. A viewer draws a PDF as page images, a CSV as a table and a bank download as text.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Ant Design 6, Zod 4, Supabase Postgres (one schema per company) and Storage, pdf.js 6, Vitest.

Spec: `docs/superpowers/specs/2026-10-06-keep-statement-files-design.md`.

## Global Constraints

- US English UI. Every place a statement is read keeps its file: Banking › Import statement, Bank Reconciliation › From statement files, Import statement inside a reconciliation. Always, automatically — nothing to tick (the user's decisions).
- The same file (same SHA-256) is kept once and pointed to by everything read from it: a CSV year cut into twelve months gives twelve reconciliations and one file.
- Files live in the Reports › Saved store, source `bank` (approach A). Documents & Attachments stays paused and untouched — no file under `app/(app)/documents`, `components/documents` or `lib/**/documents*` changes.
- A file is viewed inside OneBook: a PDF drawn page by page as images by pdf.js, a CSV as a table, OFX / QFX / QBO / QIF as plain text; Download beside it. The browser is never handed a kept file to open — only Download gives it to the computer.
- If a file cannot be kept, the import or reconciliation goes on and says so: "The statement file could not be kept: <reason>. Attach it on the reconciliation." (on a Banking import: "… Its lines were imported without it.").
- Attach the statement attaches a file only if it reads to the reconciliation's statement: its closing balance equals the statement ending balance on the statement date, and — when the reconciliation kept statement lines — its lines are the same lines in order. The mismatch message names both, for example "This file's statement closes Jun 30, 2026 at $6,595.01; this reconciliation is to May 31, 2026 at $6,160.01." Clarification of spec §3.4, taken while building: a bank download that prints no balance is matched by its lines alone (the reconciliation must have kept lines); a reconciliation that kept no lines can only be matched by a file that prints its closing balance; a CSV that runs over several months is matched by its lines from the first kept day to the statement date.
- A file a reconciliation or an import points to cannot be archived: "This file is the statement of the reconciliation to May 31, 2026 — it stays."
- The reconciliation report names the file, when it was kept and the first 12 characters of its SHA-256.
- 10 MB per file. Not virus-scanned, as Reports › Saved today.
- No real statement, bank name, account number or figure in the repository: fixtures are invented.
- Migration 0135 is **not applied to the live database by any task**. The verify script applies it inside a transaction that is always rolled back. It goes live only after the user approves, in Task 9, by the controller — and before this code is deployed.
- Run everything from `ctyhp-accounting/`. Never pipe test output through `head`/`tail`; read the pass/fail lines.
- Write every file with the Write or Edit tool — never a bash heredoc, `echo` or `python -c`, which eat backslashes and quotes. Write paths exactly as given — never with backslash escapes such as `\(` or `\]` (on Windows they create stray directories such as `app/(app`).
- A `"use server"` file exports only async functions and types.
- The Supabase browser client is imported dynamically (`await import("@/lib/db/client")`), and so is `lib/client/keep-statement-file.ts` from a screen — the bundle budget holds.
- New tables use `components/ui/DataTable` (enforced by `tests/unit/table-adoption.test.ts`).
- Stage files by name; never `git add -A`. Write commit messages with `printf` in Git Bash to `../.superpowers/sdd/commit-msg.txt` (never PowerShell — it writes a BOM), check with `od -c ../.superpowers/sdd/commit-msg.txt | head -1` that the first bytes are not `357 273 277`, then `git commit -F ../.superpowers/sdd/commit-msg.txt`. No Co-Authored-By trailer. After each task, `git status --short --untracked-files=all` (from the repository root) shows no file the task did not name, and `ls -b app` shows no stray directory.

Every file below was run before this plan was written: the migration through its verify script on all six companies (313 passed, 0 failed, rolled back); the unit tests; `tsc --noEmit`, `eslint`, the whole unit suite (3,038 tests), `next build` and the bundle budget (11 within budget) with every task's files in place.

Where a step says "apply these edits", each edit is a find/replace: find the exact text (it occurs once), replace it with the text given. The edits were worked out from the checked files and proved by applying them to the file as it is on the branch.

---

### Task 1: Migration 0135 and its verification

**Files:**
- Create: `supabase/migrations/0135_keep_statement_files.sql`
- Create: `scripts/verify-statement-files.mjs`
- Create: `tests/unit/keep-statement-files-migration.test.ts`

**Interfaces:**
- Produces (SQL, every company schema):
  - `acc_saved_report.mime_type` accepts `text/plain`; the `onebook-reports` bucket allows it (public schema only);
  - `acc_statement_reconciliation.statement_file_id` and `acc_bank_import_batch.statement_file_id` (`uuid null references acc_saved_report`), changed only behind the transaction-local setting `acc.statement_file_change = 'on'` (trigger `acc_statement_file_guard`);
  - `acc_saved_report_path_is_ours(p_path text) returns boolean` — `<current_schema()>/<uuid>.<ext>`;
  - `acc_register_saved_report(...)` — as 0101, refusing a path outside the company's folder;
  - `acc_keep_statement_file(p_title text, p_period_start date, p_period_end date, p_file_name text, p_storage_path text, p_mime_type text, p_size_bytes int, p_sha256 text) returns jsonb` — `{ id, reused }`; needs `documents.manage`;
  - `acc_create_reconciliation_from_statement(p_bank_account_id, p_ending_date, p_ending_minor, p_file_name, p_opening_minor, p_lines, p_statement_file_id uuid default null) returns uuid`;
  - `acc_set_reconciliation_statement(p_reconciliation_id, p_file_name, p_opening_minor, p_closing_minor, p_lines, p_statement_file_id uuid default null) returns integer` — the file goes with the lines: null clears it;
  - `acc_link_reconciliation_statement_file(p_reconciliation_id uuid, p_file_id uuid) returns void` — only where there is none, any status;
  - `acc_link_import_batch_statement_file(p_batch_id uuid, p_file_id uuid) returns void` — set once;
  - `acc_archive_saved_report` refuses a file in use;
  - `acc_bank_statement_imports(p_bank_account_id uuid default null)` gains the column `statement_file_id`.

- [ ] **Step 1: The verify script and the static test first.** Create `scripts/verify-statement-files.mjs`:

```js
/**
 * Behavioural verification of migration 0135 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0135 has not been applied it is applied first, inside that transaction,
 * and every account, file row, reconciliation and import the checks need is
 * made there too — so nothing is left behind. No object is written to storage:
 * the checks are about the rows that point at files, not the bytes. A refusal
 * is tried inside a savepoint, so the books it is tried on stay as they were.
 *
 * Run: node --env-file=.env.local scripts/verify-statement-files.mjs
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0135_keep_statement_files.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 8 * 60 * 1000);
await client.connect();

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const as = (userId) =>
  client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
/** Runs `sql`, expecting the database to refuse it with a message holding `expect`; the books are left as they were. */
async function refused(label, sql, params, expect) {
  await client.query("savepoint refusal");
  try {
    await client.query(sql, params);
    check(label, false, "it was accepted");
  } catch (error) {
    check(label, error.message.includes(expect), error.message);
  } finally {
    await client.query("rollback to savepoint refusal");
  }
}
const sha = (text) => createHash("sha256").update(text).digest("hex");

const { rows: companies } = await client.query(
  `select schema_name from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        for (const statement of statements) await client.query(statement);
        console.log("  (0135 applied inside the transaction, never committed)");
      }
      for (const statement of statements) await client.query(statement);
      check("applying 0135 a second time is harmless", true);

      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const viewer = await one(`select id from acc_app_user where role = 'viewer' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }
      const elsewhere = schema === "public" ? "co_elsewhere" : "public";
      const path = (ext = "pdf", folder = schema) => `${folder}/${randomUUID()}.${ext}`;

      // ---- the folder a kept file must live in
      const ours = async (p) => (await one(`select acc_saved_report_path_is_ours($1) as ok`, [p])).ok;
      check("a path in this company's folder is ours", await ours(path()));
      check("a path in another company's folder is not", !(await ours(path("pdf", elsewhere))));
      check("a path climbing out of the folder is not", !(await ours(`${schema}/../${randomUUID()}.pdf`)));
      check("a path with no file name is not", !(await ours(`${schema}/statement.pdf`)));
      check("a path with no folder is not", !(await ours(`${randomUUID()}.pdf`)));

      // ---- the books: a bank account with nothing in it yet
      const gl = (await one(
        `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
         values ('ZZ-VERIFY-SF', 'Verify statement files bank', 'bank', $1, true) returning id`,
        [base.code],
      )).id;
      const bank = (await one(
        `insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`,
        [gl, base.code],
      )).id;
      // A second account, brought forward and so completed: a reconciliation made before 1.83.
      const gl2 = (await one(
        `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
         values ('ZZ-VERIFY-SF2', 'Verify statement files bank 2', 'bank', $1, true) returning id`,
        [base.code],
      )).id;
      const bank2 = (await one(
        `insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank 2', $2) returning id`,
        [gl2, base.code],
      )).id;

      await client.query("set local role authenticated");
      await as(admin.id);

      // ---- keeping a file
      const keep = `select acc_keep_statement_file($1, '2026-05-01', '2026-05-31', $2, $3, $4, $5, $6) as r`;
      const mayPdf = { name: "example-may.pdf", path: path("pdf"), sha: sha(`may ${schema} ${randomUUID()}`) };
      const kept = (await one(keep, ["Verify Bank — May 1 – May 31, 2026", mayPdf.name, mayPdf.path, "application/pdf", 2048, mayPdf.sha])).r;
      check("a statement file is kept, new", kept.reused === false && typeof kept.id === "string");
      const row = await one(`select * from acc_saved_report where id = $1`, [kept.id]);
      check("it is kept as a Bank file with its period", row.source === "bank" && String(row.period_end).length > 0 && row.status === "active");
      check("its audit line is written", (await one(
        `select count(*)::int as n from acc_audit_log where table_name = 'acc_saved_report' and record_id = $1 and action = 'keep_statement_file'`,
        [kept.id],
      )).n === 1);
      const again = (await one(keep, ["Another title", "renamed.pdf", path("pdf"), "application/pdf", 2048, mayPdf.sha])).r;
      check("the same file kept again is the one already kept", again.reused === true && again.id === kept.id);
      check("…and makes no second row", (await one(`select count(*)::int as n from acc_saved_report where sha256 = $1`, [mayPdf.sha])).n === 1);

      const ofx = (await one(keep, ["Verify Bank — June", "example-june.qfx", path("txt"), "text/plain", 900, sha(`june ${randomUUID()}`)])).r;
      check("a bank download is kept as text", ofx.reused === false);
      const csv = (await one(keep, ["Verify Bank — July", "example-july.csv", path("csv"), "text/csv", 700, sha(`july ${randomUUID()}`)])).r;
      check("a CSV is kept", csv.reused === false);

      await refused("a file in another company's folder is refused", keep,
        ["x", "x.pdf", path("pdf", elsewhere), "application/pdf", 10, sha(randomUUID())], "this company's own folder");
      await refused("a spreadsheet is not a statement file", keep,
        ["x", "x.xlsx", path("xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 10, sha(randomUUID())],
        "a PDF, a CSV or a bank download");
      await refused("a file over 10 MB is refused", keep,
        ["x", "x.pdf", path("pdf"), "application/pdf", 10_485_761, sha(randomUUID())], "size_bytes");

      // ---- registering a saved report checks the folder too
      const register = `select acc_register_saved_report('Verify', 'other', null, null, null, 'r.csv', $1, 'text/csv', 10, $2) as id`;
      await refused("a saved report in another company's folder is refused", register,
        [path("csv", elsewhere), sha(randomUUID())], "this company's own folder");
      const registered = (await one(register, [path("csv"), sha(randomUUID())])).id;
      check("a saved report in this company's folder is registered", typeof registered === "string");

      // ---- who may keep
      if (viewer) {
        await as(viewer.id);
        await refused("a viewer cannot keep a file", keep,
          ["x", "x.pdf", path("pdf"), "application/pdf", 10, sha(randomUUID())], "Not authorized");
        await as(admin.id);
      } else {
        console.log("  (no viewer in this company; the outsider check stands in)");
      }
      await as(OUTSIDER);
      await refused("someone outside the company cannot keep a file", keep,
        ["x", "x.pdf", path("pdf"), "application/pdf", 10, sha(randomUUID())], "Not authorized");
      await refused("someone outside the company cannot attach a file", `select acc_link_reconciliation_statement_file($1, $2)`,
        [randomUUID(), kept.id], "Not authorized");
      await as(admin.id);

      // ---- a reconciliation started from a statement is made with its file
      const lines = [
        { txn_date: "2026-05-10", description: "DEPOSIT", reference: null, amount_minor: 1000, balance_minor: 1000 },
      ];
      await refused("a file that is not kept here is refused",
        `select acc_create_reconciliation_from_statement($1, '2026-05-31', 1000, 'x.pdf', 0, $2::jsonb, $3) as id`,
        [bank, JSON.stringify(lines), randomUUID()], "not kept here");
      const rec = (await one(
        `select acc_create_reconciliation_from_statement($1, '2026-05-31', 1000, $2, 0, $3::jsonb, $4) as id`,
        [bank, mayPdf.name, JSON.stringify(lines), kept.id],
      )).id;
      const fileOf = async (id) => (await one(`select statement_file_id from acc_statement_reconciliation where id = $1`, [id])).statement_file_id;
      check("started from a statement: it points at its file", (await fileOf(rec)) === kept.id);
      check("…and the link is in the audit log", (await one(
        `select count(*)::int as n from acc_audit_log where table_name = 'acc_statement_reconciliation' and record_id = $1 and action = 'statement_file'`,
        [rec],
      )).n === 1);
      // The call 1.79 and 1.81 make today, without the last argument, still finds
      // one function — refused here only because this account has one in progress.
      await refused("the old call, without a file, still resolves to the one function",
        `select acc_create_reconciliation_from_statement($1, '2026-06-30', 1000, 'x.pdf', 0, $2::jsonb) as id`,
        [bank, "[]"], "already exists");

      // ---- no direct writes to the pointer
      await refused("a direct update cannot swap the file", `update acc_statement_reconciliation set statement_file_id = $2 where id = $1`,
        [rec, ofx.id], "OneBook's own steps");
      await refused("a direct update cannot clear the file", `update acc_statement_reconciliation set statement_file_id = null where id = $1`,
        [rec], "OneBook's own steps");
      await refused("a direct insert cannot name a file",
        `insert into acc_statement_reconciliation (bank_account_id, statement_ending_date, statement_ending_balance_minor, status, statement_file_id)
         values ($1, '2026-01-31', 0, 'completed', $2)`, [bank, kept.id], "OneBook's own steps");
      await client.query("savepoint other_columns");
      await client.query(`update acc_statement_reconciliation set note = 'verify' where id = $1`, [rec]);
      check("a direct update of other columns is left alone", (await fileOf(rec)) === kept.id);
      await client.query("rollback to savepoint other_columns");

      // ---- importing another statement replaces the lines and the file together
      const replace = `select acc_set_reconciliation_statement($1, $2, 0, 1000, $3::jsonb, $4) as n`;
      await one(replace, [rec, "example-june.qfx", JSON.stringify(lines), ofx.id]);
      check("another statement imported: its file replaces the first", (await fileOf(rec)) === ofx.id);
      await one(replace, [rec, "unkept.pdf", JSON.stringify(lines), null]);
      check("a statement whose file could not be kept leaves no file", (await fileOf(rec)) === null);
      await one(`select acc_set_reconciliation_statement($1, 'old-call.pdf', 0, 1000, $2::jsonb) as n`, [rec, JSON.stringify(lines)]);
      check("the old call, without a file, still works", (await fileOf(rec)) === null);

      // ---- attaching later
      const attach = `select acc_link_reconciliation_statement_file($1, $2)`;
      await one(attach, [rec, kept.id]);
      check("a reconciliation without a file takes one", (await fileOf(rec)) === kept.id);
      await one(attach, [rec, kept.id]);
      check("attaching the same file again changes nothing", (await fileOf(rec)) === kept.id);
      await refused("a reconciliation with a file does not take another", attach, [rec, ofx.id], "already has its statement file");
      await refused("attaching nothing is refused", attach, [rec, null], "Choose the statement file");
      await refused("attaching a file not kept here is refused", attach, [rec, randomUUID()], "not kept here");

      // A completed reconciliation, made before 1.83, takes its file too.
      const forward = (await one(`select acc_bring_forward_reconciliation($1, '2026-04-30', 0, 'Brought forward, verify') as id`, [bank2])).id;
      await one(attach, [forward, csv.id]);
      check("a completed reconciliation takes its file", (await fileOf(forward)) === csv.id);
      await refused("a completed reconciliation's statement is still not replaced", replace,
        [forward, "x.pdf", "[]", kept.id], "not in progress");

      // ---- an import's file, set once
      const imported = await one(`select * from acc_import_bank_statement($1, 'example-may.pdf', $2::jsonb)`, [
        bank,
        JSON.stringify([{
          txn_date: "2026-05-10", description: "DEPOSIT", reference: null, amount_minor: 1000,
          running_balance_minor: 1000, raw_line: "", raw_hash: sha(`line ${randomUUID()}`), source: "file_upload",
        }]),
      ]);
      check("the import made a batch", typeof imported.batch_id === "string");
      const link = `select acc_link_import_batch_statement_file($1, $2)`;
      await one(link, [imported.batch_id, kept.id]);
      const listed = await one(`select statement_file_id from acc_bank_statement_imports($1) where id = $2`, [bank, imported.batch_id]);
      check("the statement imports list names its file", listed?.statement_file_id === kept.id);
      await one(link, [imported.batch_id, kept.id]);
      check("linking the same file again changes nothing", true);
      await refused("an import with a file does not take another", link, [imported.batch_id, ofx.id], "already has its statement file");
      await refused("a direct update cannot swap an import's file", `update acc_bank_import_batch set statement_file_id = $2 where id = $1`,
        [imported.batch_id, ofx.id], "OneBook's own steps");

      // ---- evidence is not archived away
      const archive = `select acc_archive_saved_report($1, 'verify')`;
      await refused("a reconciliation's file cannot be archived", archive, [kept.id], "statement of the reconciliation to May 31, 2026");
      await refused("…and the message says it stays", archive, [kept.id], "it stays");
      await refused("a completed reconciliation's file cannot be archived", archive, [csv.id], "reconciliation to Apr 30, 2026");
      const batchOnly = (await one(keep, ["Batch only", "b.pdf", path("pdf"), "application/pdf", 10, sha(randomUUID())])).r;
      const imported2 = await one(`select * from acc_import_bank_statement($1, 'b.pdf', $2::jsonb)`, [
        bank,
        JSON.stringify([{
          txn_date: "2026-05-11", description: "FEE", reference: null, amount_minor: -100,
          running_balance_minor: null, raw_line: "", raw_hash: sha(`line ${randomUUID()}`), source: "file_upload",
        }]),
      ]);
      await one(link, [imported2.batch_id, batchOnly.id]);
      await refused("an import's file cannot be archived", archive, [batchOnly.id], "statement imported on");
      await one(archive, [ofx.id]);
      check("a file nothing points at can be archived", (await one(`select status from acc_saved_report where id = $1`, [ofx.id])).status === "archived");
      await refused("an archived file is not attached", attach, [forward, ofx.id], "not kept here");

      // ---- grants: asked of the catalog, because anon cannot even see a company's schema
      await client.query("reset role");
      const grants = await one(
        `select has_function_privilege('anon', 'acc_keep_statement_file(text, date, date, text, text, text, int, text)', 'execute')
             or has_function_privilege('anon', 'acc_link_reconciliation_statement_file(uuid, uuid)', 'execute')
             or has_function_privilege('anon', 'acc_link_import_batch_statement_file(uuid, uuid)', 'execute')
             or has_function_privilege('anon', 'acc_saved_report_path_is_ours(text)', 'execute')
             or has_function_privilege('anon', 'acc_create_reconciliation_from_statement(uuid, date, bigint, text, bigint, jsonb, uuid)', 'execute')
             or has_function_privilege('anon', 'acc_set_reconciliation_statement(uuid, text, bigint, bigint, jsonb, uuid)', 'execute')
             or has_function_privilege('anon', 'acc_bank_statement_imports(uuid)', 'execute') as anon,
                has_function_privilege('authenticated', 'acc_keep_statement_file(text, date, date, text, text, text, int, text)', 'execute')
            and has_function_privilege('authenticated', 'acc_link_reconciliation_statement_file(uuid, uuid)', 'execute')
            and has_function_privilege('authenticated', 'acc_link_import_batch_statement_file(uuid, uuid)', 'execute')
            and has_function_privilege('authenticated', 'acc_create_reconciliation_from_statement(uuid, date, bigint, text, bigint, jsonb, uuid)', 'execute')
            and has_function_privilege('authenticated', 'acc_set_reconciliation_statement(uuid, text, bigint, bigint, jsonb, uuid)', 'execute')
            and has_function_privilege('authenticated', 'acc_bank_statement_imports(uuid)', 'execute') as signed_in,
                has_function_privilege('authenticated', 'acc_statement_file_is_kept(uuid)', 'execute') as internal`,
      );
      check("closed to anon, open to signed-in users", grants.anon === false && grants.signed_in === true, JSON.stringify(grants));
      check("the kept-file check is internal", grants.internal === false);
      const shapes = await one(
        `select count(*) filter (where proname = 'acc_create_reconciliation_from_statement')::int as created,
                count(*) filter (where proname = 'acc_set_reconciliation_statement')::int as set
           from pg_proc where pronamespace = $1::regnamespace`,
        [schema],
      );
      check("one shape each of the two statement functions", shapes.created === 1 && shapes.set === 1, JSON.stringify(shapes));
    } finally {
      await client.query("rollback");
    }
  }
} finally {
  clearTimeout(killer);
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

Create `tests/unit/keep-statement-files-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0135_keep_statement_files.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", FILE), "utf8");
/** The migration without its prose, so naming a thing in a comment never reads as doing it. */
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

describe("0135_keep_statement_files", () => {
  it("never posts: keeping a file moves no balance", () => {
    expect(code).not.toMatch(/acc_post_entry/);
    expect(code).not.toMatch(/insert\s+into\s+acc_journal_(entry|line)/i);
  });

  it("grants no storage policy to a browser session", () => {
    expect(code).not.toMatch(/create policy[\s\S]{0,200}on storage\.objects/i);
  });

  it("checks the folder in both functions that register a file", () => {
    for (const fn of ["acc_register_saved_report", "acc_keep_statement_file"]) {
      const body = code.slice(code.indexOf(`create or replace function ${fn}(`));
      expect(body.slice(0, body.indexOf("$$;")), fn).toMatch(/acc_saved_report_path_is_ours\(p_storage_path\)/);
    }
  });

  it("checks the folder against the schema the function runs in, not a register it cannot read", () => {
    expect(code).toMatch(/split_part\(p_path, '\/', 1\) = current_schema\(\)/);
    expect(code).not.toMatch(/onebook\./);
  });

  it("closes every function it grants to anon", () => {
    const granted = [...code.matchAll(/grant execute on function (acc_\w+)\(/g)].map((m) => m[1]);
    expect(granted.length).toBeGreaterThan(5);
    for (const fn of granted) {
      expect(code, fn).toMatch(new RegExp(`revoke all on function ${fn}\\([^)]*\\) from public, anon`));
    }
  });

  it("sets the file pointer only behind the trigger's gate", () => {
    const opened = code.match(/set_config\('acc\.statement_file_change', 'on', true\)/g) ?? [];
    const closed = code.match(/set_config\('acc\.statement_file_change', '', true\)/g) ?? [];
    expect(opened.length).toBe(4);
    expect(closed.length).toBe(opened.length);
  });

  it("holds the bucket change back from company schemas and runs everything else in each", () => {
    const plan = planCompanySchema([{ file: FILE, sql }], "co_example");
    expect(plan.skipped.map((s) => s.sql).join("\n")).toMatch(/update storage\.buckets/);
    expect(plan.statements.join("\n")).toMatch(/set search_path = co_example/);
    expect(plan.statements.join("\n")).not.toMatch(/storage\.buckets/);
  });
});
```

- [ ] **Step 2: Run them — they fail.**

Run: `node --env-file=.env.local scripts/verify-statement-files.mjs`
Expected: it stops with `ENOENT` (the migration file does not exist yet).
Run: `npx vitest run tests/unit/keep-statement-files-migration.test.ts`
Expected: FAIL — `ENOENT` for `0135_keep_statement_files.sql`.

- [ ] **Step 3: The migration.** Create `supabase/migrations/0135_keep_statement_files.sql`:

```sql
-- ============================================================================
-- 1.83 — the statement file kept as evidence beside what was read from it.
--
-- OneBook read a bank's statement and kept what it read — the lines, the
-- balances, the file's name — but not the file, which stayed in the browser. A
-- reconciliation could not show the bank's own document it was reconciled
-- against. Now every statement read is kept in the Reports › Saved store
-- (migration 0101, source "Bank"), once per file, and the reconciliation or the
-- import read from it points at it.
--
-- The store is not virus-scanned (0101 says so); the app never hands a kept file
-- to the browser to open — a PDF is drawn as images, text is shown as text.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A bank's own download (OFX, QFX, QBO, QIF) is text; it is kept as text/plain.
-- ----------------------------------------------------------------------------
alter table acc_saved_report drop constraint if exists acc_saved_report_mime_type_check;
alter table acc_saved_report add constraint acc_saved_report_mime_type_check check (mime_type in (
  'text/csv',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'text/plain'
));

update storage.buckets
   set allowed_mime_types = array[
     'text/csv',
     'application/pdf',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'image/png',
     'image/jpeg',
     'text/plain'
   ]::text[]
 where id = 'onebook-reports';

-- ----------------------------------------------------------------------------
-- 2. What points at a kept statement file. Only the functions below set it:
--    staff may write these rows directly, and evidence must not be set or
--    swapped without the checks and the audit line those functions make. Each
--    of them opens the trigger's gate for its own write and closes it again.
-- ----------------------------------------------------------------------------
alter table acc_statement_reconciliation
  add column if not exists statement_file_id uuid references acc_saved_report (id);
alter table acc_bank_import_batch
  add column if not exists statement_file_id uuid references acc_saved_report (id);

create index if not exists acc_statement_reconciliation_file_idx
  on acc_statement_reconciliation (statement_file_id) where statement_file_id is not null;
create index if not exists acc_bank_import_batch_file_idx
  on acc_bank_import_batch (statement_file_id) where statement_file_id is not null;

create or replace function acc_statement_file_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('acc.statement_file_change', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.statement_file_id is null then return new; end if;
  elsif new.statement_file_id is not distinct from old.statement_file_id then
    return new;
  end if;
  raise exception 'A statement file is kept with a record only through OneBook''s own steps';
end;
$$;

drop trigger if exists acc_statement_reconciliation_file_guard on acc_statement_reconciliation;
create trigger acc_statement_reconciliation_file_guard
  before insert or update of statement_file_id on acc_statement_reconciliation
  for each row execute function acc_statement_file_guard();

drop trigger if exists acc_bank_import_batch_file_guard on acc_bank_import_batch;
create trigger acc_bank_import_batch_file_guard
  before insert or update of statement_file_id on acc_bank_import_batch
  for each row execute function acc_statement_file_guard();

-- ----------------------------------------------------------------------------
-- 3. A kept file lives in this company's own folder: '<schema>/<uuid>.<ext>'.
--    The schema is the folder because a company's functions cannot read the
--    company register, but always know which schema they run in.
-- ----------------------------------------------------------------------------
create or replace function acc_saved_report_path_is_ours(p_path text) returns boolean
language sql stable set search_path = public as $$
  select coalesce(
    p_path ~ '^[a-z0-9_]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]{2,5}$'
      and split_part(p_path, '/', 1) = current_schema(),
    false);
$$;

revoke all on function acc_saved_report_path_is_ours(text) from public, anon;
grant execute on function acc_saved_report_path_is_ours(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Registering a saved report now refuses a path outside this company's
--    folder. Otherwise as 0101 left it.
-- ----------------------------------------------------------------------------
create or replace function acc_register_saved_report(
  p_title        text,
  p_source       text,
  p_period_start date,
  p_period_end   date,
  p_notes        text,
  p_file_name    text,
  p_storage_path text,
  p_mime_type    text,
  p_size_bytes   int,
  p_sha256       text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not acc_has_permission('documents.manage') then
    raise exception 'Not authorized to save a report';
  end if;
  if not acc_saved_report_path_is_ours(p_storage_path) then
    raise exception 'A report must be saved in this company''s own folder';
  end if;

  if exists (select 1 from acc_saved_report
              where sha256 = p_sha256 and status = 'active') then
    raise exception 'This report is already saved (%)',
      (select title from acc_saved_report
        where sha256 = p_sha256 and status = 'active' limit 1);
  end if;

  insert into acc_saved_report (
    title, source, period_start, period_end, notes,
    file_name, storage_path, mime_type, size_bytes, sha256, uploaded_by
  ) values (
    btrim(p_title), p_source, p_period_start, p_period_end,
    nullif(btrim(coalesce(p_notes, '')), ''),
    btrim(p_file_name), p_storage_path, p_mime_type, p_size_bytes, p_sha256, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Keep a statement file — or find it kept already. The same file (same
--    SHA-256) is kept once; a CSV year read into twelve reconciliations is one
--    file. Two people keeping the same file at once still give one row.
-- ----------------------------------------------------------------------------
create or replace function acc_keep_statement_file(
  p_title        text,
  p_period_start date,
  p_period_end   date,
  p_file_name    text,
  p_storage_path text,
  p_mime_type    text,
  p_size_bytes   int,
  p_sha256       text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not acc_has_permission('documents.manage') then
    raise exception 'Not authorized to keep a statement file';
  end if;
  if p_mime_type not in ('application/pdf', 'text/csv', 'text/plain') then
    raise exception 'A statement file is a PDF, a CSV or a bank download';
  end if;

  select id into v_id from acc_saved_report where sha256 = p_sha256 and status = 'active';
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'reused', true);
  end if;
  if not acc_saved_report_path_is_ours(p_storage_path) then
    raise exception 'A statement file must be kept in this company''s own folder';
  end if;

  begin
    insert into acc_saved_report (
      title, source, period_start, period_end, notes,
      file_name, storage_path, mime_type, size_bytes, sha256, uploaded_by
    ) values (
      left(btrim(p_title), 200), 'bank', p_period_start, p_period_end,
      'Kept as the statement OneBook read it from.',
      btrim(p_file_name), p_storage_path, p_mime_type, p_size_bytes, p_sha256, auth.uid()
    )
    returning id into v_id;
  exception when unique_violation then
    -- Another session kept the same file a moment ago.
    select id into v_id from acc_saved_report where sha256 = p_sha256 and status = 'active';
    if v_id is null then raise; end if;
    return jsonb_build_object('id', v_id, 'reused', true);
  end;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_saved_report', v_id, 'keep_statement_file', auth.uid(),
          jsonb_build_object('file_name', btrim(p_file_name), 'sha256', p_sha256));
  return jsonb_build_object('id', v_id, 'reused', false);
end;
$$;

revoke all on function acc_keep_statement_file(text, date, date, text, text, text, int, text) from public, anon;
grant execute on function acc_keep_statement_file(text, date, date, text, text, text, int, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. A reconciliation's file goes with its statement lines.
--
--    Started from a statement (1.79, 1.81), it is made with its file. Importing
--    another statement into one in progress replaces its kept lines and its file
--    together — with no file when the new one could not be kept, so the file it
--    shows is always the one its lines were read from. Both functions gain a
--    last argument; the old shapes go first so a call cannot match two.
-- ----------------------------------------------------------------------------
create or replace function acc_statement_file_is_kept(p_file_id uuid) returns void
language plpgsql stable set search_path = public as $$
begin
  if p_file_id is not null
     and not exists (select 1 from acc_saved_report where id = p_file_id and status = 'active') then
    raise exception 'That statement file is not kept here';
  end if;
end;
$$;
revoke all on function acc_statement_file_is_kept(uuid) from public, anon, authenticated;

drop function if exists acc_create_reconciliation_from_statement(uuid, date, bigint, text, bigint, jsonb);
create or replace function acc_create_reconciliation_from_statement(
  p_bank_account_id uuid, p_ending_date date, p_ending_minor bigint,
  p_file_name text, p_opening_minor bigint, p_lines jsonb,
  p_statement_file_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform acc_statement_file_is_kept(p_statement_file_id);
  v_id := acc_create_reconciliation(p_bank_account_id, p_ending_date, p_ending_minor);
  perform set_config('acc.statement_file_change', 'on', true);
  update acc_statement_reconciliation
     set statement_ref = nullif(left(btrim(coalesce(p_file_name, '')), 255), ''),
         statement_opening_minor = p_opening_minor,
         statement_closing_minor = p_ending_minor,
         statement_file_id = p_statement_file_id,
         updated_at = now()
   where id = v_id;
  perform set_config('acc.statement_file_change', '', true);
  perform acc_recon_write_statement(v_id, p_lines);
  if p_statement_file_id is not null then
    insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_statement_reconciliation', v_id, 'statement_file', auth.uid(),
            jsonb_build_object('statement_file_id', p_statement_file_id));
  end if;
  return v_id;
end;
$$;
revoke all on function acc_create_reconciliation_from_statement(uuid, date, bigint, text, bigint, jsonb, uuid) from public, anon;
grant execute on function acc_create_reconciliation_from_statement(uuid, date, bigint, text, bigint, jsonb, uuid)
  to authenticated, service_role;

drop function if exists acc_set_reconciliation_statement(uuid, text, bigint, bigint, jsonb);
create or replace function acc_set_reconciliation_statement(
  p_reconciliation_id uuid, p_file_name text, p_opening_minor bigint, p_closing_minor bigint, p_lines jsonb,
  p_statement_file_id uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  perform acc_statement_file_is_kept(p_statement_file_id);
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;
  perform set_config('acc.statement_file_change', 'on', true);
  update acc_statement_reconciliation
     set statement_ref = nullif(left(btrim(coalesce(p_file_name, '')), 255), ''),
         statement_opening_minor = p_opening_minor,
         statement_closing_minor = p_closing_minor,
         statement_file_id = p_statement_file_id,
         updated_at = now()
   where id = p_reconciliation_id;
  perform set_config('acc.statement_file_change', '', true);
  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'update', auth.uid(),
            jsonb_build_object('statement_file_id', v_rec.statement_file_id),
            jsonb_build_object('statement_file_id', p_statement_file_id));
  return acc_recon_write_statement(p_reconciliation_id, p_lines);
end;
$$;
revoke all on function acc_set_reconciliation_statement(uuid, text, bigint, bigint, jsonb, uuid) from public, anon;
grant execute on function acc_set_reconciliation_statement(uuid, text, bigint, bigint, jsonb, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Attach the statement later — to a reconciliation that has none, in
--    progress or completed: attaching evidence changes none of its figures.
--    The app checks first that the file reads to this reconciliation's
--    statement; this function sets a file only where there is none.
--    And an import's file, set once.
-- ----------------------------------------------------------------------------
create or replace function acc_link_reconciliation_statement_file(p_reconciliation_id uuid, p_file_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rec acc_statement_reconciliation;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change a reconciliation';
  end if;
  if p_file_id is null then raise exception 'Choose the statement file'; end if;
  perform acc_statement_file_is_kept(p_file_id);
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.statement_file_id = p_file_id then return; end if;
  if v_rec.statement_file_id is not null then
    raise exception 'This reconciliation already has its statement file';
  end if;

  perform set_config('acc.statement_file_change', 'on', true);
  update acc_statement_reconciliation
     set statement_file_id = p_file_id, updated_at = now()
   where id = p_reconciliation_id;
  perform set_config('acc.statement_file_change', '', true);

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_statement_reconciliation', p_reconciliation_id, 'statement_file', auth.uid(),
          jsonb_build_object('statement_file_id', p_file_id));
end;
$$;

create or replace function acc_link_import_batch_statement_file(p_batch_id uuid, p_file_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_batch acc_bank_import_batch;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change a statement import';
  end if;
  if p_file_id is null then raise exception 'Choose the statement file'; end if;
  perform acc_statement_file_is_kept(p_file_id);
  select * into v_batch from acc_bank_import_batch where id = p_batch_id for update;
  if not found then raise exception 'Statement import not found'; end if;
  if v_batch.statement_file_id = p_file_id then return; end if;
  if v_batch.statement_file_id is not null then
    raise exception 'This import already has its statement file';
  end if;

  perform set_config('acc.statement_file_change', 'on', true);
  update acc_bank_import_batch set statement_file_id = p_file_id where id = p_batch_id;
  perform set_config('acc.statement_file_change', '', true);

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_bank_import_batch', p_batch_id, 'statement_file', auth.uid(),
          jsonb_build_object('statement_file_id', p_file_id));
end;
$$;

revoke all on function acc_link_reconciliation_statement_file(uuid, uuid) from public, anon;
grant execute on function acc_link_reconciliation_statement_file(uuid, uuid) to authenticated, service_role;
revoke all on function acc_link_import_batch_statement_file(uuid, uuid) from public, anon;
grant execute on function acc_link_import_batch_statement_file(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. A file that is a reconciliation's or an import's statement is not archived
--    away. Otherwise as 0101 left it.
-- ----------------------------------------------------------------------------
create or replace function acc_archive_saved_report(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_date date;
begin
  if not acc_has_permission('documents.manage') then
    raise exception 'Not authorized to archive a report';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this report is being archived';
  end if;

  select statement_ending_date into v_date
    from acc_statement_reconciliation where statement_file_id = p_id
   order by statement_ending_date desc limit 1;
  if v_date is not null then
    raise exception 'This file is the statement of the reconciliation to % — it stays',
      to_char(v_date, 'Mon FMDD, YYYY');
  end if;
  select imported_at::date into v_date
    from acc_bank_import_batch where statement_file_id = p_id
   order by imported_at desc limit 1;
  if v_date is not null then
    raise exception 'This file is the statement imported on % — it stays',
      to_char(v_date, 'Mon FMDD, YYYY');
  end if;

  update acc_saved_report
     set status = 'archived',
         archived_by = auth.uid(),
         archived_at = now(),
         archive_reason = btrim(p_reason)
   where id = p_id and status = 'active';

  if not found then
    raise exception 'Report not found, or already archived';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Statement imports list their file. A returns-table function cannot change
--    shape in place, so the old one goes first. Otherwise as 0109 left it.
-- ----------------------------------------------------------------------------
drop function if exists acc_bank_statement_imports(uuid);

create or replace function acc_bank_statement_imports(p_bank_account_id uuid default null)
returns table (
  id uuid, bank_account_id uuid, account_code text, account_name text,
  filename text, row_count int, lines_here int, locked_lines int,
  imported_at timestamptz, status text, voided_at timestamptz, void_reason text,
  statement_file_id uuid
)
language sql stable security definer set search_path = public as $$
  select b.id, b.bank_account_id, a.account_code, a.name,
         b.filename, b.row_count,
         (select count(*)::int from acc_bank_transaction t where t.import_batch_id = b.id),
         acc_bank_import_batch_locked_lines(b.id),
         b.imported_at, b.status, b.voided_at, b.void_reason,
         b.statement_file_id
    from acc_bank_import_batch b
    join acc_bank_account ba on ba.id = b.bank_account_id
    join acc_account a on a.id = ba.account_id
   where p_bank_account_id is null or b.bank_account_id = p_bank_account_id
   order by b.imported_at desc
   limit 20;
$$;

revoke all on function acc_bank_statement_imports(uuid) from public, anon;
grant execute on function acc_bank_statement_imports(uuid) to authenticated, service_role;
```

- [ ] **Step 4: Run both again.**

Run: `node --env-file=.env.local scripts/verify-statement-files.mjs`
Expected: every company prints `(0135 applied inside the transaction, never committed)`; companies without a viewer print `(no viewer in this company; the outsider check stands in)`; the last line reads `313 passed, 0 failed`. Nothing is committed to the database: every company's transaction is rolled back.
Run: `npx vitest run tests/unit/keep-statement-files-migration.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit.**

```bash
git add supabase/migrations/0135_keep_statement_files.sql scripts/verify-statement-files.mjs tests/unit/keep-statement-files-migration.test.ts
printf 'feat(db): 0135 keep the statement file beside what was read from it\n\nBank downloads kept as text, a file kept once per SHA-256 and only in the\ncompany'"'"'s own folder, reconciliations and imports pointing at it behind a\ntrigger, attaching later only where there is none, and no archiving of a\nfile in use. Verified in rolled-back transactions on every company.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 2: What a kept file is, in the domain

**Files:**
- Create: `lib/domain/statement-evidence.ts`
- Create: `tests/unit/statement-evidence.test.ts`
- Modify: `lib/domain/saved-reports.ts` (three edits)
- Modify: `tests/unit/saved-reports.test.ts` (three edits)

**Interfaces:**
- Consumes: `periodLabel`, `shortDate` from `lib/domain/pdf-statement-view.ts`; `SAVED_REPORT_MAX_BYTES` from `lib/domain/saved-reports.ts`.
- Produces:
  - `lib/domain/statement-evidence.ts`: `STATEMENT_FILE_MIME_TYPES`, `StatementFileMime`, `statementFileMime(fileName, browserType?)`, `statementFileRefusal(file)`, `StatementPeriod {from,to}`, `statementFileSpan(periods)`, `linesSpan(lines)`, `statementFileAccount(name, maskedNumber)`, `statementFileTitle(account, period)`, `shortSha(sha256)`, `KeepFailureWhere`, `keepFailureMessage(reason, where)`, `EvidenceLine`, `ReadStatementFile`, `EvidenceTarget`, `statementFileMismatch(read, target, money): string | null`, `statementFileKeepSchema` / `StatementFileKeepInput`, `statementFileAttachSchema` / `StatementFileAttachInput`;
  - `lib/domain/saved-reports.ts`: `savedReportStoragePath(folder, mimeType, objectId)` (the folder is the company's schema), `text/plain` → `.txt`, `SavedReportView = "pdf" | "table" | "text" | "download"`, `savedReportView(mimeType)`.

- [ ] **Step 1: The tests.** Create `tests/unit/statement-evidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  keepFailureMessage,
  linesSpan,
  shortSha,
  statementFileAccount,
  statementFileAttachSchema,
  statementFileKeepSchema,
  statementFileMime,
  statementFileMismatch,
  statementFileRefusal,
  statementFileSpan,
  statementFileTitle,
  type EvidenceTarget,
} from "@/lib/domain/statement-evidence";

const money = (minor: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);

describe("statementFileMime", () => {
  it("keeps a PDF as a PDF and a CSV as a CSV", () => {
    expect(statementFileMime("may.pdf")).toBe("application/pdf");
    expect(statementFileMime("MAY.PDF")).toBe("application/pdf");
    expect(statementFileMime("may.csv")).toBe("text/csv");
  });

  it("keeps every bank download as text, whatever type the browser gave it", () => {
    for (const name of ["a.ofx", "a.qfx", "a.qbo", "a.qif", "A.QFX"]) {
      expect(statementFileMime(name, "application/vnd.intu.qfx")).toBe("text/plain");
    }
  });

  it("falls back to the browser's type only when it is one the store keeps", () => {
    expect(statementFileMime("statement", "application/pdf")).toBe("application/pdf");
    expect(statementFileMime("statement", "application/x-msdownload")).toBeNull();
    expect(statementFileMime("statement.xlsx")).toBeNull();
  });
});

describe("statementFileRefusal", () => {
  it("lets a statement file through", () => {
    expect(statementFileRefusal({ name: "may.pdf", size: 2048 })).toBeNull();
  });

  it("says why a file cannot be kept", () => {
    expect(statementFileRefusal({ name: "may.pdf", size: 0 })).toBe("the file is empty");
    expect(statementFileRefusal({ name: "may.pdf", size: 10_485_761 })).toBe("it is larger than 10 MB");
    expect(statementFileRefusal({ name: `${"x".repeat(252)}.pdf`, size: 1 })).toBe("its name is longer than 255 characters");
    expect(statementFileRefusal({ name: "may.xlsx", size: 1 })).toBe("OneBook keeps PDF, CSV, OFX, QFX, QBO and QIF statement files");
  });

  it("allows exactly 10 MB", () => {
    expect(statementFileRefusal({ name: "may.pdf", size: 10_485_760 })).toBeNull();
  });
});

describe("statementFileSpan and linesSpan", () => {
  it("runs from the earliest first day to the latest last day", () => {
    expect(
      statementFileSpan([
        { from: "2026-06-01", to: "2026-06-30" },
        { from: "2026-04-01", to: "2026-04-30" },
        { from: null, to: "2026-05-31" },
      ]),
    ).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });

  it("is empty when nothing printed a period", () => {
    expect(statementFileSpan([{ from: null, to: null }])).toEqual({ from: null, to: null });
    expect(linesSpan([])).toEqual({ from: null, to: null });
  });

  it("takes a file of lines from its first to its last date", () => {
    expect(linesSpan([{ txn_date: "2026-05-09" }, { txn_date: "2026-05-02" }, { txn_date: "2026-05-30" }])).toEqual({
      from: "2026-05-02",
      to: "2026-05-30",
    });
  });
});

describe("statementFileAccount", () => {
  it("names the bank and the account's last digits", () => {
    expect(statementFileAccount("Example Bank", "****1183")).toBe("Example Bank ****1183");
  });

  it("leaves out a number the account does not have", () => {
    expect(statementFileAccount(" Operating ", null)).toBe("Operating");
  });
});

describe("statementFileTitle", () => {
  it("names the account and the statement's period", () => {
    expect(statementFileTitle("Example Bank ****1183", { from: "2026-05-01", to: "2026-05-31" })).toBe(
      "Example Bank ****1183 — statement May 1 – May 31, 2026",
    );
  });

  it("names a statement that printed only its closing day", () => {
    expect(statementFileTitle("Example Bank", { from: null, to: "2026-05-31" })).toBe(
      "Example Bank — statement closing May 31, 2026",
    );
  });

  it("still has a title when no period was read", () => {
    expect(statementFileTitle("  ", { from: null, to: null })).toBe("Bank account — statement file");
  });

  it("fits the store's 200 characters", () => {
    expect(statementFileTitle("x".repeat(300), { from: null, to: null })).toHaveLength(200);
  });
});

describe("shortSha", () => {
  it("prints the first 12 characters", () => {
    expect(shortSha("0123456789abcdef".repeat(4))).toBe("0123456789ab");
  });
});

describe("keepFailureMessage", () => {
  it("points a reconciliation to Attach the statement", () => {
    expect(keepFailureMessage("it is larger than 10 MB", "reconciliation")).toBe(
      "The statement file could not be kept: it is larger than 10 MB. Attach it on the reconciliation.",
    );
  });

  it("says an import went on without its file", () => {
    expect(keepFailureMessage("Failed to fetch.", "import")).toBe(
      "The statement file could not be kept: Failed to fetch. Its lines were imported without it.",
    );
  });

  it("never prints an empty reason", () => {
    expect(keepFailureMessage("  ", "import")).toBe(
      "The statement file could not be kept: an unexpected error occurred. Its lines were imported without it.",
    );
  });
});

describe("statementFileMismatch", () => {
  const MAY: EvidenceTarget = {
    endingDate: "2026-05-31",
    endingMinor: 616001,
    keptLines: [
      { txn_date: "2026-05-04", amount_minor: -1200 },
      { txn_date: "2026-05-15", amount_minor: 50000 },
    ],
  };

  it("matches the statement it was reconciled against", () => {
    const read = { to: "2026-05-31", closingMinor: 616001, lines: MAY.keptLines };
    expect(statementFileMismatch(read, MAY, money)).toBeNull();
  });

  it("refuses another month's statement, saying both", () => {
    const read = { to: "2026-06-30", closingMinor: 659501, lines: MAY.keptLines };
    expect(statementFileMismatch(read, MAY, money)).toBe(
      "This file's statement closes Jun 30, 2026 at $6,595.01; this reconciliation is to May 31, 2026 at $6,160.01.",
    );
  });

  it("refuses a statement of the same day that closes at another balance", () => {
    const read = { to: "2026-05-31", closingMinor: 616000, lines: MAY.keptLines };
    expect(statementFileMismatch(read, MAY, money)).toMatch(/closes May 31, 2026 at \$6,160\.00; this reconciliation is to May 31, 2026 at \$6,160\.01/);
  });

  it("refuses a statement whose lines differ, naming the first that does", () => {
    const read = {
      to: "2026-05-31",
      closingMinor: 616001,
      lines: [
        { txn_date: "2026-05-04", amount_minor: -1500 },
        { txn_date: "2026-05-15", amount_minor: 50000 },
      ],
    };
    expect(statementFileMismatch(read, MAY, money)).toBe(
      "Line 1 differs: the file has May 4, 2026 at -$15.00; this reconciliation kept May 4, 2026 at -$12.00.",
    );
  });

  it("refuses a statement with a line more or less", () => {
    const read = { to: "2026-05-31", closingMinor: 616001, lines: MAY.keptLines.slice(0, 1) };
    expect(statementFileMismatch(read, MAY, money)).toBe(
      "This file has 1 line from May 4, 2026 to May 31, 2026; this reconciliation kept 2 lines from its statement.",
    );
  });

  it("ignores a line of no amount, which was never kept", () => {
    const read = { to: "2026-05-31", closingMinor: 616001, lines: [...MAY.keptLines, { txn_date: "2026-05-20", amount_minor: 0 }] };
    expect(statementFileMismatch(read, MAY, money)).toBeNull();
  });

  it("matches a bank download that prints no balance by its lines alone", () => {
    expect(statementFileMismatch({ to: null, closingMinor: null, lines: MAY.keptLines }, MAY, money)).toBeNull();
  });

  it("matches the month of a CSV that runs over several months", () => {
    const lines = [
      { txn_date: "2026-04-28", amount_minor: 700 },
      ...MAY.keptLines,
      { txn_date: "2026-06-02", amount_minor: -300 },
    ];
    expect(statementFileMismatch({ to: null, closingMinor: null, lines }, MAY, money)).toBeNull();
  });

  it("refuses a bank download whose lines are not the kept ones", () => {
    const lines = [{ txn_date: "2026-05-04", amount_minor: -1200 }];
    expect(statementFileMismatch({ to: null, closingMinor: null, lines }, MAY, money)).toMatch(/^This file has 1 line /);
  });

  it("needs a closing balance when the reconciliation kept no lines", () => {
    const byHand: EvidenceTarget = { ...MAY, keptLines: [] };
    expect(statementFileMismatch({ to: null, closingMinor: null, lines: MAY.keptLines }, byHand, money)).toBe(
      "This file does not show the statement's closing balance, so it cannot be matched to this reconciliation. Attach the bank's PDF statement for May 31, 2026.",
    );
    expect(statementFileMismatch({ to: "2026-05-31", closingMinor: 616001, lines: [] }, byHand, money)).toBeNull();
  });
});

describe("statementFileKeepSchema", () => {
  const valid = {
    title: "Example Bank — statement May 1 – May 31, 2026",
    period_start: "2026-05-01",
    period_end: "2026-05-31",
    file_name: "may.pdf",
    storage_path: "co_example/aaaabbbb-cccc-4ddd-8eee-ffff00001111.pdf",
    mime_type: "application/pdf",
    size_bytes: 2048,
    sha256: "a".repeat(64),
  };

  it("accepts a statement file", () => {
    expect(statementFileKeepSchema.safeParse(valid).success).toBe(true);
    expect(statementFileKeepSchema.safeParse({ ...valid, mime_type: "text/plain" }).success).toBe(true);
  });

  it("refuses a type the store does not keep for statements, a bad digest, and a period backwards", () => {
    expect(statementFileKeepSchema.safeParse({ ...valid, mime_type: "image/png" }).success).toBe(false);
    expect(statementFileKeepSchema.safeParse({ ...valid, sha256: "xyz" }).success).toBe(false);
    expect(statementFileKeepSchema.safeParse({ ...valid, period_start: "2026-06-01" }).success).toBe(false);
  });
});

describe("statementFileAttachSchema", () => {
  it("accepts what was read and refuses a line without a whole amount", () => {
    const base = {
      reconciliation_id: "aaaabbbb-cccc-4ddd-8eee-ffff00001111",
      file_id: "bbbbcccc-dddd-4eee-8fff-000011112222",
      to: "2026-05-31",
      closing_minor: 616001,
      lines: [{ txn_date: "2026-05-04", amount_minor: -1200 }],
    };
    expect(statementFileAttachSchema.safeParse(base).success).toBe(true);
    expect(statementFileAttachSchema.safeParse({ ...base, lines: [{ txn_date: "2026-05-04", amount_minor: 1.5 }] }).success).toBe(false);
  });
});
```

In `tests/unit/saved-reports.test.ts` apply these edits:

Edit 1 of 3 — find:

```ts
  savedReportRegisterSchema,
  savedReportArchiveSchema,
  savedReportStoragePath,
  validateSavedReportFile,
  SAVED_REPORT_MAX_BYTES,
} from "@/lib/domain/saved-reports";
```

replace with:

```ts
  savedReportRegisterSchema,
  savedReportArchiveSchema,
  savedReportStoragePath,
  savedReportView,
  validateSavedReportFile,
  SAVED_REPORT_MAX_BYTES,
} from "@/lib/domain/saved-reports";
```

Edit 2 of 3 — find:

```ts
});

describe("savedReportStoragePath", () => {
  it("puts the company first so an object can be traced back from the bucket", () => {
    const path = savedReportStoragePath(
      "6d0f1e2a-1111-4222-8333-444455556666",
      "text/csv",
      "aaaabbbb-cccc-4ddd-8eee-ffff00001111",
    );
    expect(path).toBe(
      "6d0f1e2a-1111-4222-8333-444455556666/aaaabbbb-cccc-4ddd-8eee-ffff00001111.csv",
    );
  });

  it("uses the extension the mime type implies, not the one the file claimed", () => {
```

replace with:

```ts
});

describe("savedReportStoragePath", () => {
  it("puts the company's schema first so an object can be traced back from the bucket", () => {
    const path = savedReportStoragePath(
      "co_example",
      "text/csv",
      "aaaabbbb-cccc-4ddd-8eee-ffff00001111",
    );
    expect(path).toBe("co_example/aaaabbbb-cccc-4ddd-8eee-ffff00001111.csv");
  });

  it("keeps a bank download as text", () => {
    expect(savedReportStoragePath("public", "text/plain", "o")).toBe("public/o.txt");
  });

  it("uses the extension the mime type implies, not the one the file claimed", () => {
```

Edit 3 of 3 — find:

```ts
  });
});

describe("isTabularSavedReport", () => {
  it("is true only for the format the viewer can actually render", () => {
    expect(isTabularSavedReport("text/csv")).toBe(true);
```

replace with:

```ts
  });
});

describe("savedReportView", () => {
  it("draws a PDF, tables a CSV, shows a bank download as text, and only downloads the rest", () => {
    expect(savedReportView("application/pdf")).toBe("pdf");
    expect(savedReportView("text/csv")).toBe("table");
    expect(savedReportView("text/plain")).toBe("text");
    expect(savedReportView("image/png")).toBe("download");
    expect(
      savedReportView("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe("download");
  });
});

describe("isTabularSavedReport", () => {
  it("is true only for the format the viewer can actually render", () => {
    expect(isTabularSavedReport("text/csv")).toBe(true);
```

- [ ] **Step 2: Run them — they fail.**

Run: `npx vitest run tests/unit/statement-evidence.test.ts tests/unit/saved-reports.test.ts`
Expected: FAIL — `@/lib/domain/statement-evidence` cannot be resolved, and `savedReportView` is not exported.

- [ ] **Step 3: The modules.** Create `lib/domain/statement-evidence.ts`:

```ts
/**
 * The statement file kept beside what was read from it (1.83).
 *
 * Pure, so the wording is tested where it is written: which files are kept and
 * as what, what a kept file is called, whether a file chosen later is the
 * statement a reconciliation was reconciled against, and what is said when a
 * file cannot be kept.
 */
import { z } from "zod";
import { periodLabel, shortDate } from "./pdf-statement-view";
import { SAVED_REPORT_MAX_BYTES } from "./saved-reports";

/** A bank's own download (OFX, QFX, QBO, QIF) is text, and kept as text. */
export const STATEMENT_FILE_MIME_TYPES = ["application/pdf", "text/csv", "text/plain"] as const;
export type StatementFileMime = (typeof STATEMENT_FILE_MIME_TYPES)[number];

const BY_EXTENSION: Record<string, StatementFileMime> = {
  pdf: "application/pdf",
  csv: "text/csv",
  ofx: "text/plain",
  qfx: "text/plain",
  qbo: "text/plain",
  qif: "text/plain",
};

/**
 * How a statement file is kept. The name decides first: a browser gives a bank
 * download no type, or one the store would refuse.
 */
export function statementFileMime(fileName: string, browserType = ""): StatementFileMime | null {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase();
  const byName = extension ? BY_EXTENSION[extension] : undefined;
  if (byName) return byName;
  return (STATEMENT_FILE_MIME_TYPES as readonly string[]).includes(browserType) ? (browserType as StatementFileMime) : null;
}

/** Why a file cannot be kept, said before anything is sent; null when it can. */
export function statementFileRefusal(file: { name: string; type?: string; size: number }): string | null {
  if (file.size <= 0) return "the file is empty";
  if (file.size > SAVED_REPORT_MAX_BYTES) return "it is larger than 10 MB";
  if (file.name.length > 255) return "its name is longer than 255 characters";
  if (!statementFileMime(file.name, file.type)) return "OneBook keeps PDF, CSV, OFX, QFX, QBO and QIF statement files";
  return null;
}

export interface StatementPeriod {
  from: string | null;
  to: string | null;
}

/** The days a file covers: from its earliest statement's first day to its latest one's last. */
export function statementFileSpan(periods: readonly StatementPeriod[]): StatementPeriod {
  const froms = periods.map((p) => p.from).filter((d): d is string => Boolean(d)).sort();
  const tos = periods.map((p) => p.to).filter((d): d is string => Boolean(d)).sort();
  return { from: froms[0] ?? null, to: tos[tos.length - 1] ?? null };
}

/** The days a file of lines covers, when it prints no period of its own. */
export function linesSpan(lines: readonly { txn_date: string }[]): StatementPeriod {
  const dates = lines.map((l) => l.txn_date).sort();
  return { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null };
}

/** The bank account a kept file is named after: "Example Bank ****1183". */
export function statementFileAccount(name: string, maskedNumber: string | null): string {
  return [name.trim(), (maskedNumber ?? "").trim()].filter(Boolean).join(" ");
}

/** "Example Bank ****1183 — statement May 1 – May 31, 2026", as Reports › Saved lists it. */
export function statementFileTitle(account: string, period: StatementPeriod): string {
  const what = period.from || period.to ? `statement ${periodLabel(period.from, period.to)}` : "statement file";
  return `${account.trim() || "Bank account"} — ${what}`.slice(0, 200);
}

/** The first 12 characters of a file's SHA-256, printed so a paper report can be matched to its file. */
export function shortSha(sha256: string): string {
  return sha256.slice(0, 12);
}

/** Where a file that could not be kept can be attached later, and what was done without it. */
export type KeepFailureWhere = "reconciliation" | "import";

export function keepFailureMessage(reason: string, where: KeepFailureWhere): string {
  const why = reason.trim().replace(/[.\s]+$/, "") || "an unexpected error occurred";
  return where === "reconciliation"
    ? `The statement file could not be kept: ${why}. Attach it on the reconciliation.`
    : `The statement file could not be kept: ${why}. Its lines were imported without it.`;
}

// --- Attach the statement: is this file the reconciliation's statement? -----

export interface EvidenceLine {
  txn_date: string;
  amount_minor: number;
}

/** What was read from the file chosen: its lines, and its last day and closing balance when it prints them. */
export interface ReadStatementFile {
  to: string | null;
  closingMinor: number | null;
  lines: readonly EvidenceLine[];
}

/** What the reconciliation holds: its statement date and ending balance, and the statement lines it kept. */
export interface EvidenceTarget {
  endingDate: string;
  endingMinor: number;
  keptLines: readonly EvidenceLine[];
}

/**
 * Why the file chosen is not this reconciliation's statement, or null when it
 * is. A file that prints its closing balance must close on the statement date
 * at the ending balance. When the reconciliation kept the statement's lines,
 * the file's lines must be the same lines, in order — and for a bank download
 * that prints no balance, those lines are the whole proof. A reconciliation
 * that kept no lines can only be matched by a closing balance.
 */
export function statementFileMismatch(
  read: ReadStatementFile,
  target: EvidenceTarget,
  money: (minor: number) => string,
): string | null {
  const date = (iso: string) => shortDate(iso, true);
  if (read.to !== null && read.closingMinor !== null) {
    if (read.to !== target.endingDate || read.closingMinor !== target.endingMinor) {
      return (
        `This file's statement closes ${date(read.to)} at ${money(read.closingMinor)}; ` +
        `this reconciliation is to ${date(target.endingDate)} at ${money(target.endingMinor)}.`
      );
    }
  } else if (target.keptLines.length === 0) {
    return (
      `This file does not show the statement's closing balance, so it cannot be matched to this reconciliation. ` +
      `Attach the bank's PDF statement for ${date(target.endingDate)}.`
    );
  }
  const kept = target.keptLines;
  if (kept.length === 0) return null;

  // A line of no amount moves no money and was never kept. A CSV that runs over
  // several months gave each month's reconciliation only that month's lines,
  // so the file's lines from the first kept day to the statement date count too.
  const lines = read.lines.filter((l) => l.amount_minor !== 0);
  const firstKeptDay = kept.reduce((min, l) => (l.txn_date < min ? l.txn_date : min), kept[0].txn_date);
  const month = lines.filter((l) => l.txn_date >= firstKeptDay && l.txn_date <= target.endingDate);
  const firstDifference = (candidate: readonly EvidenceLine[]) =>
    candidate.findIndex((l, i) => l.txn_date !== kept[i].txn_date || l.amount_minor !== kept[i].amount_minor);
  const same = (candidate: readonly EvidenceLine[]) => candidate.length === kept.length && firstDifference(candidate) < 0;
  if (same(lines) || same(month)) return null;

  const plural = (n: number) => `${n} line${n === 1 ? "" : "s"}`;
  if (month.length !== kept.length) {
    return (
      `This file has ${plural(month.length)} from ${date(firstKeptDay)} to ${date(target.endingDate)}; ` +
      `this reconciliation kept ${plural(kept.length)} from its statement.`
    );
  }
  const at = firstDifference(month);
  return (
    `Line ${at + 1} differs: the file has ${date(month[at].txn_date)} at ${money(month[at].amount_minor)}; ` +
    `this reconciliation kept ${date(kept[at].txn_date)} at ${money(kept[at].amount_minor)}.`
  );
}

// --- Validation of what the browser sends ------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const statementFileKeepSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    period_start: isoDate.nullable(),
    period_end: isoDate.nullable(),
    file_name: z.string().trim().min(1).max(255),
    storage_path: z.string().min(1).max(400),
    mime_type: z.enum(STATEMENT_FILE_MIME_TYPES),
    size_bytes: z.number().int().positive().max(SAVED_REPORT_MAX_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, "Expected a sha256 digest"),
  })
  .refine(
    (value) => !value.period_start || !value.period_end || value.period_end >= value.period_start,
    { message: "The period cannot end before it starts", path: ["period_end"] },
  );
export type StatementFileKeepInput = z.infer<typeof statementFileKeepSchema>;

const evidenceLineSchema = z.object({
  txn_date: isoDate,
  amount_minor: z.number().int(),
});

export const statementFileAttachSchema = z.object({
  reconciliation_id: z.string().uuid(),
  file_id: z.string().uuid(),
  to: isoDate.nullable(),
  closing_minor: z.number().int().nullable(),
  lines: z.array(evidenceLineSchema).max(10_000),
});
export type StatementFileAttachInput = z.infer<typeof statementFileAttachSchema>;
```

In `lib/domain/saved-reports.ts` apply these edits:

Edit 1 of 3 — find:

```ts
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/png": "png",
  "image/jpeg": "jpg",
};

export function savedReportExtension(mimeType: string): string {
```

replace with:

```ts
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/png": "png",
  "image/jpeg": "jpg",
  // A bank's own download, kept as a statement file (1.83).
  "text/plain": "txt",
};

export function savedReportExtension(mimeType: string): string {
```

Edit 2 of 3 — find:

```ts
}

/**
 * `<company id>/<object id>.<ext>`.
 *
 * The company id is there so an object found in the bucket can be traced back
 * to the books it belongs to. Nothing authorises on it — authorisation happens
 * before a signed URL is minted, never from a path.
 */
export function savedReportStoragePath(
  companyId: string,
  mimeType: string,
  objectId: string,
): string {
  return `${companyId}/${objectId}.${savedReportExtension(mimeType)}`;
}

/** Whether the viewer can show this file as a table rather than a download. */
```

replace with:

```ts
}

/**
 * `<company schema>/<object id>.<ext>`.
 *
 * The folder is the company's schema, so an object found in the bucket can be
 * traced back to the books it belongs to — and, since 1.83, so the database can
 * refuse to register a path outside its own folder (`current_schema()`).
 * Files saved before 1.83 sit under the company's id; they are left where they
 * are. Reading never authorises on a path — a signed URL is minted only after
 * the row was read through the session.
 */
export function savedReportStoragePath(
  folder: string,
  mimeType: string,
  objectId: string,
): string {
  return `${folder}/${objectId}.${savedReportExtension(mimeType)}`;
}

/** Whether the viewer can show this file as a table rather than a download. */
```

Edit 3 of 3 — find:

```ts
  return mimeType === "text/csv";
}

export function validateSavedReportFile(file: {
  name: string;
  type: string;
```

replace with:

```ts
  return mimeType === "text/csv";
}

/**
 * How a saved file is shown inside OneBook. Nothing in the store is scanned, so
 * nothing is handed to the browser to open: a PDF is drawn as images, a CSV is
 * a table, a bank download is text. Anything else is Download only.
 */
export type SavedReportView = "pdf" | "table" | "text" | "download";

export function savedReportView(mimeType: string): SavedReportView {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/csv") return "table";
  if (mimeType === "text/plain") return "text";
  return "download";
}

export function validateSavedReportFile(file: {
  name: string;
  type: string;
```

- [ ] **Step 4: Run them again.**

Run: `npx vitest run tests/unit/statement-evidence.test.ts tests/unit/saved-reports.test.ts`
Expected: every test passes (32 in `statement-evidence.test.ts`).
Run: `npm run typecheck` — Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add lib/domain/statement-evidence.ts tests/unit/statement-evidence.test.ts lib/domain/saved-reports.ts tests/unit/saved-reports.test.ts
printf 'feat(domain): what a kept statement file is called, and whether a file is a reconciliation'"'"'s statement\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 3: Keeping a file, on the server

**Files:**
- Create: `lib/services/statement-files.ts`
- Modify: `lib/services/saved-reports.ts` (four edits)
- Modify: `app/(app)/reports/saved/actions.ts` (one edit)
- Modify: `tests/unit/saved-reports-service.test.ts` (one edit)

**Interfaces:**
- Consumes: `StatementFileKeepInput` (Task 2); `savedReportView`, `savedReportStoragePath` (Task 2); RPCs from Task 1.
- Produces:
  - `lib/services/saved-reports.ts`: `createSavedReportUploadTicket(folder, mimeType)` — `folder` is the company's schema name; `getSavedReport(sb, id): Promise<SavedReportRow>` (throws `SavedReportError("Report not found")`); `readSavedReportText` reads `text/csv` and `text/plain`;
  - `app/(app)/reports/saved/actions.ts`: tickets minted under `company.active.schemaName`;
  - `lib/services/statement-files.ts`: `StatementFileError`, `findKeptStatementFile(sb, sha256): Promise<string | null>`, `keepStatementFile(sb, input): Promise<{ id, reused }>`, `removeUnkeptUpload(sb, folder, path): Promise<void>`, `linkReconciliationStatementFile(sb, reconciliationId, fileId)`, `linkImportBatchStatementFile(sb, batchId, fileId)`.

- [ ] **Step 1: The test.** In `tests/unit/saved-reports-service.test.ts` apply this edit:

Edit 1 of 1 — find:

```ts
});

describe("readSavedReportText", () => {
  it("refuses a format the viewer cannot render, rather than returning bytes as text", async () => {
    const sb = stubClient({ row: { ...csvRow, mime_type: "application/pdf" } });
    await expect(readSavedReportText(sb, csvRow.id)).rejects.toThrow(
      "This report cannot be shown as a table",
    );
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("refuses a report this company cannot see", async () => {
    const sb = stubClient({ row: null });
    await expect(readSavedReportText(sb, csvRow.id)).rejects.toThrow("Report not found");
```

replace with:

```ts
});

describe("readSavedReportText", () => {
  it("refuses a format the viewer does not show as text, rather than returning bytes as text", async () => {
    const sb = stubClient({ row: { ...csvRow, mime_type: "application/pdf" } });
    await expect(readSavedReportText(sb, csvRow.id)).rejects.toThrow(
      "This report cannot be shown as text",
    );
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("reads a bank download kept as a statement file", async () => {
    storage.download.mockResolvedValue({ data: new Blob(["OFXHEADER:100\n<OFX>"]), error: null });
    await expect(
      readSavedReportText(stubClient({ row: { ...csvRow, mime_type: "text/plain" } }), csvRow.id),
    ).resolves.toContain("OFXHEADER:100");
  });

  it("refuses a report this company cannot see", async () => {
    const sb = stubClient({ row: null });
    await expect(readSavedReportText(sb, csvRow.id)).rejects.toThrow("Report not found");
```

- [ ] **Step 2: Run it — it fails.**

Run: `npx vitest run tests/unit/saved-reports-service.test.ts`
Expected: FAIL — "This report cannot be shown as a table" is not "…as text", and a `text/plain` file is refused.

- [ ] **Step 3: The services.** In `lib/services/saved-reports.ts` apply these edits:

Edit 1 of 4 — find:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSavedReportStorageClient } from "@/lib/db/storage-admin";
import {
  isTabularSavedReport,
  SAVED_REPORT_BUCKET,
  savedReportStoragePath,
  type SavedReportRegisterInput,
  type SavedReportSource,
} from "@/lib/domain/saved-reports";
```

replace with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSavedReportStorageClient } from "@/lib/db/storage-admin";
import {
  SAVED_REPORT_BUCKET,
  savedReportStoragePath,
  savedReportView,
  type SavedReportRegisterInput,
  type SavedReportSource,
} from "@/lib/domain/saved-reports";
```

Edit 2 of 4 — find:

```ts
 *
 * The caller has already established that this session may write in this
 * company. The path is minted here rather than accepted from the client, so a
 * request cannot name a path belonging to another company.
 */
export async function createSavedReportUploadTicket(
  companyId: string,
  mimeType: string,
): Promise<{ path: string; token: string }> {
  const path = savedReportStoragePath(companyId, mimeType, crypto.randomUUID());
  const admin = createSavedReportStorageClient();
  const { data, error } = await admin.storage.from(SAVED_REPORT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
```

replace with:

```ts
 *
 * The caller has already established that this session may write in this
 * company. The path is minted here rather than accepted from the client, so a
 * request cannot name a path belonging to another company; `folder` is the
 * company's schema, the folder the database checks a registered path against.
 */
export async function createSavedReportUploadTicket(
  folder: string,
  mimeType: string,
): Promise<{ path: string; token: string }> {
  const path = savedReportStoragePath(folder, mimeType, crypto.randomUUID());
  const admin = createSavedReportStorageClient();
  const { data, error } = await admin.storage.from(SAVED_REPORT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
```

Edit 3 of 4 — find:

```ts
  return data as unknown as SavedReportRow;
}

export async function createSavedReportDownloadUrl(
  sb: SupabaseClient,
  id: string,
```

replace with:

```ts
  return data as unknown as SavedReportRow;
}

/** One saved file, read through the session: null-safe callers get "Report not found". */
export async function getSavedReport(sb: SupabaseClient, id: string): Promise<SavedReportRow> {
  return requireReadableRow(sb, id);
}

export async function createSavedReportDownloadUrl(
  sb: SupabaseClient,
  id: string,
```

Edit 4 of 4 — find:

```ts
}

/**
 * The text of a saved CSV, read by the server so the browser never holds a
 * storage credential for a preview it only renders.
 */
export async function readSavedReportText(sb: SupabaseClient, id: string): Promise<string> {
  const row = await requireReadableRow(sb, id);
  if (!isTabularSavedReport(row.mime_type)) {
    throw new SavedReportError("This report cannot be shown as a table. Download it instead.");
  }
  const admin = createSavedReportStorageClient();
  const { data, error } = await admin.storage.from(SAVED_REPORT_BUCKET).download(row.storage_path);
```

replace with:

```ts
}

/**
 * The text of a saved CSV or bank download, read by the server so the browser
 * never holds a storage credential for a preview it only renders.
 */
export async function readSavedReportText(sb: SupabaseClient, id: string): Promise<string> {
  const row = await requireReadableRow(sb, id);
  const view = savedReportView(row.mime_type);
  if (view !== "table" && view !== "text") {
    throw new SavedReportError("This report cannot be shown as text. Download it instead.");
  }
  const admin = createSavedReportStorageClient();
  const { data, error } = await admin.storage.from(SAVED_REPORT_BUCKET).download(row.storage_path);
```

In `app/(app)/reports/saved/actions.ts` apply this edit:

Edit 1 of 1 — find:

```ts
  const company = await resolveActiveCompany();
  if (!company.active) return { ok: false, error: "No company is selected" };
  try {
    const ticket = await createSavedReportUploadTicket(company.active.id, mimeType);
    return { ok: true, data: { ...ticket, bucket: SAVED_REPORT_BUCKET } };
  } catch (error) {
    return { ok: false, error: msg(error) };
```

replace with:

```ts
  const company = await resolveActiveCompany();
  if (!company.active) return { ok: false, error: "No company is selected" };
  try {
    const ticket = await createSavedReportUploadTicket(company.active.schemaName, mimeType);
    return { ok: true, data: { ...ticket, bucket: SAVED_REPORT_BUCKET } };
  } catch (error) {
    return { ok: false, error: msg(error) };
```

Create `lib/services/statement-files.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSavedReportStorageClient } from "@/lib/db/storage-admin";
import { SAVED_REPORT_BUCKET } from "@/lib/domain/saved-reports";
import type { StatementFileKeepInput } from "@/lib/domain/statement-evidence";

/**
 * The statement file kept beside what was read from it (1.83), in the
 * Reports › Saved store. The rows are read and written through the session —
 * the company's schema, its policies and its functions decide; the storage
 * client only moves bytes the session has already agreed to.
 */
export class StatementFileError extends Error {}

/** The active kept file with this SHA-256, if any: the same file is kept once. */
export async function findKeptStatementFile(sb: SupabaseClient, sha256: string): Promise<string | null> {
  const { data, error } = await sb
    .from("acc_saved_report")
    .select("id")
    .eq("sha256", sha256)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new StatementFileError(error.message);
  return (data as { id: string } | null)?.id ?? null;
}

/** Keeps the uploaded file, or finds it kept already — two people keeping it at once still give one row. */
export async function keepStatementFile(
  sb: SupabaseClient,
  input: StatementFileKeepInput,
): Promise<{ id: string; reused: boolean }> {
  const { data, error } = await sb.rpc("acc_keep_statement_file", {
    p_title: input.title,
    p_period_start: input.period_start,
    p_period_end: input.period_end,
    p_file_name: input.file_name,
    p_storage_path: input.storage_path,
    p_mime_type: input.mime_type,
    p_size_bytes: input.size_bytes,
    p_sha256: input.sha256,
  });
  if (error) throw new StatementFileError(error.message);
  const kept = data as { id: string; reused: boolean };
  return { id: kept.id, reused: Boolean(kept.reused) };
}

/**
 * Removes an upload no row points at: the copy made redundant when the same
 * file turned out to be kept already, or one whose keeping failed. Only in the
 * company's own folder, and never a path a row of this company names. Best
 * effort — an orphan left behind costs storage, not correctness.
 */
export async function removeUnkeptUpload(sb: SupabaseClient, folder: string, path: string): Promise<void> {
  if (!path.startsWith(`${folder}/`) || path.includes("..")) return;
  const { data, error } = await sb.from("acc_saved_report").select("id").eq("storage_path", path).maybeSingle();
  if (error || data) return;
  await createSavedReportStorageClient().storage.from(SAVED_REPORT_BUCKET).remove([path]);
}

/** Attaches a kept file to a reconciliation that has none (Attach the statement). */
export async function linkReconciliationStatementFile(sb: SupabaseClient, reconciliationId: string, fileId: string): Promise<void> {
  const { error } = await sb.rpc("acc_link_reconciliation_statement_file", {
    p_reconciliation_id: reconciliationId,
    p_file_id: fileId,
  });
  if (error) throw new StatementFileError(error.message);
}

/** Points a statement import at the file its lines were read from; set once. */
export async function linkImportBatchStatementFile(sb: SupabaseClient, batchId: string, fileId: string): Promise<void> {
  const { error } = await sb.rpc("acc_link_import_batch_statement_file", { p_batch_id: batchId, p_file_id: fileId });
  if (error) throw new StatementFileError(error.message);
}
```

- [ ] **Step 4: Run it again.**

Run: `npx vitest run tests/unit/saved-reports-service.test.ts tests/unit/saved-reports.test.ts`
Expected: every test passes.
Run: `npm run typecheck` — Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add lib/services/statement-files.ts lib/services/saved-reports.ts "app/(app)/reports/saved/actions.ts" tests/unit/saved-reports-service.test.ts
printf 'feat(saved-reports): keep a statement file in the company'"'"'s own folder, and read bank downloads as text\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 4: Reconciliations and imports carry their file, on the server

**Files:**
- Create: `app/(app)/banking/statement-file-actions.ts`
- Modify: `lib/services/bankrec.ts` (five edits)
- Modify: `tests/unit/reconcile-statement-service.test.ts` (two edits)
- Modify: `lib/services/banking.ts` (one edit)
- Modify: `lib/domain/schemas.ts` (two edits)
- Modify: `app/(app)/banking/reconcile/statement-actions.ts` (five edits)
- Modify: `app/(app)/banking/actions.ts` (three edits)

**Interfaces:**
- Consumes: Task 2's schemas and `statementFileMismatch`; Task 3's services.
- Produces:
  - `ReconStatementHeader` gains `statementFileId: string | null` and `statementFile: KeptStatementFileRef | null`, where `KeptStatementFileRef = { id, fileName, keptAt, sha256 }` (read by embedding `acc_saved_report` through the foreign key);
  - `StatementFileInput` gains `statementFileId: string | null`, sent as `p_statement_file_id`;
  - `BankStatementImportRow.statement_file_id: string | null`;
  - `reconciliationStatementSchema` and the `bring_forward` branch of `runMonthSchema` accept `statement_file_id` (uuid, nullable, default null);
  - `importStatementAction(bankAccountId, filename, rows, statementFileId = null)` links the batch;
  - `importStatementIntoReconciliationAction` and `reconcileRunMonthAction` pass the file with the statement, link the batch their lines made, and link a brought-forward reconciliation;
  - `app/(app)/banking/statement-file-actions.ts`: `PreparedStatementFile = { keptId } | { ticket: { path, token, bucket } }`; `prepareStatementFileAction(sha256, mimeType)`, `keepStatementFileAction(raw)` → `{ id }`, `attachStatementFileAction(raw)` (checks `statementFileMismatch` against the reconciliation's own figures, then links).

- [ ] **Step 1: The test.** In `tests/unit/reconcile-statement-service.test.ts` apply these edits:

Edit 1 of 2 — find:

```ts
      openingMinor: 75000,
      closingMinor: null,
      broughtForward: false,
    });
    expect(statement.lines[5]).toEqual({
      lineNo: 5, txnDate: "2026-09-01", description: "Line 5", reference: null, amountMinor: 105, balanceMinor: null,
```

replace with:

```ts
      openingMinor: 75000,
      closingMinor: null,
      broughtForward: false,
      statementFileId: null,
      statementFile: null,
    });
    expect(statement.lines[5]).toEqual({
      lineNo: 5, txnDate: "2026-09-01", description: "Line 5", reference: null, amountMinor: 105, balanceMinor: null,
```

Edit 2 of 2 — find:

```ts
        { txn_date: "2026-09-05", description: "FEE", reference: null, amount_minor: -500, running_balance_minor: 74500, raw_line: "x" },
        { txn_date: "2026-09-06", description: "NOTHING", reference: null, amount_minor: 0, running_balance_minor: 74500, raw_line: "y" },
      ],
    });
    expect(calls[0].args.p_lines).toEqual([
      { txn_date: "2026-09-05", description: "FEE", reference: null, amount_minor: -500, balance_minor: 74500 },
    ]);
  });

  it("reads what bringing an account forward would sign off", async () => {
```

replace with:

```ts
        { txn_date: "2026-09-05", description: "FEE", reference: null, amount_minor: -500, running_balance_minor: 74500, raw_line: "x" },
        { txn_date: "2026-09-06", description: "NOTHING", reference: null, amount_minor: 0, running_balance_minor: 74500, raw_line: "y" },
      ],
      statementFileId: null,
    });
    expect(calls[0].args.p_lines).toEqual([
      { txn_date: "2026-09-05", description: "FEE", reference: null, amount_minor: -500, balance_minor: 74500 },
    ]);
    // No file kept: the reconciliation's file goes with its old statement.
    expect(calls[0].args.p_statement_file_id).toBeNull();
  });

  it("sends the kept file with the statement it was read from", async () => {
    const { sb, calls } = fakeClient({}, { acc_set_reconciliation_statement: () => 1 });
    await setReconciliationStatement(sb, "rec-1", {
      fileName: "september.pdf",
      openingMinor: 75000,
      closingMinor: 74500,
      lines: [{ txn_date: "2026-09-05", description: "FEE", reference: null, amount_minor: -500, running_balance_minor: 74500, raw_line: "x" }],
      statementFileId: "file-1",
    });
    expect(calls[0].args.p_statement_file_id).toBe("file-1");
  });

  it("reads what bringing an account forward would sign off", async () => {
```

- [ ] **Step 2: Run it — it fails.**

Run: `npx vitest run tests/unit/reconcile-statement-service.test.ts`
Expected: FAIL — the header has no `statementFileId`, and `p_statement_file_id` is not sent.

- [ ] **Step 3: The services.** In `lib/services/bankrec.ts` apply these edits:

Edit 1 of 5 — find:

```ts
  bankAccountId: string; endingDate: string; status: string;
  fileName: string | null; openingMinor: number | null; closingMinor: number | null;
  note: string | null; broughtForward: boolean;
}

/** The statement a reconciliation is reconciled against, with its lines. */
```

replace with:

```ts
  bankAccountId: string; endingDate: string; status: string;
  fileName: string | null; openingMinor: number | null; closingMinor: number | null;
  note: string | null; broughtForward: boolean;
  /** The kept statement file (1.83), in Reports › Saved; null when none was kept. */
  statementFileId: string | null;
  /** That file as this person may read it — null when there is none, or they may not read saved files. */
  statementFile: KeptStatementFileRef | null;
}

/** A kept statement file as a reconciliation names it: enough to show it, find it and match a printout to it. */
export interface KeptStatementFileRef {
  id: string;
  fileName: string;
  keptAt: string;
  sha256: string;
}

/** The statement a reconciliation is reconciled against, with its lines. */
```

Edit 2 of 5 — find:

```ts
  openingMinor: number | null;
  closingMinor: number | null;
  lines: StatementLine[];
}
export interface ReconDetail {
  beginningMinor: number; statementEndingMinor: number; clearedTotalMinor: number;
```

replace with:

```ts
  openingMinor: number | null;
  closingMinor: number | null;
  lines: StatementLine[];
  /** The file itself, kept in Reports › Saved (1.83); null when it could not be kept. */
  statementFileId: string | null;
}
export interface ReconDetail {
  beginningMinor: number; statementEndingMinor: number; clearedTotalMinor: number;
```

Edit 3 of 5 — find:

```ts
  const { data, error } = await sb.rpc("acc_create_reconciliation_from_statement", {
    p_bank_account_id: bankAccountId, p_ending_date: endingDate, p_ending_minor: endingMinor,
    p_file_name: file.fileName, p_opening_minor: file.openingMinor, p_lines: statementPayload(file.lines),
  });
  if (error) throw new BankRecError(error.message);
  return data as string;
}

/** Replaces the statement a reconciliation in progress is reconciled against. */
export async function setReconciliationStatement(sb: SupabaseClient, id: string, file: StatementFileInput): Promise<number> {
  const { data, error } = await sb.rpc("acc_set_reconciliation_statement", {
    p_reconciliation_id: id, p_file_name: file.fileName, p_opening_minor: file.openingMinor,
    p_closing_minor: file.closingMinor, p_lines: statementPayload(file.lines),
  });
  if (error) throw new BankRecError(error.message);
  return Number(data);
```

replace with:

```ts
  const { data, error } = await sb.rpc("acc_create_reconciliation_from_statement", {
    p_bank_account_id: bankAccountId, p_ending_date: endingDate, p_ending_minor: endingMinor,
    p_file_name: file.fileName, p_opening_minor: file.openingMinor, p_lines: statementPayload(file.lines),
    p_statement_file_id: file.statementFileId,
  });
  if (error) throw new BankRecError(error.message);
  return data as string;
}

/** Replaces the statement a reconciliation in progress is reconciled against — and its kept file with it. */
export async function setReconciliationStatement(sb: SupabaseClient, id: string, file: StatementFileInput): Promise<number> {
  const { data, error } = await sb.rpc("acc_set_reconciliation_statement", {
    p_reconciliation_id: id, p_file_name: file.fileName, p_opening_minor: file.openingMinor,
    p_closing_minor: file.closingMinor, p_lines: statementPayload(file.lines),
    p_statement_file_id: file.statementFileId,
  });
  if (error) throw new BankRecError(error.message);
  return Number(data);
```

Edit 4 of 5 — find:

```ts
/** A reconciliation's account, date and statement, or null when no reconciliation has this id. */
export async function findReconciliationHeader(sb: SupabaseClient, id: string): Promise<ReconStatementHeader | null> {
  const { data, error } = await sb.from("acc_statement_reconciliation")
    .select("bank_account_id,statement_ending_date,status,statement_ref,statement_opening_minor,statement_closing_minor,note,brought_forward")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new BankRecError(error.message);
```

replace with:

```ts
/** A reconciliation's account, date and statement, or null when no reconciliation has this id. */
export async function findReconciliationHeader(sb: SupabaseClient, id: string): Promise<ReconStatementHeader | null> {
  const { data, error } = await sb.from("acc_statement_reconciliation")
    .select("bank_account_id,statement_ending_date,status,statement_ref,statement_opening_minor,statement_closing_minor,note,brought_forward,statement_file_id,statement_file:acc_saved_report(id,file_name,uploaded_at,sha256)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new BankRecError(error.message);
```

Edit 5 of 5 — find:

```ts
    closingMinor: optionalMinor(r.statement_closing_minor),
    note: (r.note as string) ?? null,
    broughtForward: Boolean(r.brought_forward),
  };
}
```

replace with:

```ts
    closingMinor: optionalMinor(r.statement_closing_minor),
    note: (r.note as string) ?? null,
    broughtForward: Boolean(r.brought_forward),
    statementFileId: (r.statement_file_id as string) ?? null,
    statementFile: keptFileRef(r.statement_file),
  };
}

function keptFileRef(value: unknown): KeptStatementFileRef | null {
  const row = (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null | undefined;
  if (!row?.id) return null;
  return {
    id: row.id as string,
    fileName: row.file_name as string,
    keptAt: row.uploaded_at as string,
    sha256: row.sha256 as string,
  };
}
```

In `lib/services/banking.ts` apply this edit:

Edit 1 of 1 — find:

```ts
  status: "active" | "voided";
  voided_at: string | null;
  void_reason: string | null;
}

/** Statement imports, newest first. Null means every bank account. */
```

replace with:

```ts
  status: "active" | "voided";
  voided_at: string | null;
  void_reason: string | null;
  /** The file the lines were read from, kept in Reports › Saved (1.83); null before then or when it could not be kept. */
  statement_file_id: string | null;
}

/** Statement imports, newest first. Null means every bank account. */
```

In `lib/domain/schemas.ts` apply these edits:

Edit 1 of 2 — find:

```ts
    )
    .min(1, "The statement has no lines")
    .max(5000, "A statement can hold at most 5,000 lines"),
});
export type ReconciliationStatementInput = z.infer<typeof reconciliationStatementSchema>;
```

replace with:

```ts
    )
    .min(1, "The statement has no lines")
    .max(5000, "A statement can hold at most 5,000 lines"),
  /** The statement file, kept in Reports › Saved (1.83); null when it could not be kept. */
  statement_file_id: z.uuid().nullable().default(null),
});
export type ReconciliationStatementInput = z.infer<typeof reconciliationStatementSchema>;
```

Edit 2 of 2 — find:

```ts
    period_from: statementDay,
    statement_date: statementDay,
    opening_minor: z.number().int(),
  }),
  reconciliationStatementSchema.extend({
    kind: z.literal("month"),
```

replace with:

```ts
    period_from: statementDay,
    statement_date: statementDay,
    opening_minor: z.number().int(),
    statement_file_id: z.uuid().nullable().default(null),
  }),
  reconciliationStatementSchema.extend({
    kind: z.literal("month"),
```

- [ ] **Step 4: The actions.** In `app/(app)/banking/reconcile/statement-actions.ts` apply these edits:

Edit 1 of 5 — find:

```ts
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import { broughtForwardNote, dayBefore, type PairingOutcome } from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
import type { ActionResult } from "./actions";

async function guard(): Promise<string | null> {
```

replace with:

```ts
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import { broughtForwardNote, dayBefore, type PairingOutcome } from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
import { linkImportBatchStatementFile, linkReconciliationStatementFile } from "@/lib/services/statement-files";
import type { ActionResult } from "./actions";

async function guard(): Promise<string | null> {
```

Edit 2 of 5 — find:

```ts
    openingMinor: input.opening_minor,
    closingMinor: input.closing_minor,
    lines: input.lines,
  };
}

/**
 * The statement's lines go into Bank Transactions as Import statement puts
 * them there — the same path and the same duplicate rule — and its matches are
```

replace with:

```ts
    openingMinor: input.opening_minor,
    closingMinor: input.closing_minor,
    lines: input.lines,
    statementFileId: input.statement_file_id,
  };
}

/** A link the statement file could not make costs nothing done with it: the file stays in Reports › Saved. */
function warnUnlinked(err: unknown) {
  console.warn("linking the statement file failed:", err instanceof Error ? err.message : err);
}

/**
 * The statement's lines go into Bank Transactions as Import statement puts
 * them there — the same path and the same duplicate rule — and its matches are
```

Edit 3 of 5 — find:

```ts
  file: StatementFileInput,
) {
  const imported = await importStatement(sb, bankAccountId, file.fileName, file.lines);
  if (imported.inserted > 0) {
    await generateSuggestions(sb, bankAccountId).catch((err) =>
      console.warn("finding ledger matches after import failed:", err instanceof Error ? err.message : err),
```

replace with:

```ts
  file: StatementFileInput,
) {
  const imported = await importStatement(sb, bankAccountId, file.fileName, file.lines);
  if (imported.batchId && file.statementFileId) {
    await linkImportBatchStatementFile(sb, imported.batchId, file.statementFileId).catch(warnUnlinked);
  }
  if (imported.inserted > 0) {
    await generateSuggestions(sb, bankAccountId).catch((err) =>
      console.warn("finding ledger matches after import failed:", err instanceof Error ? err.message : err),
```

Edit 4 of 5 — find:

```ts

/**
 * The statement a reconciliation in progress is reconciled against: kept with
 * it (replacing any kept before), imported into Bank Transactions, and paired
 * with the books — every pair is ticked. Nothing is posted.
 */
export async function importStatementIntoReconciliationAction(
  reconciliationId: string,
```

replace with:

```ts

/**
 * The statement a reconciliation in progress is reconciled against: kept with
 * it (replacing any kept before, its file with it), imported into Bank
 * Transactions, and paired with the books — every pair is ticked. Nothing is
 * posted.
 */
export async function importStatementIntoReconciliationAction(
  reconciliationId: string,
```

Edit 5 of 5 — find:

```ts
        input.opening_minor,
        broughtForwardNote(input.period_from, input.statement_date),
      );
      revalidatePath("/banking/reconcile");
      return { ok: true, data: { id, signed: true, differenceMinor: 0 } };
    }
```

replace with:

```ts
        input.opening_minor,
        broughtForwardNote(input.period_from, input.statement_date),
      );
      // Brought forward on the opening balance its statement prints: that file is its evidence too.
      if (input.statement_file_id) await linkReconciliationStatementFile(sb, id, input.statement_file_id).catch(warnUnlinked);
      revalidatePath("/banking/reconcile");
      return { ok: true, data: { id, signed: true, differenceMinor: 0 } };
    }
```

In `app/(app)/banking/actions.ts` apply these edits:

Edit 1 of 3 — find:

```ts
import { loanPaymentSchema } from "@/lib/domain/schemas";
import { codeFromSuggestions, codingSuggestions, type CodeItem, type CodeOutcome } from "@/lib/services/coding";
import { loanSuggestions, postLoanPayment } from "@/lib/services/loan-payments";

export interface ActionResult<T = undefined> {
  ok: boolean;
```

replace with:

```ts
import { loanPaymentSchema } from "@/lib/domain/schemas";
import { codeFromSuggestions, codingSuggestions, type CodeItem, type CodeOutcome } from "@/lib/services/coding";
import { loanSuggestions, postLoanPayment } from "@/lib/services/loan-payments";
import { linkImportBatchStatementFile } from "@/lib/services/statement-files";

export interface ActionResult<T = undefined> {
  ok: boolean;
```

Edit 2 of 3 — find:

```ts
  bankAccountId: string,
  filename: string,
  rows: ImportRow[],
): Promise<ActionResult<{ inserted: number; skipped: number; batchId: string | null }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
```

replace with:

```ts
  bankAccountId: string,
  filename: string,
  rows: ImportRow[],
  statementFileId: string | null = null,
): Promise<ActionResult<{ inserted: number; skipped: number; batchId: string | null }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
```

Edit 3 of 3 — find:

```ts
  try {
    const sb = await createSupabaseServerClient();
    const res = await importStatement(sb, bankAccountId, filename, rows);
    // Review import opens next, and its first proposal is a match to what is
    // already in the books — so those are looked for now. A failure here costs
    // the match proposals, not the import.
```

replace with:

```ts
  try {
    const sb = await createSupabaseServerClient();
    const res = await importStatement(sb, bankAccountId, filename, rows);
    // The file the lines were read from, kept already (1.83). Linking it costs
    // nothing the import did if it fails: the file stays in Reports › Saved.
    if (res.batchId && statementFileId) {
      await linkImportBatchStatementFile(sb, res.batchId, statementFileId).catch((err) =>
        console.warn("linking the statement file to its import failed:", err instanceof Error ? err.message : err),
      );
    }
    // Review import opens next, and its first proposal is a match to what is
    // already in the books — so those are looked for now. A failure here costs
    // the match proposals, not the import.
```

Create `app/(app)/banking/statement-file-actions.ts`:

```ts
"use server";
/**
 * The statement file kept as evidence (1.83): preparing its upload, recording
 * it, and attaching it later to a reconciliation that has none. Viewing and
 * downloading go through Reports › Saved's own actions — a kept statement file
 * is a saved report of source "Bank".
 */
import { revalidatePath } from "next/cache";
import { getUserRole, canWrite } from "@/lib/auth";
import { resolveActiveCompany } from "@/lib/db/company";
import { createSupabaseServerClient } from "@/lib/db/server";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { SAVED_REPORT_BUCKET } from "@/lib/domain/saved-reports";
import {
  STATEMENT_FILE_MIME_TYPES,
  statementFileAttachSchema,
  statementFileKeepSchema,
  statementFileMismatch,
  type StatementFileMime,
} from "@/lib/domain/statement-evidence";
import { formatMoney } from "@/lib/format";
import { getReconciliationDetail, getReconciliationStatement } from "@/lib/services/bankrec";
import { createSavedReportUploadTicket } from "@/lib/services/saved-reports";
import {
  findKeptStatementFile,
  keepStatementFile,
  linkReconciliationStatementFile,
  removeUnkeptUpload,
} from "@/lib/services/statement-files";
import type { ActionResult } from "./actions";

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string {
  return e instanceof Error ? e.message : "An unexpected error occurred";
}

export type PreparedStatementFile =
  | { keptId: string }
  | { ticket: { path: string; token: string; bucket: string } };

/**
 * The file already kept, when one with this SHA-256 is — nothing to upload —
 * or a one-time ticket to upload it to this company's own folder.
 */
export async function prepareStatementFileAction(
  sha256: string,
  mimeType: string,
): Promise<ActionResult<PreparedStatementFile>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { ok: false, error: "Expected a sha256 digest" };
  if (!(STATEMENT_FILE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { ok: false, error: "OneBook keeps PDF, CSV, OFX, QFX, QBO and QIF statement files" };
  }
  const company = await resolveActiveCompany();
  if (!company.active) return { ok: false, error: "No company is selected" };
  try {
    const sb = await createSupabaseServerClient();
    const keptId = await findKeptStatementFile(sb, sha256);
    if (keptId) return { ok: true, data: { keptId } };
    const ticket = await createSavedReportUploadTicket(company.active.schemaName, mimeType as StatementFileMime);
    return { ok: true, data: { ticket: { ...ticket, bucket: SAVED_REPORT_BUCKET } } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * Records the uploaded file. When the same file was kept a moment ago by
 * someone else, that one is used and this upload removed; when recording
 * fails, the upload is removed too.
 */
export async function keepStatementFileAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = statementFileKeepSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const company = await resolveActiveCompany();
  if (!company.active) return { ok: false, error: "No company is selected" };
  const sb = await createSupabaseServerClient();
  const cleanUp = () =>
    removeUnkeptUpload(sb, company.active!.schemaName, parsed.data.storage_path).catch((err) =>
      console.warn("removing an unkept statement upload failed:", msg(err)),
    );
  try {
    const kept = await keepStatementFile(sb, parsed.data);
    if (kept.reused) await cleanUp();
    revalidatePath("/reports/saved");
    return { ok: true, data: { id: kept.id } };
  } catch (e) {
    await cleanUp();
    return { ok: false, error: msg(e) };
  }
}

/**
 * Attach the statement: the file chosen is attached only when what was read
 * from it is this reconciliation's statement — checked here against the
 * reconciliation's own figures and kept lines, as the browser checked it.
 */
export async function attachStatementFileAction(raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = statementFileAttachSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const input = parsed.data;
  try {
    const sb = await createSupabaseServerClient();
    const [statement, detail] = await Promise.all([
      getReconciliationStatement(sb, input.reconciliation_id),
      getReconciliationDetail(sb, input.reconciliation_id),
    ]);
    if (statement.statementFileId) return { ok: false, error: "This reconciliation already has its statement file" };
    const mismatch = statementFileMismatch(
      { to: input.to, closingMinor: input.closing_minor, lines: input.lines },
      {
        endingDate: statement.endingDate,
        endingMinor: detail.statementEndingMinor,
        keptLines: statement.lines.map((l) => ({ txn_date: l.txnDate, amount_minor: l.amountMinor })),
      },
      (minor) => formatMoney(minor, USD_CURRENCY_CODE, 2),
    );
    if (mismatch) return { ok: false, error: mismatch };
    await linkReconciliationStatementFile(sb, input.reconciliation_id, input.file_id);
    revalidatePath(`/banking/reconcile/${input.reconciliation_id}`);
    revalidatePath(`/banking/reconcile/${input.reconciliation_id}/report`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
```

- [ ] **Step 5: Run it again.**

Run: `npx vitest run tests/unit/reconcile-statement-service.test.ts`
Expected: every test passes.
Run: `npm run typecheck` and `npx eslint "app/(app)/banking" lib/services` — Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add "app/(app)/banking/statement-file-actions.ts" lib/services/bankrec.ts tests/unit/reconcile-statement-service.test.ts lib/services/banking.ts lib/domain/schemas.ts "app/(app)/banking/reconcile/statement-actions.ts" "app/(app)/banking/actions.ts"
printf 'feat(banking): reconciliations and statement imports point at their kept file\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 5: Viewing a kept file inside OneBook

**Files:**
- Create: `lib/client/pdf-pages.ts`
- Create: `lib/client/saved-file-download.ts`
- Create: `components/statement-file/StatementFileViewer.tsx`
- Create: `app/(app)/banking/statement-files/[id]/page.tsx`
- Create: `app/(app)/banking/statement-files/[id]/StatementFileClient.tsx`
- Modify: `lib/client/pdf-text.ts` (one edit)
- Modify: `app/(app)/reports/saved/SavedReportViewer.tsx` (two edits)
- Modify: `app/globals.css` (one edit, at the end)
- Modify: `tests/unit/table-adoption.test.ts` (one edit)
- Modify: `tests/unit/table-fit-contract.test.ts` (one edit)

**Interfaces:**
- Consumes: `savedReportView`, `savedReportPreview` (Task 2); `getSavedReport`, `SavedReportError` (Task 3); `savedReportDownloadUrlAction`, `savedReportPreviewAction` (existing, `app/(app)/reports/saved/actions.ts`); `shortSha` (Task 2).
- Produces:
  - `lib/client/pdf-text.ts`: `loadPdfjs()` — pdf.js and its worker, shared by reading and drawing;
  - `lib/client/pdf-pages.ts`: `PDF_PAGE_LIMIT = 40`, `pdfPageImages(data, cssWidth): Promise<{ images: string[]; pageCount } | { failure }>`;
  - `lib/client/saved-file-download.ts`: `downloadSavedFile(id): Promise<string | null>` (the reason when it failed);
  - `components/statement-file/StatementFileViewer.tsx`: default export, props `{ id: string; mimeType: string }`;
  - the page `/banking/statement-files/[id]`.
- The CSV preview moves from a raw Ant Design `Table` to `DataTable` with `fit={false}`: a matrix whose columns are the file's own, listed in `tests/unit/table-fit-contract.test.ts`.

- [ ] **Step 1: The boundary tests.** In `tests/unit/table-adoption.test.ts` apply this edit:

Edit 1 of 1 — find:

```ts
  "app/(app)/reports/inventory-review/InventoryReviewClient.tsx",
  "app/(app)/reports/journal/JournalReportClient.tsx",
  "app/(app)/reports/number-sequence/NumberSequenceClient.tsx",
  "app/(app)/reports/saved/SavedReportViewer.tsx",
  "app/(app)/reports/saved/SavedReportsClient.tsx",
  "app/(app)/sales-tax/SalesTaxClient.tsx",
  "app/(app)/settings/approvals/ApprovalPoliciesClient.tsx",
```

replace with:

```ts
  "app/(app)/reports/inventory-review/InventoryReviewClient.tsx",
  "app/(app)/reports/journal/JournalReportClient.tsx",
  "app/(app)/reports/number-sequence/NumberSequenceClient.tsx",
  "app/(app)/reports/saved/SavedReportsClient.tsx",
  "app/(app)/sales-tax/SalesTaxClient.tsx",
  "app/(app)/settings/approvals/ApprovalPoliciesClient.tsx",
```

In `tests/unit/table-fit-contract.test.ts` apply this edit:

Edit 1 of 1 — find:

```ts
 * reason, and says so at its own call site.
 */
/**
 * Empty since 2026-09-28: the two per-period statements that were matrices
 * (PnlTrendView, BalanceSheetTrendView) became columns of the statement table,
 * a plain table that scrolls inside its own box. A table added here needs its
 * reason and `fit={false}` at its call site.
 */
const MATRIX = new Map<string, string>();

/**
 * Three more were candidates and none of them qualified, which is the point of
 * checking rather than listing: the permission grid and the saved-report
 * viewer reach for Ant Design's Table directly, so this boundary never covered
 * them (see tests/unit/table-adoption.test.ts), and the budget view turned out
 * to pass no `scroll.x` at all.
 */

/** The implementation itself declares the default; it is exempt by path. */
```

replace with:

```ts
 * reason, and says so at its own call site.
 */
/**
 * Empty from 2026-09-28, when the two per-period statements that were matrices
 * (PnlTrendView, BalanceSheetTrendView) became columns of the statement table,
 * a plain table that scrolls inside its own box, until 1.83 moved the saved
 * file preview onto DataTable. A table added here needs its reason and
 * `fit={false}` at its call site.
 */
const MATRIX = new Map<string, string>([
  [
    "components/statement-file/StatementFileViewer.tsx",
    "A saved CSV shown as it arrived: its columns are the file's own, as many as the file has, so they cannot be designed to fit.",
  ],
]);

/**
 * Three more were candidates and none of them qualified, which is the point of
 * checking rather than listing: the permission grid reaches for Ant Design's
 * Table directly, so this boundary never covered it (see
 * tests/unit/table-adoption.test.ts), and the budget view turned out to pass
 * no `scroll.x` at all. The saved-report viewer was the third; since 1.83 its
 * preview is the matrix above.
 */

/** The implementation itself declares the default; it is exempt by path. */
```

- [ ] **Step 2: Run them — they fail.**

Run: `npx vitest run tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts`
Expected: FAIL — `SavedReportViewer.tsx` still renders Ant Design's `Table`, and `components/statement-file/StatementFileViewer.tsx` does not exist.

- [ ] **Step 3: Drawing and downloading.** In `lib/client/pdf-text.ts` apply this edit:

Edit 1 of 1 — find:

```ts
import { glyphsFromDocument, pdfFailure, type PdfReadFailure } from "@/lib/domain/pdf-glyphs";
import { PDF_MESSAGES } from "@/lib/domain/pdf-statement-view";

export async function readPdfGlyphs(data: ArrayBuffer): Promise<{ glyphs: PdfGlyph[] } | { failure: PdfReadFailure }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  try {
    return { glyphs: await glyphsFromDocument(await task.promise) };
```

replace with:

```ts
import { glyphsFromDocument, pdfFailure, type PdfReadFailure } from "@/lib/domain/pdf-glyphs";
import { PDF_MESSAGES } from "@/lib/domain/pdf-statement-view";

/** pdf.js and its worker, loaded the first time a PDF is read or drawn. */
export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  return pdfjs;
}

export async function readPdfGlyphs(data: ArrayBuffer): Promise<{ glyphs: PdfGlyph[] } | { failure: PdfReadFailure }> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  try {
    return { glyphs: await glyphsFromDocument(await task.promise) };
```

Create `lib/client/pdf-pages.ts`:

```ts
/**
 * A kept PDF drawn as pictures of its pages (1.83), by the same pdf.js that
 * reads statements. Nothing in the file is opened by the browser or run: each
 * page is painted onto a canvas and shown as an image, so a file that was never
 * virus-scanned is looked at, not opened.
 */
import { pdfFailure, type PdfReadFailure } from "@/lib/domain/pdf-glyphs";
import { loadPdfjs } from "@/lib/client/pdf-text";

/** The most pages drawn; a statement is a few pages, and Download has the rest. */
export const PDF_PAGE_LIMIT = 40;

export interface PdfPageImages {
  /** PNG data URLs, one per page drawn, in order. */
  images: string[];
  pageCount: number;
}

export async function pdfPageImages(
  data: ArrayBuffer,
  cssWidth: number,
): Promise<PdfPageImages | { failure: PdfReadFailure }> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0, enableXfa: false });
  try {
    const pdf = await task.promise;
    const images: string[] = [];
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    for (let n = 1; n <= Math.min(pdf.numPages, PDF_PAGE_LIMIT); n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      images.push(canvas.toDataURL("image/png"));
      page.cleanup();
    }
    return { images, pageCount: pdf.numPages };
  } catch (error) {
    return { failure: pdfFailure(error) };
  } finally {
    await task.destroy();
  }
}
```

Create `lib/client/saved-file-download.ts`:

```ts
"use client";
import { savedReportDownloadUrlAction } from "@/app/(app)/reports/saved/actions";

/**
 * Download a file kept in Reports › Saved through a link that lives a minute.
 *
 * The tab is opened before the link is asked for, so a browser that blocks a
 * window opened after an await still lets it through; it is cut from this page
 * (`opener = null`). Returns the reason when the link could not be made.
 */
export async function downloadSavedFile(id: string): Promise<string | null> {
  const opened = window.open("about:blank");
  if (opened) opened.opener = null;
  const result = await savedReportDownloadUrlAction(id);
  if (!result.ok || !result.data) {
    opened?.close();
    return result.error ?? "Could not prepare the download";
  }
  if (opened) opened.location.href = result.data.url;
  else window.location.href = result.data.url;
  return null;
}
```

- [ ] **Step 4: The viewer.** Create `components/statement-file/StatementFileViewer.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Alert, Spin, Typography } from "antd";
import { savedReportPreview, savedReportView, type SavedReportPreview } from "@/lib/domain/saved-reports";
import { PDF_MESSAGES } from "@/lib/domain/pdf-statement-view";
import { savedReportDownloadUrlAction, savedReportPreviewAction } from "@/app/(app)/reports/saved/actions";
import DataTable from "@/components/ui/DataTable";

/** The width a page is drawn at; the image scales down with the screen. */
const PAGE_WIDTH = 860;

export interface StatementFileViewerProps {
  /** The saved file's id in Reports › Saved. */
  id: string;
  mimeType: string;
}

/** One row of the preview grid, carried with its position so it needs no key of its own. */
interface PreviewRow {
  index: number;
  row: string[];
}

type Loaded =
  | { id: string; kind: "pdf"; images: string[]; pageCount: number }
  | { id: string; kind: "table"; preview: SavedReportPreview }
  | { id: string; kind: "text"; text: string }
  | { id: string; problem: string };

async function load(id: string, mimeType: string): Promise<Loaded> {
  const view = savedReportView(mimeType);
  if (view === "pdf") {
    // The bytes come through a link that lives a minute, and are drawn here —
    // the browser is never handed the file to open.
    const link = await savedReportDownloadUrlAction(id);
    if (!link.ok || !link.data) return { id, problem: link.error ?? "Could not read the file" };
    const response = await fetch(link.data.url);
    if (!response.ok) return { id, problem: "Could not read the file" };
    const { pdfPageImages } = await import("@/lib/client/pdf-pages");
    const drawn = await pdfPageImages(await response.arrayBuffer(), PAGE_WIDTH);
    if ("failure" in drawn) return { id, problem: PDF_MESSAGES[drawn.failure] };
    return { id, kind: "pdf", ...drawn };
  }
  const read = await savedReportPreviewAction(id);
  if (!read.ok || !read.data) return { id, problem: read.error ?? "Could not read the file" };
  return view === "table"
    ? { id, kind: "table", preview: savedReportPreview(read.data.text) }
    : { id, kind: "text", text: read.data.text };
}

/**
 * A saved file shown inside OneBook. Nothing in the store is virus-scanned, so
 * nothing is opened by the browser: a PDF is drawn page by page as pictures, a
 * CSV is a table, a bank download (OFX, QFX, QBO, QIF) is plain text. Any
 * other format says so; Download beside it always has the original.
 */
export default function StatementFileViewer({ id, mimeType }: StatementFileViewerProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const view = savedReportView(mimeType);

  useEffect(() => {
    if (view === "download") return;
    let cancelled = false;
    load(id, mimeType)
      .catch((error: unknown) => ({ id, problem: error instanceof Error ? error.message : "Could not read the file" }))
      .then((result) => {
        if (!cancelled) setLoaded(result);
      });
    return () => {
      cancelled = true;
    };
  }, [id, mimeType, view]);

  if (view === "download") {
    return (
      <Alert
        type="info"
        showIcon
        message="This format is not shown in OneBook"
        description="OneBook shows PDF, CSV and bank download files on screen. Download the original to open this one."
      />
    );
  }

  // Keeping the id beside the result is what lets opening a second file show a
  // spinner rather than the first one's pages.
  const current = loaded?.id === id ? loaded : null;
  if (!current) return <Spin />;
  if ("problem" in current) return <Alert type="error" showIcon message={current.problem} />;

  if (current.kind === "pdf") {
    return (
      <div className="statement-file-pages">
        {current.pageCount > current.images.length ? (
          <Alert
            type="info"
            showIcon
            message={`Showing the first ${current.images.length} of ${current.pageCount} pages. Download the original for the rest.`}
          />
        ) : null}
        {current.images.map((src, index) => (
          // eslint-disable-next-line @next/next/no-img-element -- a page drawn in the browser, not a file Next can optimise
          <img key={index} src={src} alt={`Page ${index + 1}`} />
        ))}
      </div>
    );
  }

  if (current.kind === "text") {
    return (
      <Typography.Paragraph>
        <pre className="statement-file-text">{current.text}</pre>
      </Typography.Paragraph>
    );
  }

  return (
    <>
      {current.preview.truncated ? (
        <Alert type="info" showIcon message="Showing the first 500 rows. Download the original for the whole file." />
      ) : null}
      {/* A matrix: its columns are the file's own, as many as the file has. */}
      <DataTable<PreviewRow>
        fit={false}
        rowKey={(item) => String(item.index)}
        rows={current.preview.rows.map((row, index) => ({ index, row }))}
        columns={current.preview.headers.map((header, column) => ({
          title: header || `Column ${column + 1}`,
          key: String(column),
          render: (_: unknown, item: PreviewRow) => item.row[column] ?? "",
        }))}
      />
    </>
  );
}
```

In `app/globals.css` apply this edit (it adds the last block of the file):

Edit 1 of 1 — find:

```css
    display: none !important;
  }
}
```

replace with:

```css
    display: none !important;
  }
}

/* A kept statement file, drawn inside OneBook (1.83): each PDF page a picture
   of paper, as the bank printed it — white in dark mode too, because it is the
   bank's page, not OneBook's. A bank download is shown as the text it is. */
.statement-file-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.statement-file-pages img {
  display: block;
  width: 100%;
  max-width: 860px;
  height: auto;
  border: 1px solid var(--ob-border-default);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
}

.statement-file-text {
  margin: 0;
  max-height: 70vh;
  overflow: auto;
  padding: 12px 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ob-text-body);
  background: var(--ob-surface-subtle);
  border: 1px solid var(--ob-border-default);
  border-radius: 6px;
}
```

In `app/(app)/reports/saved/SavedReportViewer.tsx` apply these edits:

Edit 1 of 2 — find:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Drawer, Space, Spin, Table, Typography } from "antd";
import {
  isTabularSavedReport,
  savedReportPreview,
  type SavedReportPreview,
} from "@/lib/domain/saved-reports";
import type { SavedReportRow } from "@/lib/services/saved-reports";
import { savedReportDownloadUrlAction, savedReportPreviewAction } from "./actions";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const PREVIEW_DEFAULT_PAGE_SIZE = 25;

export interface SavedReportViewerProps {
  report: SavedReportRow | null;
  onClose: () => void;
}

/** One row of the preview grid, carried with its position so it needs no key of its own. */
interface PreviewRow {
  index: number;
  row: string[];
}

/**
 * What was read, and which report it was read for.
 *
 * Keeping the id alongside the result is what lets opening a second report show
 * a spinner rather than the first one's rows — without an effect that clears
 * state synchronously and re-renders everything twice.
 */
interface LoadedPreview {
  id: string;
  preview?: SavedReportPreview;
  problem?: string;
}

/**
 * Reading a report without leaving One Book.
 *
 * A CSV is shown as a table; anything else says so and offers the original.
 * Telling someone up front beats a click that ends in a format error.
 */
export default function SavedReportViewer({ report, onClose }: SavedReportViewerProps) {
  const { message } = App.useApp();
  const [loaded, setLoaded] = useState<LoadedPreview | null>(null);
  const [pageSize, setPageSize] = useState<number>(PREVIEW_DEFAULT_PAGE_SIZE);
  const tabular = Boolean(report) && isTabularSavedReport(report?.mime_type ?? "");

  useEffect(() => {
    if (!report || !isTabularSavedReport(report.mime_type)) return;
    let cancelled = false;
    savedReportPreviewAction(report.id).then((result) => {
      if (cancelled) return;
      setLoaded(
        result.ok && result.data
          ? { id: report.id, preview: savedReportPreview(result.data.text) }
          : { id: report.id, problem: result.error ?? "Could not read that report" },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [report]);

  const current = report && loaded?.id === report.id ? loaded : null;

  const download = useCallback(async () => {
    if (!report) return;
    const opened = window.open("about:blank");
    if (opened) opened.opener = null;
    const result = await savedReportDownloadUrlAction(report.id);
    if (!result.ok || !result.data) {
      opened?.close();
      message.error(result.error ?? "Could not prepare the download");
      return;
    }
    if (opened) opened.location.href = result.data.url;
    else window.location.href = result.data.url;
  }, [report, message]);

  return (
```

replace with:

```tsx
"use client";
import { useCallback } from "react";
import { Alert, App, Button, Drawer, Space, Typography } from "antd";
import type { SavedReportRow } from "@/lib/services/saved-reports";
import StatementFileViewer from "@/components/statement-file/StatementFileViewer";
import { downloadSavedFile } from "@/lib/client/saved-file-download";

export interface SavedReportViewerProps {
  report: SavedReportRow | null;
  onClose: () => void;
}

/**
 * Reading a report without leaving One Book.
 *
 * A CSV is shown as a table, a PDF drawn page by page, a bank download as its
 * text (1.83); anything else says so and offers the original. Telling someone
 * up front beats a click that ends in a format error.
 */
export default function SavedReportViewer({ report, onClose }: SavedReportViewerProps) {
  const { message } = App.useApp();

  const download = useCallback(async () => {
    if (!report) return;
    const problem = await downloadSavedFile(report.id);
    if (problem) message.error(problem);
  }, [report, message]);

  return (
```

Edit 2 of 2 — find:

```tsx
            />
          ) : null}

          {!tabular ? (
            <Alert
              type="info"
              showIcon
              message="This format is not shown as a table"
              description="One Book shows saved CSV files on screen. Download the original to open this one."
            />
          ) : current?.problem ? (
            <Alert type="error" showIcon message={current.problem} />
          ) : !current?.preview ? (
            <Spin />
          ) : (
            <>
              {current.preview.truncated ? (
                <Alert
                  type="info"
                  showIcon
                  message="Showing the first 500 rows. Download the original for the whole report."
                />
              ) : null}
              <Table<PreviewRow>
                size="small"
                rowKey={(item) => String(item.index)}
                pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PREVIEW_DEFAULT_PAGE_SIZE))}
                scroll={{ x: true }}
                dataSource={current.preview.rows.map((row, index) => ({ index, row }))}
                columns={current.preview.headers.map((header, column) => ({
                  title: header || `Column ${column + 1}`,
                  key: String(column),
                  render: (_: unknown, item: PreviewRow) => item.row[column] ?? "",
                }))}
              />
            </>
          )}
        </Space>
      ) : null}
    </Drawer>
```

replace with:

```tsx
            />
          ) : null}

          <StatementFileViewer id={report.id} mimeType={report.mime_type} />
        </Space>
      ) : null}
    </Drawer>
```

- [ ] **Step 5: The page.** Create `app/(app)/banking/statement-files/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSavedReport, SavedReportError, type SavedReportRow } from "@/lib/services/saved-reports";
import PageHeader from "@/components/PageHeader";
import StatementFileClient from "./StatementFileClient";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A kept statement file (1.83), shown inside OneBook: read through the
 * session, so a file this company does not hold — or this person may not read
 * — is not found.
 */
export default async function StatementFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sb = await createSupabaseServerClient();
  let file: SavedReportRow;
  try {
    file = await getSavedReport(sb, id);
  } catch (error) {
    if (error instanceof SavedReportError) notFound();
    throw error;
  }
  return (
    <div>
      <PageHeader
        title={file.title}
        description="The statement file as the bank gave it, kept when OneBook read it. Shown here, never opened; Download has the original."
      />
      <StatementFileClient file={file} />
    </div>
  );
}
```

Create `app/(app)/banking/statement-files/[id]/StatementFileClient.tsx`:

```tsx
"use client";
import { Alert, App, Button, Card, Space, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import StatementFileViewer from "@/components/statement-file/StatementFileViewer";
import { downloadSavedFile } from "@/lib/client/saved-file-download";
import { shortSha } from "@/lib/domain/statement-evidence";
import type { SavedReportRow } from "@/lib/services/saved-reports";

export default function StatementFileClient({ file }: { file: SavedReportRow }) {
  const { message } = App.useApp();

  async function download() {
    const problem = await downloadSavedFile(file.id);
    if (problem) message.error(problem);
  }

  return (
    <Card
      extra={
        <Button icon={<DownloadOutlined />} onClick={() => void download()}>
          Download
        </Button>
      }
      title={file.file_name}
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          Kept {file.uploaded_at.slice(0, 10)} · SHA-256 {shortSha(file.sha256)}
        </Typography.Text>
        {file.status === "archived" ? (
          <Alert
            type="warning"
            showIcon
            message="This file is archived"
            description={file.archive_reason ?? "No reason was recorded."}
          />
        ) : null}
        <StatementFileViewer id={file.id} mimeType={file.mime_type} />
      </Space>
    </Card>
  );
}
```

- [ ] **Step 6: Run them again.**

Run: `npx vitest run tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/no-hardcoded-color.test.ts`
Expected: every test passes.
Run: `npm run typecheck` and `npx eslint components/statement-file lib/client "app/(app)/banking/statement-files" "app/(app)/reports/saved"` — Expected: no errors.

- [ ] **Step 7: Commit.**

```bash
git add lib/client/pdf-pages.ts lib/client/saved-file-download.ts components/statement-file/StatementFileViewer.tsx "app/(app)/banking/statement-files/[id]/page.tsx" "app/(app)/banking/statement-files/[id]/StatementFileClient.tsx" lib/client/pdf-text.ts "app/(app)/reports/saved/SavedReportViewer.tsx" app/globals.css tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts
printf 'feat(statement-files): view a kept file inside OneBook, a PDF drawn page by page\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 6: Banking › Import statement keeps its file

**Files:**
- Create: `lib/client/keep-statement-file.ts`
- Modify: `app/(app)/banking/ImportStatementModal.tsx` (five edits)
- Modify: `app/(app)/banking/BankingClient.tsx` (four edits)
- Modify: `app/(app)/banking/BankImportList.tsx` (two edits)

**Interfaces:**
- Consumes: `prepareStatementFileAction`, `keepStatementFileAction` (Task 4); `statementFileMime`, `statementFileRefusal`, `statementFileTitle`, `statementFileAccount`, `linesSpan`, `keepFailureMessage` (Task 2); `calculateFileSha256` (existing, `lib/client/documents.ts` — read only, not changed).
- Produces:
  - `lib/client/keep-statement-file.ts`: `KeptStatementFile = { ok: true; id } | { ok: false; reason }`, `keepStatementFile(file, account, period): Promise<KeptStatementFile>` — never throws;
  - `ImportStatementModal`: `onConfirm(fileName, rows, statement, file: File)`; optional props `title` and `okLabel` (used by Attach the statement in Task 7).

- [ ] **Step 1: The keep flow.** Create `lib/client/keep-statement-file.ts`:

```ts
"use client";
/**
 * Keeps a statement file as evidence (1.83): hashed in the browser, uploaded
 * once to the Reports › Saved store through a one-time ticket, and recorded by
 * the company's own function. The same file — same SHA-256 — is found, not
 * uploaded again. Never throws: a file that cannot be kept comes back with the
 * reason, and whatever was being done with it goes on without it.
 */
import { calculateFileSha256 } from "@/lib/client/documents";
import {
  statementFileMime,
  statementFileRefusal,
  statementFileTitle,
  type StatementPeriod,
} from "@/lib/domain/statement-evidence";
import { keepStatementFileAction, prepareStatementFileAction } from "@/app/(app)/banking/statement-file-actions";

export type KeptStatementFile = { ok: true; id: string } | { ok: false; reason: string };

export async function keepStatementFile(
  file: File,
  account: string,
  period: StatementPeriod,
): Promise<KeptStatementFile> {
  const refusal = statementFileRefusal(file);
  if (refusal) return { ok: false, reason: refusal };
  const mimeType = statementFileMime(file.name, file.type)!;
  try {
    const sha256 = await calculateFileSha256(file);
    const prepared = await prepareStatementFileAction(sha256, mimeType);
    if (!prepared.ok || !prepared.data) return { ok: false, reason: prepared.error ?? "the upload could not be prepared" };
    if ("keptId" in prepared.data) return { ok: true, id: prepared.data.keptId };

    const { path, token, bucket } = prepared.data.ticket;
    const { createSupabaseBrowserClient } = await import("@/lib/db/client");
    const upload = await createSupabaseBrowserClient()
      .storage.from(bucket)
      .uploadToSignedUrl(path, token, file, { contentType: mimeType });
    if (upload.error) return { ok: false, reason: upload.error.message };

    const kept = await keepStatementFileAction({
      title: statementFileTitle(account, period),
      period_start: period.from,
      period_end: period.to,
      file_name: file.name,
      storage_path: path,
      mime_type: mimeType,
      size_bytes: file.size,
      sha256,
    });
    if (!kept.ok || !kept.data) return { ok: false, reason: kept.error ?? "it was not recorded" };
    return { ok: true, id: kept.data.id };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "an unexpected error occurred" };
  }
}
```

- [ ] **Step 2: The dialog hands back the file.** In `app/(app)/banking/ImportStatementModal.tsx` apply these edits:

Edit 1 of 5 — find:

```tsx
  open: boolean;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
  importing: boolean;
  /** `statement` is the PDF statement imported, with its period and balances; null for any other file. */
  onConfirm: (fileName: string, rows: StatementLine[], statement: PdfStatement | null) => void;
  onCancel: () => void;
  /** What happens to the lines, said above the file picker. */
  intro?: ReactNode;
}

const BANKING_INTRO =
```

replace with:

```tsx
  open: boolean;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
  importing: boolean;
  /**
   * `statement` is the PDF statement imported, with its period and balances;
   * null for any other file. `file` is the file itself, kept as evidence (1.83).
   */
  onConfirm: (fileName: string, rows: StatementLine[], statement: PdfStatement | null, file: File) => void;
  onCancel: () => void;
  /** What happens to the lines, said above the file picker. */
  intro?: ReactNode;
  /** The dialog's title and button when the file is read for something other than importing it (Attach the statement). */
  title?: string;
  okLabel?: string;
}

const BANKING_INTRO =
```

Edit 2 of 5 — find:

```tsx
  onConfirm,
  onCancel,
  intro = BANKING_INTRO,
}: ImportStatementModalProps) {
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<FileState>({ kind: "none" });
  const [choice, setChoice] = useState<CsvChoice | null>(null);
  const [showColumns, setShowColumns] = useState(false);
```

replace with:

```tsx
  onConfirm,
  onCancel,
  intro = BANKING_INTRO,
  title,
  okLabel,
}: ImportStatementModalProps) {
  const [fileName, setFileName] = useState("");
  const [chosen, setChosen] = useState<File | null>(null);
  const [file, setFile] = useState<FileState>({ kind: "none" });
  const [choice, setChoice] = useState<CsvChoice | null>(null);
  const [showColumns, setShowColumns] = useState(false);
```

Edit 3 of 5 — find:

```tsx
  function read(chosen: File) {
    const token = ++reading.current;
    setFileName(chosen.name);
    setShowColumns(false);
    setChoice(null);
    if (isPdfFile(chosen)) {
```

replace with:

```tsx
  function read(chosen: File) {
    const token = ++reading.current;
    setFileName(chosen.name);
    setChosen(chosen);
    setShowColumns(false);
    setChoice(null);
    if (isPdfFile(chosen)) {
```

Edit 4 of 5 — find:

```tsx
  const wrongAccount = accountNumberDiffers(fileAccount, bankAccount.maskedNumber);
  const wrongAccountText = `The file is for an account ending ${(fileAccount ?? "").slice(-4)}, and you are importing into ${bankAccount.label}. Check before importing.`;

  const okText = !rows.length
    ? "Import"
    : summary
      ? `Import ${rows.length} line${rows.length === 1 ? "" : "s"}${summary.proves ? "" : " anyway"}`
      : `Import ${rows.length} rows`;

  function confirm() {
    if (!rows.length) return;
    if (file.kind === "csv" && choice) rememberColumns(bankAccount.id, choice);
    onConfirm(fileName, rows, statement);
  }

  // Choosing the date column reads that column again for which way round its
```

replace with:

```tsx
  const wrongAccount = accountNumberDiffers(fileAccount, bankAccount.maskedNumber);
  const wrongAccountText = `The file is for an account ending ${(fileAccount ?? "").slice(-4)}, and you are importing into ${bankAccount.label}. Check before importing.`;

  const okText =
    okLabel ??
    (!rows.length
      ? "Import"
      : summary
        ? `Import ${rows.length} line${rows.length === 1 ? "" : "s"}${summary.proves ? "" : " anyway"}`
        : `Import ${rows.length} rows`);

  function confirm() {
    if (!rows.length || !chosen) return;
    if (file.kind === "csv" && choice) rememberColumns(bankAccount.id, choice);
    onConfirm(fileName, rows, statement, chosen);
  }

  // Choosing the date column reads that column again for which way round its
```

Edit 5 of 5 — find:

```tsx

  return (
    <Modal
      title={`Import a statement into ${bankAccount.label}`}
      open={open}
      onOk={confirm}
      onCancel={onCancel}
```

replace with:

```tsx

  return (
    <Modal
      title={title ?? `Import a statement into ${bankAccount.label}`}
      open={open}
      onOk={confirm}
      onCancel={onCancel}
```

- [ ] **Step 3: Banking keeps it and shows it.** In `app/(app)/banking/BankingClient.tsx` apply these edits:

Edit 1 of 4 — find:

```tsx
import { TOKENS } from "@/lib/design/tokens";
import SettleFromBankModal, { type SettleTarget } from "@/components/banking/SettleFromBankModal";
import type { StatementLine } from "@/lib/domain/statement-import";
import { formatMoney } from "@/lib/format";
import { codableAccount, codingAccountOf, type CodingSuggestionView } from "@/lib/domain/coding";
import { ruleSeedText } from "@/lib/domain/bank-rules";
```

replace with:

```tsx
import { TOKENS } from "@/lib/design/tokens";
import SettleFromBankModal, { type SettleTarget } from "@/components/banking/SettleFromBankModal";
import type { StatementLine } from "@/lib/domain/statement-import";
import type { PdfStatement } from "@/lib/domain/pdf-statement";
import { keepFailureMessage, linesSpan, statementFileAccount } from "@/lib/domain/statement-evidence";
import { formatMoney } from "@/lib/format";
import { codableAccount, codingAccountOf, type CodingSuggestionView } from "@/lib/domain/coding";
import { ruleSeedText } from "@/lib/domain/bank-rules";
```

Edit 2 of 4 — find:

```tsx

  // Reading the file — every format, and a CSV's columns — happens in
  // ImportStatementModal, from rules in lib/domain that are covered by tests.
  async function confirmImport(fileName: string, rows: StatementLine[]) {
    if (!selectedId || !rows.length) return;
    setBusy("import");
    const result = await importStatementAction(selectedId, fileName, rows);
    setBusy(null);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Import failed");
```

replace with:

```tsx

  // Reading the file — every format, and a CSV's columns — happens in
  // ImportStatementModal, from rules in lib/domain that are covered by tests.
  async function confirmImport(fileName: string, rows: StatementLine[], pdf: PdfStatement | null, file: File) {
    if (!selectedId || !selected || !rows.length) return;
    setBusy("import");
    // The file is kept first, so the import can point at it (1.83). A file
    // that cannot be kept costs only the file: the lines are imported anyway.
    const { keepStatementFile } = await import("@/lib/client/keep-statement-file");
    const kept = await keepStatementFile(
      file,
      statementFileAccount(selected.bank_name || selected.account_name, selected.account_number_masked),
      pdf ? { from: pdf.from, to: pdf.to } : linesSpan(rows),
    );
    const result = await importStatementAction(selectedId, fileName, rows, kept.ok ? kept.id : null);
    setBusy(null);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Import failed");
```

Edit 3 of 4 — find:

```tsx
    message.success(
      `Imported ${result.data.inserted} line(s); ${result.data.skipped} duplicate(s) skipped`,
    );
    setImportOpen(false);
    setImportsKey((count) => count + 1);
    // Straight on to Review import, where every new line carries a proposal.
```

replace with:

```tsx
    message.success(
      `Imported ${result.data.inserted} line(s); ${result.data.skipped} duplicate(s) skipped`,
    );
    if (!kept.ok) message.warning(keepFailureMessage(kept.reason, "import"), 8);
    setImportOpen(false);
    setImportsKey((count) => count + 1);
    // Straight on to Review import, where every new line carries a proposal.
```

Edit 4 of 4 — find:

```tsx
            currencyCode: selected.currency_code,
          }}
          importing={busy === "import"}
          onConfirm={(fileName, rows) => void confirmImport(fileName, rows)}
          onCancel={() => setImportOpen(false)}
        />
      ) : null}
```

replace with:

```tsx
            currencyCode: selected.currency_code,
          }}
          importing={busy === "import"}
          onConfirm={(fileName, rows, pdf, file) => void confirmImport(fileName, rows, pdf, file)}
          onCancel={() => setImportOpen(false)}
        />
      ) : null}
```

In `app/(app)/banking/BankImportList.tsx` apply these edits:

Edit 1 of 2 — find:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Modal, Space, Table, Tag, Tooltip } from "antd";
import type { BankStatementImportRow } from "@/lib/services/banking";
import { getStatementImportsAction, undoStatementImportAction } from "./actions";
```

replace with:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { App, Button, Input, Modal, Space, Table, Tag, Tooltip } from "antd";
import type { BankStatementImportRow } from "@/lib/services/banking";
import { getStatementImportsAction, undoStatementImportAction } from "./actions";
```

Edit 2 of 2 — find:

```tsx
        dataSource={rows}
        locale={{ emptyText: "No statement has been imported into this company yet." }}
        columns={[
          { title: "File", dataIndex: "filename" },
          {
            title: "Into",
            width: 240,
```

replace with:

```tsx
        dataSource={rows}
        locale={{ emptyText: "No statement has been imported into this company yet." }}
        columns={[
          {
            title: "File",
            dataIndex: "filename",
            // The file itself, kept when it was read (1.83); imports before then kept only its name.
            render: (filename: string, row) =>
              row.statement_file_id ? (
                <Space size={8}>
                  <span>{filename}</span>
                  <Link href={`/banking/statement-files/${row.statement_file_id}`}>View</Link>
                </Space>
              ) : (
                filename
              ),
          },
          {
            title: "Into",
            width: 240,
```

- [ ] **Step 4: Check.**

Run: `npm run typecheck` and `npx eslint "app/(app)/banking" lib/client` — Expected: no errors.
Run: `npx vitest run tests/unit/shell-bundle.test.ts tests/unit/table-adoption.test.ts` — Expected: every test passes.

- [ ] **Step 5: Commit.**

```bash
git add lib/client/keep-statement-file.ts "app/(app)/banking/ImportStatementModal.tsx" "app/(app)/banking/BankingClient.tsx" "app/(app)/banking/BankImportList.tsx"
printf 'feat(banking): Import statement keeps the file, and Statement imports show it\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 7: Reconciliations keep their file, show it, and take one later

**Files:**
- Modify: `app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx` (nine edits)
- Modify: `app/(app)/banking/reconcile/[id]/page.tsx` (two edits)
- Modify: `app/(app)/banking/reconcile/[id]/report/page.tsx` (two edits)
- Modify: `app/(app)/banking/reconcile/from-files/FromFilesClient.tsx` (ten edits)
- Modify: `app/(app)/banking/reconcile/from-files/page.tsx` (two edits)

**Interfaces:**
- Consumes: `keepStatementFile` and the dialog's `file`, `title`, `okLabel` (Task 6); `attachStatementFileAction` (Task 4); `statementFileMismatch`, `keepFailureMessage`, `linesSpan`, `statementFileSpan`, `statementFileAccount`, `shortSha` (Task 2); `downloadSavedFile` (Task 5); `ReconStatement.statementFile` / `statementFileId` (Task 4).
- Produces: the workspace's line "Statement file: <name> · View · Download", or "No statement file · Attach the statement"; the report's file line; From statement files keeps each file once before the first month and passes `statement_file_id` with every month.

- [ ] **Step 1: The workspace.** In `app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx` apply these edits:

Edit 1 of 9 — find:

```tsx
  Tag,
  Typography,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { fromMinor } from "@/lib/domain/money";
import type { PdfStatement } from "@/lib/domain/pdf-statement";
import type { StatementLine } from "@/lib/domain/statement-import";
```

replace with:

```tsx
  Tag,
  Typography,
} from "antd";
import { PaperClipOutlined, UploadOutlined } from "@ant-design/icons";
import { fromMinor } from "@/lib/domain/money";
import type { PdfStatement } from "@/lib/domain/pdf-statement";
import type { StatementLine } from "@/lib/domain/statement-import";
```

Edit 2 of 9 — find:

```tsx
  reconciliationStandings,
} from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
import {
  reconciliationLinesAction,
  reconciliationDetailAction,
```

replace with:

```tsx
  reconciliationStandings,
} from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
import { shortDate } from "@/lib/domain/pdf-statement-view";
import { keepFailureMessage, linesSpan, statementFileMismatch } from "@/lib/domain/statement-evidence";
import { downloadSavedFile } from "@/lib/client/saved-file-download";
import { attachStatementFileAction } from "../../statement-file-actions";
import {
  reconciliationLinesAction,
  reconciliationDetailAction,
```

Edit 3 of 9 — find:

```tsx
  baseCurrency: string;
  baseDecimals: number;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
}

export default function ReconcileWorkspaceClient({
```

replace with:

```tsx
  baseCurrency: string;
  baseDecimals: number;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
  /** The account a kept statement file is named after: "Example Bank ****1183". */
  fileAccount: string;
}

export default function ReconcileWorkspaceClient({
```

Edit 4 of 9 — find:

```tsx
  baseCurrency,
  baseDecimals,
  bankAccount,
}: Props) {
  const { message, modal } = App.useApp();
  const [lines, setLines] = useState<ReconLineView[]>([]);
```

replace with:

```tsx
  baseCurrency,
  baseDecimals,
  bankAccount,
  fileAccount,
}: Props) {
  const { message, modal } = App.useApp();
  const [lines, setLines] = useState<ReconLineView[]>([]);
```

Edit 5 of 9 — find:

```tsx
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [form] = Form.useForm();
```

replace with:

```tsx
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [matching, setMatching] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [form] = Form.useForm();
```

Edit 6 of 9 — find:

```tsx
   * Transactions and paired with the books — without leaving the page the
   * statement is being worked from.
   */
  async function importStatement(fileName: string, rows: StatementLine[], pdf: PdfStatement | null) {
    setImporting(true);
    const res = await importStatementIntoReconciliationAction(reconciliationId, {
      file_name: fileName,
      opening_minor: pdf?.openingMinor ?? null,
      closing_minor: pdf?.closingMinor ?? null,
      lines: rows,
    });
    setImporting(false);
    if (!res.ok || !res.data) {
```

replace with:

```tsx
   * Transactions and paired with the books — without leaving the page the
   * statement is being worked from.
   */
  async function importStatement(fileName: string, rows: StatementLine[], pdf: PdfStatement | null, file: File) {
    setImporting(true);
    // Kept first, so the reconciliation takes its file with its lines (1.83);
    // a file that cannot be kept costs only the file.
    const { keepStatementFile } = await import("@/lib/client/keep-statement-file");
    const kept = await keepStatementFile(file, fileAccount, pdf ? { from: pdf.from, to: pdf.to } : linesSpan(rows));
    const res = await importStatementIntoReconciliationAction(reconciliationId, {
      file_name: fileName,
      opening_minor: pdf?.openingMinor ?? null,
      closing_minor: pdf?.closingMinor ?? null,
      lines: rows,
      statement_file_id: kept.ok ? kept.id : null,
    });
    setImporting(false);
    if (!res.ok || !res.data) {
```

Edit 7 of 9 — find:

```tsx
      `${res.data.inserted} new in Bank Transactions, ${res.data.duplicates} already there. ${pairingMessage(res.data.outcome)}`,
      8,
    );
    void load();
  }

  async function matchAgain() {
    setMatching(true);
    const res = await matchAgainAction(reconciliationId);
```

replace with:

```tsx
      `${res.data.inserted} new in Bank Transactions, ${res.data.duplicates} already there. ${pairingMessage(res.data.outcome)}`,
      8,
    );
    if (!kept.ok) message.warning(keepFailureMessage(kept.reason, "reconciliation"), 10);
    void load();
  }

  /**
   * Attach the statement to a reconciliation that has no file: read here with
   * the same readers, attached only when it is this reconciliation's statement
   * — otherwise nothing is kept and the message says what differs.
   */
  async function attachStatement(rows: StatementLine[], pdf: PdfStatement | null, file: File) {
    if (!statement || !detail) return;
    const read = {
      to: pdf?.to ?? null,
      closingMinor: pdf?.closingMinor ?? null,
      lines: rows.map((r) => ({ txn_date: r.txn_date, amount_minor: r.amount_minor })),
    };
    const mismatch = statementFileMismatch(
      read,
      {
        endingDate: statement.endingDate,
        endingMinor: detail.statementEndingMinor,
        keptLines: statement.lines.map((l) => ({ txn_date: l.txnDate, amount_minor: l.amountMinor })),
      },
      money,
    );
    if (mismatch) {
      message.error(mismatch, 10);
      return;
    }
    setAttaching(true);
    const { keepStatementFile } = await import("@/lib/client/keep-statement-file");
    const kept = await keepStatementFile(file, fileAccount, pdf ? { from: pdf.from, to: pdf.to } : linesSpan(rows));
    if (!kept.ok) {
      setAttaching(false);
      message.error(`The statement file could not be kept: ${kept.reason}.`, 10);
      return;
    }
    const res = await attachStatementFileAction({
      reconciliation_id: reconciliationId,
      file_id: kept.id,
      to: read.to,
      closing_minor: read.closingMinor,
      lines: read.lines,
    });
    setAttaching(false);
    if (!res.ok) {
      message.error(res.error ?? "Failed to attach the statement", 10);
      return;
    }
    setAttachOpen(false);
    message.success("The statement file is attached to this reconciliation.");
    void load();
  }

  async function download(id: string) {
    const problem = await downloadSavedFile(id);
    if (problem) message.error(problem);
  }

  async function matchAgain() {
    setMatching(true);
    const res = await matchAgainAction(reconciliationId);
```

Edit 8 of 9 — find:

```tsx
          Reopen
        </Button>
      )}
      {shownPlan ? (
        <AddMissingBox plan={shownPlan} bankAccountId={bankAccount.id} money={money} adding={adding} onAdd={() => void addAll()} />
      ) : null}
```

replace with:

```tsx
          Reopen
        </Button>
      )}
      {statement ? (
        <Space size={4} wrap>
          <PaperClipOutlined />
          {statement.statementFile ? (
            <>
              <Typography.Text>Statement file: {statement.statementFile.fileName}</Typography.Text>
              <Link href={`/banking/statement-files/${statement.statementFile.id}`}>View</Link>
              <Button type="link" size="small" onClick={() => void download(statement.statementFile!.id)}>
                Download
              </Button>
            </>
          ) : statement.statementFileId ? (
            <Typography.Text type="secondary">A statement file is kept with this reconciliation.</Typography.Text>
          ) : (
            <>
              <Typography.Text type="secondary">No statement file</Typography.Text>
              {canWrite ? (
                <Button type="link" size="small" onClick={() => setAttachOpen(true)}>
                  Attach the statement
                </Button>
              ) : null}
            </>
          )}
        </Space>
      ) : null}
      {shownPlan ? (
        <AddMissingBox plan={shownPlan} bankAccountId={bankAccount.id} money={money} adding={adding} onAdd={() => void addAll()} />
      ) : null}
```

Edit 9 of 9 — find:

```tsx
          bankAccount={bankAccount}
          importing={importing}
          intro={IMPORT_INTRO}
          onConfirm={(fileName, rows, pdf) => void importStatement(fileName, rows, pdf)}
          onCancel={() => setImportOpen(false)}
        />
      ) : null}
    </Space>
  );
}
```

replace with:

```tsx
          bankAccount={bankAccount}
          importing={importing}
          intro={IMPORT_INTRO}
          onConfirm={(fileName, rows, pdf, file) => void importStatement(fileName, rows, pdf, file)}
          onCancel={() => setImportOpen(false)}
        />
      ) : null}
      {attachOpen && statement ? (
        <ImportStatementModal
          open={attachOpen}
          bankAccount={bankAccount}
          importing={attaching}
          title="Attach the statement"
          okLabel="Attach"
          intro={
            `Choose the bank's statement to ${shortDate(statement.endingDate, true)}. OneBook reads it here and attaches it ` +
            "only if it is this reconciliation's statement: the same closing balance and, when this reconciliation kept " +
            "the statement's lines, the same lines. Nothing in the reconciliation changes."
          }
          onConfirm={(_fileName, rows, pdf, file) => void attachStatement(rows, pdf, file)}
          onCancel={() => setAttachOpen(false)}
        />
      ) : null}
    </Space>
  );
}
```

In `app/(app)/banking/reconcile/[id]/page.tsx` apply these edits:

Edit 1 of 2 — find:

```tsx
import { listBankAccounts } from "@/lib/services/banking";
import { findReconciliationHeader } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ReconcileWorkspaceClient from "./ReconcileWorkspaceClient";
```

replace with:

```tsx
import { listBankAccounts } from "@/lib/services/banking";
import { findReconciliationHeader } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import { statementFileAccount } from "@/lib/domain/statement-evidence";
import PageHeader from "@/components/PageHeader";
import ReconcileWorkspaceClient from "./ReconcileWorkspaceClient";
```

Edit 2 of 2 — find:

```tsx
          decimals: base?.decimal_places ?? 2,
          currencyCode: bank?.currency_code ?? base?.code ?? "USD",
        }}
      />
    </div>
  );
```

replace with:

```tsx
          decimals: base?.decimal_places ?? 2,
          currencyCode: bank?.currency_code ?? base?.code ?? "USD",
        }}
        fileAccount={bank ? statementFileAccount(bank.bank_name || bank.account_name, bank.account_number_masked) : "Bank account"}
      />
    </div>
  );
```

- [ ] **Step 2: The report.** In `app/(app)/banking/reconcile/[id]/report/page.tsx` apply these edits:

Edit 1 of 2 — find:

```tsx
import { findReconciliationHeader, getReconciliationDetail, getReconciliationLines } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import { fromMinor } from "@/lib/domain/money";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";
```

replace with:

```tsx
import { findReconciliationHeader, getReconciliationDetail, getReconciliationLines } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import { fromMinor } from "@/lib/domain/money";
import { shortSha } from "@/lib/domain/statement-evidence";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";
```

Edit 2 of 2 — find:

```tsx
          {header.closingMinor !== null ? ` · closes at ${fmt(header.closingMinor)}` : ""}
        </p>
      ) : null}
      <table>
        <tbody>
          <tr><td>Beginning balance</td><td style={{ textAlign: "right" }}>{fmt(detail.beginningMinor)}</td></tr>
```

replace with:

```tsx
          {header.closingMinor !== null ? ` · closes at ${fmt(header.closingMinor)}` : ""}
        </p>
      ) : null}
      {/* The kept file, named so a printed report can be matched to it (1.83). */}
      {header.statementFile ? (
        <p>
          Statement file: {header.statementFile.fileName} · kept {header.statementFile.keptAt.slice(0, 10)} · SHA-256{" "}
          {shortSha(header.statementFile.sha256)} · <Link href={`/banking/statement-files/${header.statementFile.id}`}>View</Link>
        </p>
      ) : header.statementFileId ? (
        <p>A statement file is kept with this reconciliation.</p>
      ) : (
        <p>No statement file is kept with this reconciliation.</p>
      )}
      <table>
        <tbody>
          <tr><td>Beginning balance</td><td style={{ textAlign: "right" }}>{fmt(detail.beginningMinor)}</td></tr>
```

- [ ] **Step 3: From statement files.** In `app/(app)/banking/reconcile/from-files/FromFilesClient.tsx` apply these edits:

Edit 1 of 10 — find:

```tsx
  type RunStatement,
} from "@/lib/domain/statement-run";
import { formatMoney } from "@/lib/format";
import { previewRunAction, reconcileRunMonthAction } from "../statement-actions";
import StandingTag from "../StandingTag";
```

replace with:

```tsx
  type RunStatement,
} from "@/lib/domain/statement-run";
import { formatMoney } from "@/lib/format";
import { keepFailureMessage, statementFileSpan } from "@/lib/domain/statement-evidence";
import { previewRunAction, reconcileRunMonthAction } from "../statement-actions";
import StandingTag from "../StandingTag";
```

Edit 2 of 10 — find:

```tsx
interface Props {
  canWrite: boolean;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
  context: RunContext;
}

interface Done {
  signed: number;
  /** The month left in progress for a person, when there is one. */
```

replace with:

```tsx
interface Props {
  canWrite: boolean;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
  /** The account a kept statement file is named after: "Example Bank ****1183". */
  fileAccount: string;
  context: RunContext;
}

/** A statement read from a file, with the file — kept as its evidence when its month is signed (1.83). */
type ChosenStatement = RunStatement & { file?: File };

interface Done {
  signed: number;
  /** The month left in progress for a person, when there is one. */
```

Edit 3 of 10 — find:

```tsx
  }
}

export default function FromFilesClient({ canWrite, bankAccount, context }: Props) {
  const { message } = App.useApp();
  const router = useRouter();
  const [statements, setStatements] = useState<RunStatement[]>([]);
  const [reading, setReading] = useState(0);
  const [preview, setPreview] = useState<RunPreview | null>(null);
  // The statements the preview was walked on. Signing uses these and nothing
```

replace with:

```tsx
  }
}

export default function FromFilesClient({ canWrite, bankAccount, fileAccount, context }: Props) {
  const { message } = App.useApp();
  const router = useRouter();
  const [statements, setStatements] = useState<ChosenStatement[]>([]);
  const [reading, setReading] = useState(0);
  const [preview, setPreview] = useState<RunPreview | null>(null);
  // The statements the preview was walked on. Signing uses these and nothing
```

Edit 4 of 10 — find:

```tsx
    setPreview(null);
    setDone(null);
    try {
      const read = await readRunFile(file, bankAccount);
      setStatements((current) => {
        // A file chosen twice, or two files of one name, stay as rows: the
        // table says "Same month as another file" rather than one vanishing.
```

replace with:

```tsx
    setPreview(null);
    setDone(null);
    try {
      const read: ChosenStatement[] = (await readRunFile(file, bankAccount)).map((s) => ({ ...s, file }));
      setStatements((current) => {
        // A file chosen twice, or two files of one name, stay as rows: the
        // table says "Same month as another file" rather than one vanishing.
```

Edit 5 of 10 — find:

```tsx
      router.refresh();
    };
    const first = previewed[0];
    if (bringForward && first?.from && first.openingMinor !== null) {
      step += 1;
      setProgress(`Bringing the earlier lines forward — ${step} of ${total}`);
```

replace with:

```tsx
      router.refresh();
    };
    const first = previewed[0];
    const statementOfNeedsLook = needsLook ? previewedByKey.get(needsLook.key) : undefined;

    // Each file is kept once, before the first month is signed, and every
    // reconciliation made from it points at it: a CSV year cut into twelve
    // months is twelve reconciliations and one file. A file that cannot be kept
    // costs only the file — the months are signed all the same.
    const fileOfKey = new Map(statements.map((s) => [s.key, s.file]));
    const used = [
      ...(bringForward && first ? [first] : []),
      ...toSign.map((m) => previewedByKey.get(m.key)),
      statementOfNeedsLook,
    ].filter((st): st is RunStatement => Boolean(st));
    const byFile = new Map<File, RunStatement[]>();
    for (const st of used) {
      const file = fileOfKey.get(st.key);
      if (file) byFile.set(file, [...(byFile.get(file) ?? []).filter((s) => s.key !== st.key), st]);
    }
    const fileIdOf = new Map<string, string>();
    if (byFile.size) {
      const { keepStatementFile } = await import("@/lib/client/keep-statement-file");
      let kept = 0;
      for (const [file, read] of byFile) {
        kept += 1;
        setProgress(`Keeping the statement file${byFile.size === 1 ? "" : "s"} — ${kept} of ${byFile.size}`);
        const result = await keepStatementFile(file, fileAccount, statementFileSpan(read));
        if (result.ok) for (const st of read) fileIdOf.set(st.key, result.id);
        else message.warning(keepFailureMessage(`${file.name}: ${result.reason}`, "reconciliation"), 10);
      }
    }

    if (bringForward && first?.from && first.openingMinor !== null) {
      step += 1;
      setProgress(`Bringing the earlier lines forward — ${step} of ${total}`);
```

Edit 6 of 10 — find:

```tsx
        period_from: first.from,
        statement_date: first.to,
        opening_minor: first.openingMinor,
      });
      if (!res.ok) return finish({ signed, open: null, error: res.error ?? "The earlier lines could not be brought forward", broughtForward });
      broughtForward = true;
```

replace with:

```tsx
        period_from: first.from,
        statement_date: first.to,
        opening_minor: first.openingMinor,
        statement_file_id: fileIdOf.get(first.key) ?? null,
      });
      if (!res.ok) return finish({ signed, open: null, error: res.error ?? "The earlier lines could not be brought forward", broughtForward });
      broughtForward = true;
```

Edit 7 of 10 — find:

```tsx
        closing_minor: statement.closingMinor,
        statement_date: month.statementDate,
        lines: statement.lines,
        sign: true,
      });
      if (!res.ok || !res.data) return finish({ signed, open: null, error: res.error ?? "A month could not be signed off", broughtForward });
```

replace with:

```tsx
        closing_minor: statement.closingMinor,
        statement_date: month.statementDate,
        lines: statement.lines,
        statement_file_id: fileIdOf.get(statement.key) ?? null,
        sign: true,
      });
      if (!res.ok || !res.data) return finish({ signed, open: null, error: res.error ?? "A month could not be signed off", broughtForward });
```

Edit 8 of 10 — find:

```tsx
      signed += 1;
    }
    let open: Done["open"] = null;
    const statement = needsLook ? previewedByKey.get(needsLook.key) : undefined;
    if (needsLook && statement) {
      setProgress(`Starting ${shortDate(needsLook.statementDate, true)}, which needs a look`);
      const res = await reconcileRunMonthAction({
```

replace with:

```tsx
      signed += 1;
    }
    let open: Done["open"] = null;
    const statement = statementOfNeedsLook;
    if (needsLook && statement) {
      setProgress(`Starting ${shortDate(needsLook.statementDate, true)}, which needs a look`);
      const res = await reconcileRunMonthAction({
```

Edit 9 of 10 — find:

```tsx
        closing_minor: statement.closingMinor,
        statement_date: needsLook.statementDate,
        lines: statement.lines,
        sign: false,
      });
      if (!res.ok || !res.data) {
```

replace with:

```tsx
        closing_minor: statement.closingMinor,
        statement_date: needsLook.statementDate,
        lines: statement.lines,
        statement_file_id: fileIdOf.get(statement.key) ?? null,
        sign: false,
      });
      if (!res.ok || !res.data) {
```

Edit 10 of 10 — find:

```tsx
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Bank account <strong>{bankAccount.label}</strong>. Choose PDF statements, or a CSV export with a running balance
        column — one file or many. Every closing balance is read out of the file itself, never taken from the books. The
        files stay in your browser, and nothing is written until you sign off.
      </Typography.Paragraph>
      <Upload.Dragger
        multiple
```

replace with:

```tsx
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Bank account <strong>{bankAccount.label}</strong>. Choose PDF statements, or a CSV export with a running balance
        column — one file or many. Every closing balance is read out of the file itself, never taken from the books.
        Nothing is written until you sign off; then each file is kept, once, with the reconciliations made from it.
      </Typography.Paragraph>
      <Upload.Dragger
        multiple
```

In `app/(app)/banking/reconcile/from-files/page.tsx` apply these edits:

Edit 1 of 2 — find:

```tsx
import { listReconciliations } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import type { RunContext } from "@/lib/domain/statement-run";
import PageHeader from "@/components/PageHeader";
import FromFilesClient from "./FromFilesClient";
```

replace with:

```tsx
import { listReconciliations } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import type { RunContext } from "@/lib/domain/statement-run";
import { statementFileAccount } from "@/lib/domain/statement-evidence";
import PageHeader from "@/components/PageHeader";
import FromFilesClient from "./FromFilesClient";
```

Edit 2 of 2 — find:

```tsx
          decimals: base?.decimal_places ?? 2,
          currencyCode: bank.currency_code,
        }}
        context={context}
      />
    </div>
```

replace with:

```tsx
          decimals: base?.decimal_places ?? 2,
          currencyCode: bank.currency_code,
        }}
        fileAccount={statementFileAccount(bank.bank_name || bank.account_name, bank.account_number_masked)}
        context={context}
      />
    </div>
```

- [ ] **Step 4: Check.**

Run: `npm run typecheck` and `npx eslint "app/(app)/banking/reconcile"` — Expected: no errors.
Run: `npx vitest run tests/unit/reconcile-statement-service.test.ts tests/unit/statement-evidence.test.ts` — Expected: every test passes.

- [ ] **Step 5: Commit.**

```bash
git add "app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx" "app/(app)/banking/reconcile/[id]/page.tsx" "app/(app)/banking/reconcile/[id]/report/page.tsx" "app/(app)/banking/reconcile/from-files/FromFilesClient.tsx" "app/(app)/banking/reconcile/from-files/page.tsx"
printf 'feat(reconcile): keep the statement file, show it, and attach it later when it matches\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 8: Changelog 1.83, the guide, the whole suite

**Files:**
- Modify: `lib/domain/changelog.ts` (a new first entry of `RELEASES`)
- Modify: `lib/domain/system-guide.ts` (two reconciliation steps)

- [ ] **Step 1: The release.** In `lib/domain/changelog.ts` apply this edit:

Edit 1 of 1 — find:

```ts

/** Newest first. That is the order they are read in, so it is the order stored. */
export const RELEASES: Release[] = [
  {
    version: "1.82",
    date: "2026-10-06",
```

replace with:

```ts

/** Newest first. That is the order they are read in, so it is the order stored. */
export const RELEASES: Release[] = [
  {
    version: "1.83",
    date: "2026-10-06",
    headline: "The bank's statement file is kept with what was read from it, and can be opened later as evidence.",
    changes: [
      {
        kind: "added",
        title: "The statement file is kept",
        detail:
          "Every statement OneBook reads is now kept as the bank gave it: from Banking › Import statement, from Bank Reconciliation › From statement files, and from Import statement inside a reconciliation. Nothing to tick. The same file is kept once, however many reconciliations are made from it — a CSV year cut into twelve months is one file. If a file cannot be kept (larger than 10 MB, or the network fails), the import or the reconciliation goes on and the message says so.",
        route: "/banking/reconcile",
      },
      {
        kind: "added",
        title: "View the statement file",
        detail:
          "A reconciliation shows Statement file with View and Download, and its report names the file, the day it was kept and the first 12 characters of its SHA-256, so a printed report can be matched to the file. Statement imports on Banking show View beside the file name. View opens the file inside OneBook: a PDF drawn page by page, a CSV as a table, an OFX, QFX, QBO or QIF download as text — the file itself is never opened by the browser.",
        route: "/banking",
      },
      {
        kind: "added",
        title: "Attach the statement",
        detail:
          "A reconciliation without its file — one made before this release, or one whose file could not be kept — offers Attach the statement. The file chosen is read here and attached only if it is that reconciliation's statement: the same closing balance and, when the reconciliation kept the statement's lines, the same lines. Otherwise nothing is kept and the message says what differs. Attaching changes none of the reconciliation's figures.",
        route: "/banking/reconcile",
      },
      {
        kind: "changed",
        title: "Reports › Saved shows PDFs and bank downloads",
        detail:
          "Kept statement files are listed in Reports › Saved under Bank. Its viewer now draws a PDF page by page and shows a bank download as text, besides the CSV table it already had. A file that is the statement of a reconciliation or an import cannot be archived.",
        route: "/reports/saved",
      },
    ],
  },
  {
    version: "1.82",
    date: "2026-10-06",
```

- [ ] **Step 2: The guide.** In `lib/domain/system-guide.ts` apply this edit:

Edit 1 of 1 — find:

```ts
          "any reconciliation it is in, stay as they were. Undo recode takes it back, in a signed-off month too. A line in a signed-off month " +
          "cannot be taken back with Change — recode it instead.",
      },
      {
        action: "Reopen a completed reconciliation",
        control: "Reopen",
```

replace with:

```ts
          "any reconciliation it is in, stay as they were. Undo recode takes it back, in a signed-off month too. A line in a signed-off month " +
          "cannot be taken back with Change — recode it instead.",
      },
      {
        action: "View the statement file",
        control: "View",
        route: "/banking/reconcile",
        note:
          "Every statement OneBook reads is kept as the bank gave it, once however many reconciliations use it. " +
          "A reconciliation shows Statement file with View and Download, and its report names the file and the " +
          "first 12 characters of its SHA-256. View shows it inside OneBook — a PDF drawn page by page, a CSV as " +
          "a table, a bank download as text — without the browser ever opening the file.",
      },
      {
        action: "Attach the statement",
        control: "Attach the statement",
        route: "/banking/reconcile",
        note:
          "A reconciliation with no statement file — made before 1.83, or whose file could not be kept — takes " +
          "one here. The file is read in the browser and attached only if it is that reconciliation's statement: " +
          "the same closing balance and, when it kept the statement's lines, the same lines. Otherwise nothing " +
          "is kept and the message says what differs; the reconciliation's figures never change.",
      },
      {
        action: "Reopen a completed reconciliation",
        control: "Reopen",
```

- [ ] **Step 3: The whole suite and the build.**

Run: `npm run typecheck`, `npm run lint`, then `npm test`
Expected: no type errors; lint 0 errors (old warnings stay); every test file passes — the changelog and guide tests included (`APP_VERSION` is now 1.83, every route the release names exists). `tests/unit/quality-query-timing.test.ts` can fail when the machine is busy; if it alone fails, run it on its own and report both results.
Run: `npm run build` — Expected: `Compiled successfully`, exit code 0, and `/banking/statement-files/[id]` in the route list.
Run: `npm run quality:bundle`, then `npm run quality:budget` — Expected: `11 within budget, 0 over`, exit code 0.

- [ ] **Step 4: Commit.**

```bash
git add lib/domain/changelog.ts lib/domain/system-guide.ts
printf 'docs(changelog): 1.83 keep the statement file; view it; attach it later\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 9: Live (controller)

No new code. Every step that writes to the live database waits for the user.

- [ ] **Step 1:** Ask the user to approve applying 0135 to every company. Only then run `node --env-file=.env.local scripts/migrate.mjs`, run `scripts/verify-statement-files.mjs` again (rolled back), `npm run verify:company-provisioning` and `npm run verify:saved-report-bucket`.
- [ ] **Step 2:** On the sample company PC-Test only: a new bank account; invented statements — a PDF of one month, a CSV of three months with a running balance column, a QFX of one month — and an earlier reconciliation without a file (the 1.81 sample accounts).
- [ ] **Step 3:** In a real browser (`next start` started detached with its working directory set): Banking › Import statement with the QFX → Statement imports shows View → the text view; From statement files with the CSV → the three reconciliations point to one file, Reports › Saved lists it once under Bank; a reconciliation from the PDF → Statement file · View draws its pages, Download gives the original, the report shows the file line with 12 characters of SHA-256; Attach the statement on the earlier reconciliation → a file of another month refused with the message naming both, the right file attached; Reports › Saved refuses to archive a file in use.
- [ ] **Step 4:** Screenshots of each, light and dark, scrolled to the top before each full-page shot; an approval page beside them. Nothing is pushed until the user approves.
- [ ] **Step 5:** Ask the user whether what the check recorded on PC-Test stays as the sample company's history.
