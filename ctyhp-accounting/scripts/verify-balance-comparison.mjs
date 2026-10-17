/**
 * Behavioural verification of migration 0155 (balance comparison) on every company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. The migration is applied inside it
 * (retargeted to the schema, as scripts/migrate.mjs does), so nothing is left
 * behind and nothing needs to be live.
 *
 *  - In every schema: structure only. The two tables, their uniques and check,
 *    RLS, grants, the header's triggers, and the function.
 *  - In co_pc (the sample company) only: the behaviour. Comparisons are saved,
 *    replaced and refused there, every one of them rolled back, on dates in 2001.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-balance-comparison.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0155_balance_comparison.sql";
const SOURCES = [{ file: FILE, sql: readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8") }];
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";

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
const all = async (sql, params) => (await client.query(sql, params)).rows;
const as = (userId) =>
  client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
/** Runs `sql`, expecting the database to refuse it with a message holding `expect`; the books stay as they were. */
async function refused(label, sql, params, expect) {
  await client.query("savepoint refusal");
  try {
    await client.query(sql, params);
    check(label, false, "it was accepted");
  } catch (error) {
    check(label, expect instanceof RegExp ? expect.test(error.message) : error.message.includes(expect), error.message);
  } finally {
    await client.query("rollback to savepoint refusal");
  }
}
/** Runs `body` as the database owner, then goes back to being `userId`. */
async function asOwner(userId, body) {
  await client.query("reset role");
  try {
    return await body();
  } finally {
    await client.query("set local role authenticated");
    await as(userId);
  }
}

// ---------------------------------------------------------------------------
// Structure, in every schema
// ---------------------------------------------------------------------------
async function structure(schema) {
  for (const table of ["acc_balance_comparison", "acc_balance_comparison_line"]) {
    const t = await one(
      `select c.relrowsecurity as rls,
              has_table_privilege('authenticated', c.oid, 'select') as sel,
              has_table_privilege('authenticated', c.oid, 'insert') as ins,
              has_table_privilege('authenticated', c.oid, 'update') as upd,
              has_table_privilege('authenticated', c.oid, 'delete') as del,
              has_table_privilege('authenticated', c.oid, 'truncate') as trunc,
              has_table_privilege('anon', c.oid, 'select') as anon_sel,
              has_table_privilege('service_role', c.oid, 'insert') as svc
         from pg_class c where c.oid = to_regclass($1)`,
      [table],
    );
    check(`${table} exists with RLS on`, Boolean(t) && t.rls === true);
    check(`${table} is SELECT-only for signed-in users, closed to anon, open to the service role`,
      Boolean(t) && t.sel && !t.ins && !t.upd && !t.del && !t.trunc && !t.anon_sel && t.svc, JSON.stringify(t));
    const policies = await all(`select cmd from pg_policies where schemaname = $1 and tablename = $2`, [schema, table]);
    check(`${table} has one read policy and no write policy`, policies.length === 1 && policies[0].cmd === "SELECT", JSON.stringify(policies));
  }

  const triggers = await all(`select tgname from pg_trigger where tgrelid = to_regclass('acc_balance_comparison') and not tgisinternal order by tgname`);
  check("the header has its actor-stamp and audit triggers",
    triggers.map((r) => r.tgname).join(",") === "acc_balance_comparison_actor_stamp,acc_balance_comparison_atomic_audit", JSON.stringify(triggers));
  const hcols = await all(
    `select column_name, data_type, is_nullable from information_schema.columns
      where table_schema = $1 and table_name = 'acc_balance_comparison' and column_name in ('id', 'as_of') order by column_name`,
    [schema],
  );
  check("the header has an id and a unique, non-null date",
    JSON.stringify(hcols.map((c) => [c.column_name, c.data_type, c.is_nullable])) === JSON.stringify([["as_of", "date", "NO"], ["id", "uuid", "NO"]]) &&
      (await one(`select count(*)::int as n from pg_constraint where conrelid = to_regclass('acc_balance_comparison') and contype in ('p', 'u')`)).n === 2,
    JSON.stringify(hcols));
  const lineTriggers = await all(`select tgname from pg_trigger where tgrelid = to_regclass('acc_balance_comparison_line') and not tgisinternal`);
  check("the lines carry no triggers of their own", lineTriggers.length === 0, JSON.stringify(lineTriggers));

  const cols = await all(
    `select column_name, data_type, is_nullable from information_schema.columns
      where table_schema = $1 and table_name = 'acc_balance_comparison_line' order by ordinal_position`,
    [schema],
  );
  check("the lines have the spec's columns and types",
    JSON.stringify(cols.map((c) => [c.column_name, c.data_type, c.is_nullable])) ===
      JSON.stringify([
        ["id", "uuid", "NO"],
        ["as_of", "date", "NO"],
        ["account_id", "uuid", "YES"],
        ["external_code", "text", "YES"],
        ["external_name", "text", "YES"],
        ["other_balance_minor", "bigint", "NO"],
      ]),
    JSON.stringify(cols));
  const indexes = await all(
    `select indexname, indexdef from pg_indexes where schemaname = $1 and tablename = 'acc_balance_comparison_line' and indexname like '%\\_uq' order by indexname`,
    [schema],
  );
  check("the lines are unique per date and account, and per date and lower-cased external code",
    indexes.length === 2 &&
      /UNIQUE.*\(as_of, account_id\).*WHERE \(account_id IS NOT NULL\)/.test(indexes[0].indexdef) &&
      /UNIQUE.*\(as_of, lower\(external_code\)\).*WHERE \(account_id IS NULL\)/.test(indexes[1].indexdef),
    JSON.stringify(indexes));
  const checks = await all(
    `select conname from pg_constraint where conrelid = to_regclass('acc_balance_comparison_line') and contype = 'c' and conname = 'acc_balance_comparison_line_who_ck'`,
  );
  check("the lines carry the account-or-external check", checks.length === 1);
  const fk = await one(
    `select confdeltype from pg_constraint where conrelid = to_regclass('acc_balance_comparison_line') and contype = 'f' and confrelid = to_regclass('acc_balance_comparison')`,
  );
  check("the lines cascade from their header", fk?.confdeltype === "c", JSON.stringify(fk));

  const fn = "acc_save_balance_comparison(date,text,text,jsonb)";
  const f = await one(
    `select p.prosecdef as definer, p.proconfig as config, pg_get_function_result(p.oid) as result,
            has_function_privilege('anon', p.oid, 'execute') as anon_exec,
            has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
            has_function_privilege('service_role', p.oid, 'execute') as svc_exec
       from pg_proc p where p.oid = to_regprocedure($1)`,
    [fn],
  );
  check(`${fn} exists, returns integer, is security definer with search_path, closed to anon, open to signed-in users and the service role`,
    Boolean(f) && f.definer && (f.config ?? []).some((c) => c.startsWith("search_path=")) && f.result === "integer" &&
      !f.anon_exec && f.auth_exec && f.svc_exec,
    JSON.stringify(f));
}

