/**
 * Behavioural verification of migration 0193 on every company's books: the
 * statement matching window is 5 days until a company saves its own, only
 * staff save it, only 0 to 31 days, and the duplicate check Add missing lines
 * relies on (acc_statement_line_duplicates) reads it.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0193 has not been applied it is applied first, inside that transaction.
 * Only a company marked is_sample has an entry posted in it: posting takes the
 * company's next entry number and holds it until the transaction ends. Every
 * other company is read: its window, and the duplicate check on one of its own
 * reconciliations.
 *
 * Run: node --env-file=.env.local scripts/verify-statement-match-window.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0193_statement_match_window.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 5 * 60 * 1000);
await client.connect();

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const as = (userId) =>
  client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: "authenticated" })]);
async function refusal(sql, params) {
  await client.query("savepoint trial");
  try {
    await client.query(sql, params);
    await client.query("release savepoint trial");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint trial");
    return error.message;
  }
}
const windowNow = async () => Number((await one(`select acc_statement_match_window() as d`)).d);

/** A company people work in: its window is 5, and the duplicate check runs on one of its own reconciliations. */
async function readOnlyChecks(admin) {
  await client.query("set local role authenticated");
  await as(admin.id);
  check("its window is the 5 days it always had", (await windowNow()) === 5);
  const rec = await one(
    `select r.id, array_agg(s.line_no order by s.line_no) as nos
       from acc_statement_reconciliation r
       join acc_reconciliation_statement_line s on s.reconciliation_id = r.id
      group by r.id order by max(r.statement_ending_date) desc limit 1`,
  );
  if (!rec) {
    console.log("  (no reconciliation with statement lines to check)");
    return;
  }
  const why = await refusal(`select count(*) from acc_statement_line_duplicates($1, $2::integer[])`, [rec.id, rec.nos.slice(0, 50)]);
  check("the duplicate check runs on its own reconciliation", why === null, why ?? "");
}

/** A sample company: save the window and see the duplicate check follow it. */
async function fullChecks(admin, base) {
  await client.query("reset role");
  const gl = (await one(
    `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
     values ('ZZ-VERIFY-MW-B', 'Verify match-window bank', 'bank', $1, true) returning id`,
    [base.code],
  )).id;
  const sales = (await one(
    `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
     values ('ZZ-VERIFY-MW-I', 'Verify match-window sales', 'income', $1, true) returning id`,
    [base.code],
  )).id;
  const bank = (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`, [gl, base.code])).id;
  const rec = (await one(
    `insert into acc_statement_reconciliation (bank_account_id, statement_ending_date, beginning_balance_minor, statement_ending_balance_minor, status)
     values ($1, '2026-07-31', 0, 4321, 'in_progress') returning id`,
    [bank],
  )).id;
  await client.query(
    `insert into acc_reconciliation_statement_line (reconciliation_id, line_no, txn_date, description, reference, amount_minor, balance_minor, set_aside)
     values ($1, 0, '2026-07-20', 'Verify deposit', null, 4321, null, false)`,
    [rec],
  );
  await client.query("set local role authenticated");
  await as(admin.id);
  // The books hold the same amount a week before the statement shows it.
  await one(`select acc_post_manual_journal('2026-07-13', 'Verify deposit', null, $1, $2::jsonb) as id`, [
    base.code,
    JSON.stringify([
      { account_id: gl, debit_minor: 4321, credit_minor: 0 },
      { account_id: sales, debit_minor: 0, credit_minor: 4321 },
    ]),
  ]);
  const duplicates = async () => Number((await one(`select count(*)::int as n from acc_statement_line_duplicates($1, array[0])`, [rec])).n);

  check("the window starts at 5 days", (await windowNow()) === 5);
  check("an entry 7 days from the line is not taken for it within 5 days", (await duplicates()) === 0);
  check("staff save a window of 7 days", (await refusal(`select acc_save_statement_match_window(7)`, [])) === null && (await windowNow()) === 7);
  check("the duplicate check then finds the entry 7 days away", (await duplicates()) === 1);
  check("a window of 0 days is the same day only", (await refusal(`select acc_save_statement_match_window(0)`, [])) === null && (await duplicates()) === 0);
  // Every row written in one transaction carries the same time, so the change is looked for by its values.
  const audit = await one(
    `select count(*)::int as n from acc_audit_log
      where table_name = 'acc_banking_preference'
        and before_json ->> 'match_window_days' = '7' and after_json ->> 'match_window_days' = '0'`,
  );
  check("the audit log keeps the window before and after", audit?.n === 1, JSON.stringify(audit));
  for (const bad of [32, -1]) {
    const why = await refusal(`select acc_save_statement_match_window($1)`, [bad]);
    check(`a window of ${bad} days is refused`, /Choose a window from 0 to 31 days/.test(why ?? ""), why ?? "not refused");
  }
  const nothing = await refusal(`select acc_save_statement_match_window(null)`, []);
  check("no window at all is refused", /Choose a window from 0 to 31 days/.test(nothing ?? ""), nothing ?? "not refused");
  await as(OUTSIDER);
  const outsider = await refusal(`select acc_save_statement_match_window(3)`, []);
  check("someone who is not staff cannot save it", /Not authorized to change the banking preferences/.test(outsider ?? ""), outsider ?? "not refused");
}

const { rows: companies } = await client.query(
  `select schema_name, is_sample from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema, is_sample: sample } of companies) {
    console.log(`\n${schema}${sample ? " (sample: every case)" : " (read only)"}`);
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '30s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        for (const statement of statements) await client.query(statement);
        console.log("  (0193 applied inside the transaction, never committed)");
      }
      const column = await one(
        `select column_default, is_nullable from information_schema.columns
          where table_schema = $1 and table_name = 'acc_banking_preference' and column_name = 'match_window_days'`,
        [schema],
      );
      check("the window column is there, not null, 5 by default", column?.column_default === "5" && column?.is_nullable === "NO", JSON.stringify(column));
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; the rest skipped)");
        continue;
      }
      if (sample) await fullChecks(admin, base);
      else await readOnlyChecks(admin);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  the run threw — ${error.message}`);
    } finally {
      await client.query("rollback");
    }
  }
} finally {
  clearTimeout(killer);
  await client.end().catch(() => {});
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
