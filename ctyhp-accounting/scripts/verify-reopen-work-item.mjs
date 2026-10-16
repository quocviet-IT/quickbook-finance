/**
 * Behavioural verification of migration 0148 (reopen a resolved work item, 2.10)
 * on every company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0148 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing is left behind.
 *
 *  - In every schema: structure only. acc_set_work_item_state is a security
 *    definer with a pinned search path, closed to anon and public, open to
 *    signed-in users and the service role, and its body knows how to reopen; the
 *    one-argument retire is gone and the two-argument one is still there.
 *  - In co_pc (the sample company) only: the behaviour, on invented work-item
 *    states made inside the transaction. The states are written through
 *    acc_set_work_item_state and resolved through the scoped retire, the way the
 *    app does both. Existing states in the sample company are cleared first (as
 *    the owner, inside the transaction) so the counts are exact.
 *
 * Prints counts and pass/fail lines only: no names, no amounts.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-reopen-work-item.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0148_reopen_resolved_work_item.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const STALE = /changed by someone else/i;

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
async function refused(label, sql, params, expect) {
  await client.query("savepoint refusal");
  try {
    await client.query(sql, params);
    check(label, false, "it was accepted");
  } catch (error) {
    const ok = expect instanceof RegExp ? expect.test(error.message) : error.message.includes(expect);
    check(label, ok, ok ? "" : error.message);
  } finally {
    await client.query("rollback to savepoint refusal");
  }
}
async function asOwner(userId, body) {
  await client.query("reset role");
  try {
    return await body();
  } finally {
    await client.query("set local role authenticated");
    await as(userId);
  }
}

const SET_SIGNATURE = "acc_set_work_item_state(text,text,uuid,date,text,integer,boolean)";
const FACTS = `
select jsonb_build_object(
  'set', (
    select case when p.oid is null then null else jsonb_build_object(
             'definer', p.prosecdef,
             'path', (select s from unnest(p.proconfig) s where s like 'search_path=%'),
             'result', pg_get_function_result(p.oid),
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'member', has_function_privilege('authenticated', p.oid, 'execute'),
             'service', has_function_privilege('service_role', p.oid, 'execute'),
             'public', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                where x.grantee = 0 and x.privilege_type = 'EXECUTE'),
             'reopens', position('reopened' in pg_get_functiondef(p.oid)) > 0) end
      from (select to_regprocedure($1::text || '.${SET_SIGNATURE}') as oid) f
      left join pg_proc p on p.oid = f.oid),
  'single', to_regprocedure($1::text || '.acc_retire_work_items(text[])') is not null,
  'scoped', (
    select case when p.oid is null then null else jsonb_build_object(
             'definer', p.prosecdef,
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'member', has_function_privilege('authenticated', p.oid, 'execute')) end
      from (select to_regprocedure($1::text || '.acc_retire_work_items(text[],text[])') as oid) f
      left join pg_proc p on p.oid = f.oid)
) as facts`;

function structure(schema, facts) {
  const f = facts.set;
  check("acc_set_work_item_state exists and returns integer", Boolean(f) && f.result === "integer", JSON.stringify(f?.result));
  check(`…is a security definer with search_path pinned to ${schema}`,
    Boolean(f) && f.definer && f.path === `search_path=${schema}`, JSON.stringify(f && { definer: f.definer, path: f.path }));
  check("…is closed to anon and public, open to signed-in users and the service role",
    Boolean(f) && !f.anon && !f.public && f.member && f.service,
    JSON.stringify(f && { anon: f.anon, public: f.public, member: f.member, service: f.service }));
  check("…and its body reopens a resolved row", Boolean(f) && f.reopens === true);
  check("the one-argument retire is gone", facts.single === false);
  const s = facts.scoped;
  check("the two-argument retire is still there, a security definer, closed to anon, open to signed-in users",
    Boolean(s) && s.definer && !s.anon && s.member, JSON.stringify(s));
}

async function adminId() {
  return (await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`))?.id;
}

async function behaviour() {
  const admin = await adminId();
  if (!admin) {
    console.log("  (no active administrator; behaviour checks skipped)");
    return;
  }
  // Exact counts: clear what the sample company already holds, inside this transaction.
  await client.query(`delete from acc_work_item_state`);
  await client.query("set local role authenticated");
  await as(admin);

  const set = (key, lifecycle, { version = null, reason = null, due = null, blocks = false } = {}) =>
    one(`select acc_set_work_item_state($1, $2, null, $3::date, $4, $5::int, $6) as v`, [key, lifecycle, due, reason, version, blocks]);
  const setSql = `select acc_set_work_item_state($1, $2, null, null, $3, $4::int, $5)`;
  const row = (key) =>
    asOwner(admin, () => one(`select lifecycle, owner_id, due_date, dismiss_reason, version, resolved_at from acc_work_item_state where work_key = $1`, [key]));
  const audit = (key) =>
    asOwner(admin, () => one(
      `select count(*)::int as total,
              count(*) filter (where action = 'update' and after_json -> 'reopened' = 'true'::jsonb)::int as reopened,
              count(*) filter (where after_json ? 'reopened')::int as flagged
         from acc_audit_log where table_name = 'acc_work_item_state' and after_json ->> 'work_key' = $1`, [key]));
  /** The scoped retire, the way a page calls it when its exception has cleared. */
  const retire = (prefix) => one(`select acc_retire_work_items(array[]::text[], array[$1]::text[]) as n`, [prefix]);

  console.log("  an item that cleared and came back is set again with no version");
  const k1 = "bank-txn:verify-reopen-1";
  const first = await set(k1, "acknowledged", { due: "2030-01-15" });
  check("the first state was written at version 1", first.v === 1, String(first.v));
  check("the exception clears: the scoped retire resolves it", (await retire("bank-txn:verify-reopen-1")).n === 1
    && (await row(k1)).lifecycle === "resolved");
  const reopened = await set(k1, "in_progress");
  check("setting it again with a null version succeeds and returns the next version", reopened.v === 2, String(reopened.v));
  const r1 = await row(k1);
  check("the lifecycle is the new one", r1.lifecycle === "in_progress", r1.lifecycle);
  check("the version went up by one", r1.version === 2, String(r1.version));
  check("it starts afresh: no owner and no due date from before", r1.owner_id === null && r1.due_date === null);
  check("…and it is no longer marked as resolved", r1.resolved_at === null);
  const a1 = await audit(k1);
  check("the audit row for the reopening is an update that says reopened", a1.reopened === 1, JSON.stringify(a1));
  check("…and the first, ordinary write does not say reopened", a1.total === 2 && a1.flagged === 1, JSON.stringify(a1));
  check("the reopened item can be changed again with its new version", (await set(k1, "acknowledged", { version: 2 })).v === 3);
  check("…and that ordinary change does not say reopened", (await audit(k1)).flagged === 1);

  console.log("  a resolved row set with a version is refused");
  const k2 = "bank-txn:verify-reopen-2";
  await set(k2, "acknowledged");
  await retire(k2);
  await refused("version 1 on a resolved row is refused as changed by someone else", setSql, [k2, "acknowledged", null, 1, false], STALE);
  await refused("any other version on a resolved row is refused too", setSql, [k2, "acknowledged", null, 7, false], STALE);
  const r2 = await row(k2);
  check("…and the row is still resolved at its old version", r2.lifecycle === "resolved" && r2.version === 1, JSON.stringify(r2));

  console.log("  an active row set with a null version is still refused");
  const k3 = "bank-txn:verify-reopen-3";
  await set(k3, "acknowledged");
  await refused("a null version on an active row is refused", setSql, [k3, "in_progress", null, null, false], STALE);
  await refused("a wrong version on an active row is refused", setSql, [k3, "in_progress", null, 9, false], STALE);
  check("…and the active row did not move", (await row(k3)).version === 1 && (await row(k3)).lifecycle === "acknowledged");
  await refused("a version on a key with no row at all is refused", setSql, ["bank-txn:verify-reopen-none", "acknowledged", null, 1, false], STALE);

  console.log("  dismissing a reopened item");
  const k4 = "bank-txn:verify-reopen-4";
  await set(k4, "acknowledged");
  await retire(k4);
  await refused("dismissing a blocking item that came back is still refused", setSql, [k4, "dismissed", "later", null, true], "blocks the period close");
  await refused("dismissing without a reason is still refused", setSql, [k4, "dismissed", "   ", null, false], "Say why");
  await refused("an item cannot be marked resolved by hand, even when it is resolved", setSql, [k4, "resolved", null, null, false], "by the books");
  check("…none of those refusals reopened the row", (await row(k4)).lifecycle === "resolved" && (await row(k4)).version === 1);
  const dismissed = await set(k4, "dismissed", { reason: "verification only" });
  const r4 = await row(k4);
  check("dismissing it with a reason reopens it as dismissed", dismissed.v === 2 && r4.lifecycle === "dismissed" && r4.dismiss_reason === "verification only", JSON.stringify(r4));
  await retire(k4);
  await set(k4, "acknowledged");
  check("reopening to another lifecycle leaves no dismiss reason behind", (await row(k4)).dismiss_reason === null);

  console.log("  who may call");
  const k5 = "bank-txn:verify-reopen-5";
  await set(k5, "acknowledged");
  await retire(k5);
  await client.query("savepoint as_viewer");
  await asOwner(admin, () => client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin]));
  await refused("a viewer is refused", setSql, [k5, "acknowledged", null, null, false], "Not authorized to change work");
  await client.query("rollback to savepoint as_viewer");
  await as(OUTSIDER);
  await refused("an outsider is refused", setSql, [k5, "acknowledged", null, null, false], "Not authorized to change work");
  await as(admin);
  check("…and the resolved row was not touched by either", (await row(k5)).lifecycle === "resolved" && (await row(k5)).version === 1);

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
      const sql = schema === "public"
        ? MIGRATION
        : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements.join("\n;\n");
      await client.query(sql);
      console.log("  (0148 applied inside the transaction, never committed)");
      await client.query(sql);
      check("applying 0148 a second time is harmless", true);
      await client.query(`set local search_path = ${schema}, extensions`);
      const { facts } = await one(FACTS, [schema]);
      structure(schema, facts);
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