// ---------------------------------------------------------------------------
// Behaviour, in the sample company only
// ---------------------------------------------------------------------------
async function behaviour() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  if (!admin) {
    console.log("  (no active administrator; behaviour checks skipped)");
    return;
  }
  const accounts = await all(
    `select id from acc_account where status = 'active' order by account_code, id limit 3`,
  );
  if (accounts.length < 3) {
    console.log("  (fewer than three active accounts; behaviour checks skipped)");
    return;
  }
  const [a1, a2, a3] = accounts.map((a) => a.id);
  const inactive = (await one(
    `insert into acc_account (account_code, name, account_type, is_posting_account, status)
     values ('V-BC-OFF', 'Verify retired', 'bank', true, 'inactive') returning id`,
  )).id;

  await client.query("set local role authenticated");
  await as(admin.id);

  const SAVE = `select acc_save_balance_comparison($1, $2, $3, $4::jsonb) as n`;
  const save = async (date, withName, note, lines) => Number((await one(SAVE, [date, withName, note, lines === null ? null : JSON.stringify(lines)])).n);
  const head = (date) => one(`select *, as_of::text as as_of_text from acc_balance_comparison where as_of = $1`, [date]);
  const linesOn = (date) =>
    all(
      `select account_id, external_code, external_name, other_balance_minor::bigint as minor
         from acc_balance_comparison_line where as_of = $1 order by account_id nulls last, external_code`,
      [date],
    );

  // ---- two dates, both kept
  const n1 = await save("2001-03-31", "Sample Ledger", "  March check  ", [
    { account_id: a1, other_balance_minor: 150000 },
    { account_id: a2, other_balance_minor: -2500 },
    { external_code: "X-100", external_name: "Only over there", other_balance_minor: 7000 },
  ]);
  check("saving returns the number of lines kept", n1 === 3, `${n1}`);
  const n2 = await save("2001-04-30", "Other Ledger", null, [{ account_id: a1, other_balance_minor: 99 }]);
  check("saving a second date keeps both dates",
    n2 === 1 && (await linesOn("2001-03-31")).length === 3 && (await linesOn("2001-04-30")).length === 1 &&
      (await all(`select as_of from acc_balance_comparison`)).length === 2);
  const h1 = await head("2001-03-31");
  check("the header keeps the trimmed system name and note, and the stamps name the person saving",
    h1.compared_with === "Sample Ledger" && h1.note === "March check" && h1.created_by === admin.id && h1.updated_by === admin.id, JSON.stringify(h1));
  check("a negative figure and the natural sign are stored as typed",
    (await linesOn("2001-03-31")).some((l) => l.account_id === a2 && Number(l.minor) === -2500));

  // ---- saving again replaces only that date
  const n3 = await save("2001-03-31", "Sample Ledger 2", null, [{ account_id: a3, other_balance_minor: 5 }]);
  const after = await linesOn("2001-03-31");
  check("saving a date again replaces only that date's lines",
    n3 === 1 && after.length === 1 && after[0].account_id === a3 && (await linesOn("2001-04-30")).length === 1 &&
      Number((await linesOn("2001-04-30"))[0].minor) === 99);
  const h2 = await head("2001-03-31");
  check("…and updates its header: new name, the note cleared, the creator kept",
    h2.compared_with === "Sample Ledger 2" && h2.note === null && h2.created_by === admin.id, JSON.stringify(h2));
  check("…the header's audit trail holds the insert and the update, each pointing at the header's id",
    (await one(`select count(*)::int as n from acc_audit_log where table_name = 'acc_balance_comparison' and actor_id = $1 and record_id = $2`, [admin.id, h2.id])).n === 2);

  // ---- an external-only line round-trips
  await save("2001-05-31", "Sample Ledger", null, [{ external_code: " Ext-1 ", external_name: " Petty box ", other_balance_minor: 1234 }]);
  const ext = (await linesOn("2001-05-31"))[0];
  check("an external-only line round-trips, trimmed, with no account",
    ext.account_id === null && ext.external_code === "Ext-1" && ext.external_name === "Petty box" && Number(ext.minor) === 1234, JSON.stringify(ext));
  const mixed = await save("2001-05-31", "Sample Ledger", null, [
    { account_id: a1, external_code: null, external_name: null, other_balance_minor: 1 },
    { external_code: "E-2", external_name: "Second", other_balance_minor: 2 },
  ]);
  check("a line may carry null external fields beside its account", mixed === 2);

  // ---- a line with no figure is not stored; zero is a figure
  const blank = await save("2001-06-30", "Sample Ledger", null, [
    { account_id: a1 },
    { account_id: a2, other_balance_minor: null },
    { external_code: "E-3", external_name: "No figure" },
    { account_id: a3, other_balance_minor: 0 },
  ]);
  const kept = await linesOn("2001-06-30");
  check("a line with no figure is not stored, and zero is", blank === 1 && kept.length === 1 && kept[0].account_id === a3 && Number(kept[0].minor) === 0, JSON.stringify(kept));
  check("a date saved with no lines still has a header and returns zero",
    (await save("2001-07-31", "Sample Ledger", null, [])) === 0 && Boolean(await head("2001-07-31")));
  check("a null list is the same as an empty one", (await save("2001-07-31", "Sample Ledger", null, null)) === 0);

  // ---- refusals
  const L = (...lines) => JSON.stringify(lines);
  await refused("an inactive account is refused", SAVE, ["2001-08-31", "S", null, L({ account_id: inactive, other_balance_minor: 1 })], "active account");
  await refused("an unknown account is refused", SAVE, ["2001-08-31", "S", null, L({ account_id: OUTSIDER, other_balance_minor: 1 })], "active account");
  await refused("the same account twice is refused", SAVE, ["2001-08-31", "S", null, L({ account_id: a1, other_balance_minor: 1 }, { account_id: a1, other_balance_minor: 2 })], "appears twice");
  await refused("the same external code twice, in any case, is refused", SAVE,
    ["2001-08-31", "S", null, L({ external_code: "ab", external_name: "A", other_balance_minor: 1 }, { external_code: "AB", external_name: "B", other_balance_minor: 2 })], "appears twice");
  await refused("an external line without a name is refused", SAVE, ["2001-08-31", "S", null, L({ external_code: "E", other_balance_minor: 1 })], "needs a code and a name");
  await refused("an external line without a code is refused", SAVE, ["2001-08-31", "S", null, L({ external_name: "E", other_balance_minor: 1 })], "needs a code and a name");
  await refused("a line for an account and an external one at once is refused", SAVE,
    ["2001-08-31", "S", null, L({ account_id: a1, external_code: "E", external_name: "E", other_balance_minor: 1 })], "not both");
  await refused("a fractional figure is refused", SAVE, ["2001-08-31", "S", null, L({ account_id: a1, other_balance_minor: 1.5 })], "whole number");
  await refused("a figure typed as text is refused", SAVE, ["2001-08-31", "S", null, L({ account_id: a1, other_balance_minor: "12" })], "whole number");
  await refused("a figure beyond bigint is refused", SAVE, ["2001-08-31", "S", null, '[{"account_id":"' + a1 + '","other_balance_minor":99999999999999999999}]'], "too large");
  await refused("a list that is not an array is refused", SAVE, ["2001-08-31", "S", null, '{"a":1}'], "must be a list");
  await refused("a figure that is not an object is refused", SAVE, ["2001-08-31", "S", null, "[5]"], "must be an object");
  await refused("no date is refused", SAVE, [null, "S", null, "[]"], "Choose the date");
  await refused("no system name is refused", SAVE, ["2001-08-31", "   ", null, "[]"], "name of the other system");
  await refused("a system name over 80 characters is refused", SAVE, ["2001-08-31", "x".repeat(81), null, "[]"], "too long");
  await refused("a note over 500 characters is refused", SAVE, ["2001-08-31", "S", "x".repeat(501), "[]"], "too long");
  check("none of the refusals left a date behind", (await head("2001-08-31")) === undefined);
  await refused("a refused save leaves the date's earlier lines untouched",
    SAVE, ["2001-04-30", "S", null, L({ account_id: a2, other_balance_minor: 1 }, { account_id: inactive, other_balance_minor: 2 })], "active account");
  check("…the earlier lines are still there", (await linesOn("2001-04-30")).length === 1 && Number((await linesOn("2001-04-30"))[0].minor) === 99);

  // ---- writes go through the function only
  await refused("a signed-in user cannot insert into the header",
    `insert into acc_balance_comparison (as_of, compared_with) values ('2001-09-30', 'S')`, [], /permission denied|row-level security/);
  await refused("…nor into the lines",
    `insert into acc_balance_comparison_line (as_of, account_id, other_balance_minor) values ('2001-04-30', $1, 1)`, [a2], /permission denied|row-level security/);
  await refused("…nor update either", `update acc_balance_comparison set compared_with = 'x'`, [], /permission denied|row-level security/);
  await refused("…nor delete from either", `delete from acc_balance_comparison_line`, [], /permission denied|row-level security/);

  // ---- who may read and save (the administrator, demoted for a moment inside this transaction)
  const setRole = (role) => asOwner(admin.id, () => client.query("update acc_app_user set role = $1 where id = $2", [role, admin.id]));
  await setRole("viewer");
  check("a viewer can read the headers and the lines",
    (await all(`select * from acc_balance_comparison`)).length === 5 && (await all(`select * from acc_balance_comparison_line`)).length === 5);
  await refused("a viewer cannot save", SAVE, ["2001-10-31", "S", null, "[]"], "Not authorized");
  await setRole("sales");
  check("a salesperson reads nothing",
    (await all(`select * from acc_balance_comparison`)).length === 0 && (await all(`select * from acc_balance_comparison_line`)).length === 0);
  await refused("a salesperson cannot save", SAVE, ["2001-10-31", "S", null, "[]"], "Not authorized");
  await setRole("admin");
  await as(OUTSIDER);
  check("someone outside the company reads nothing",
    (await all(`select * from acc_balance_comparison`)).length === 0 && (await all(`select * from acc_balance_comparison_line`)).length === 0);
  await refused("someone outside the company cannot save", SAVE, ["2001-10-31", "S", null, "[]"], "Not authorized");
  await as(admin.id);
  check("none of the refused saves wrote a date", (await head("2001-10-31")) === undefined);

  // ---- the lines go with their date
  await asOwner(admin.id, () => client.query(`delete from acc_balance_comparison where as_of = '2001-04-30'`));
  check("deleting a header takes its lines with it, and no others",
    (await linesOn("2001-04-30")).length === 0 && (await linesOn("2001-05-31")).length === 2);
}

// ---------------------------------------------------------------------------
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
      const lived = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      const statements = schema === "public" ? SOURCES.map((s) => s.sql) : planCompanySchema(SOURCES, schema).statements;
      for (const statement of statements) await client.query(statement);
      for (const statement of statements) await client.query(statement);
      console.log(`  (0155 ${lived ? "is live and was applied again" : "applied inside the transaction, never committed"}; a second pass was harmless)`);
      check("applying the migration twice is harmless", true);

      await structure(schema);
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
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
