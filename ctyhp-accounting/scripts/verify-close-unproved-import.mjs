/**
 * Verify migration 0146 (close the way round the statement proof) without
 * applying it: the migration's SQL runs inside a transaction that is always
 * rolled back, one company schema at a time.
 *
 *   every schema   a signed-in user may call the older acc_import_bank_statement
 *                  before 0146 and may not after; anon may not either; the
 *                  proved import stays granted; applying 0146 twice is harmless
 *   sample company an administrator imports an invented statement that adds up
 *                  through the proved import (which calls the older one as its
 *                  owner) and it goes in; the same person calling the older
 *                  import straight is refused
 *
 * Rows are written only in co_pc, the sample company, and rolled back. Counts
 * and pass/fail only are printed; every figure is invented.
 *
 *   node --env-file=.env.local scripts/verify-close-unproved-import.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { statementLineHashes } from "../lib/domain/banking-import.ts";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0146_close_unproved_statement_import.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OLD = "acc_import_bank_statement(uuid,text,jsonb)";
const PROVED = "acc_import_bank_statement_proved(uuid,text,jsonb,jsonb)";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 5 * 60 * 1000);
await client.connect();

const totals = [];
let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const as = (userId) =>
  client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);

const GRANTS = `
select has_function_privilege('authenticated', to_regprocedure($1 || '.' || $2), 'execute') as old_signed_in,
       has_function_privilege('anon', to_regprocedure($1 || '.' || $2), 'execute') as old_anon,
       has_function_privilege('authenticated', to_regprocedure($1 || '.' || $3), 'execute') as proved_signed_in`;

async function behaviour() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  const base = await one(`select code from acc_currency where is_base limit 1`);
  if (!admin || !base) {
    console.log("  (no active administrator or base currency; behaviour checks skipped)");
    return;
  }
  const stamp = Date.now().toString(36).toUpperCase();
  const gl = (await one(
    `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
     values ($1, 'Verify close bank', 'bank', $2, true) returning id`,
    [`ZZ-VCI-${stamp}`, base.code],
  )).id;
  const bank = (await one(
    `insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Close Bank', $2) returning id`,
    [gl, base.code],
  )).id;

  await client.query("set local role authenticated");
  await as(admin.id);

  const lines = [
    { txn_date: "2026-03-05", description: "INVENTED RENT", reference: null, amount_minor: -30000, running_balance_minor: null, raw_line: "2026-03-05,INVENTED RENT,-30000" },
  ];
  const hashes = statementLineHashes(bank, lines);
  const rows = lines.map((l, i) => ({ ...l, raw_hash: hashes[i], source: "file_upload" }));
  const proof = { opening_minor: 100000, closing_minor: 70000, opening_basis: "printed", closing_basis: "printed", set_aside: 0, override: null };

  const r = await one(
    `select inserted, skipped from acc_import_bank_statement_proved($1, 'verify-close.csv', $2::jsonb, $3::jsonb)`,
    [bank, JSON.stringify(rows), JSON.stringify(proof)],
  );
  check("a statement that adds up still goes in through the proved import", Number(r.inserted) === 1 && Number(r.skipped) === 0);

  await client.query("savepoint direct");
  try {
    await client.query(`select * from acc_import_bank_statement($1, 'verify-direct.csv', $2::jsonb)`, [bank, JSON.stringify(rows)]);
    check("calling the older import straight is refused", false, "it was accepted");
  } catch (error) {
    check("calling the older import straight is refused", /permission denied/i.test(error.message), error.message);
  } finally {
    await client.query("rollback to savepoint direct");
  }
  await client.query("reset role");
}

const { rows: companies } = await client.query(
  `select schema_name from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    const before = { passed, failed };
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '3s'");
      await client.query("set local statement_timeout = '60s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const was = await one(GRANTS, [schema, OLD, PROVED]);
      // Once 0146 is live the grant is already gone; that is a note, not a failure.
      if (was.old_signed_in === true) check("before 0146 a signed-in user may call the older import", true);
      else console.log("  (0146 is already live here: a signed-in user could not call the older import before this run)");
      const sql = schema === "public"
        ? MIGRATION
        : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements.join("\n;\n");
      await client.query(sql);
      await client.query(sql);
      check("applying 0146 twice is harmless", true);
      await client.query(`set local search_path = ${schema}, extensions`);
      const now = await one(GRANTS, [schema, OLD, PROVED]);
      check("after 0146 a signed-in user may not call the older import", now.old_signed_in === false);
      check("nor may anyone signed out", now.old_anon === false);
      check("the proved import stays granted", now.proved_signed_in === true);
      if (schema === SAMPLE) await behaviour();
    } catch (error) {
      failed += 1;
      console.log(`  FAIL ${schema} stopped: ${error.message}`);
    } finally {
      await client.query("rollback");
    }
    totals.push({ schema, passed: passed - before.passed, failed: failed - before.failed });
  }
} finally {
  clearTimeout(killer);
  await client.end();
}

console.log("");
for (const t of totals) console.log(`${t.schema}: ${t.passed} passed, ${t.failed} failed`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
