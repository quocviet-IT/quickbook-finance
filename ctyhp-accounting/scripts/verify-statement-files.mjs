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
