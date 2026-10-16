/**
 * Behavioural verification of migration 0147 (scoped work-item retire, 2.09) on
 * every company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0147 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing is left behind.
 *
 *  - In every schema: structure (the two-argument overload exists, and the
 *    one-argument one only until 0148 removes it; the new one is a
 *    security definer with a pinned search path, closed to anon and public,
 *    open to signed-in users and the service role) and one call, as the
 *    company's administrator, with empty prefixes, which must resolve nothing.
 *  - In co_pc (the sample company) only: the behaviour, on invented work-item
 *    states made inside the transaction. The states are written through
 *    acc_set_work_item_state as an active administrator, the way the app writes
 *    them. Existing states in the sample company are cleared first (as the
 *    owner, inside the transaction) so the counts are exact.
 *
 * Prints counts and pass/fail lines only: no names, no amounts.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-scoped-retire.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0147_scoped_work_item_retire.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const BANKING = ["bank-txn:", "bank-feed:", "bank-recon:", "dupe-charge:"];

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

const FACTS = `
select jsonb_build_object(
  'scoped', (
    select case when p.oid is null then null else jsonb_build_object(
             'definer', p.prosecdef,
             'path', (select s from unnest(p.proconfig) s where s like 'search_path=%'),
             'result', pg_get_function_result(p.oid),
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'member', has_function_privilege('authenticated', p.oid, 'execute'),
             'service', has_function_privilege('service_role', p.oid, 'execute'),
             'public', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                where x.grantee = 0 and x.privilege_type = 'EXECUTE')) end
      from (select to_regprocedure($1::text || '.acc_retire_work_items(text[],text[])') as oid) f
      left join pg_proc p on p.oid = f.oid),
  'single', (
    select case when p.oid is null then null else jsonb_build_object(
             'definer', p.prosecdef,
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'member', has_function_privilege('authenticated', p.oid, 'execute')) end
      from (select to_regprocedure($1::text || '.acc_retire_work_items(text[])') as oid) f
      left join pg_proc p on p.oid = f.oid)
) as facts`;

function structure(schema, facts) {
  const f = facts.scoped;
  check("the two-argument retire exists and returns integer", Boolean(f) && f.result === "integer", JSON.stringify(f?.result));
  check(`…is a security definer with search_path pinned to ${schema}`,
    Boolean(f) && f.definer && f.path === `search_path=${schema}`, JSON.stringify(f && { definer: f.definer, path: f.path }));
  check("…is closed to anon and public, open to signed-in users and the service role",
    Boolean(f) && !f.anon && !f.public && f.member && f.service,
    JSON.stringify(f && { anon: f.anon, public: f.public, member: f.member, service: f.service }));
  const s = facts.single;
  if (s) {
    check("the one-argument retire is still there, a security definer, closed to anon, open to signed-in users",
      s.definer && !s.anon && s.member, JSON.stringify(s));
  } else {
    console.log("  (the one-argument retire is gone: removed by 0148)");
  }
}

async function adminId() {
  return (await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`))?.id;
}

/** Every schema: as the administrator, empty and null prefixes resolve nothing. */
async function emptyPrefixCall() {
  const admin = await adminId();
  if (!admin) {
    console.log("  (no active administrator; the call is skipped)");
    return;
  }
  const before = (await one(`select count(*) filter (where lifecycle <> 'resolved')::int as active from acc_work_item_state`)).active;
  await client.query("set local role authenticated");
  await as(admin);
  try {
    const empty = await one(`select acc_retire_work_items(array[]::text[], array[]::text[]) as n`);
    const nul = await one(`select acc_retire_work_items(array[]::text[], null) as n`);
    check("empty prefixes resolve nothing", empty.n === 0, String(empty.n));
    check("null prefixes resolve nothing", nul.n === 0, String(nul.n));
  } finally {
    await client.query("reset role");
  }
  const after = (await one(`select count(*) filter (where lifecycle <> 'resolved')::int as active from acc_work_item_state`)).active;
  check(`…and the ${before} active states are unchanged`, before === after, `${before} -> ${after}`);
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

  /** Written the way the app writes them: through acc_set_work_item_state, as staff. */
  const dismiss = (key) =>
    one(`select acc_set_work_item_state($1, 'dismissed', null, null, 'verification only', null, false) as v`, [key]);
  const lifecycle = async (key) =>
    (await asOwner(admin, () => one(`select lifecycle from acc_work_item_state where work_key = $1`, [key])))?.lifecycle;
  const retire = (live, prefixes) => one(`select acc_retire_work_items($1::text[], $2::text[]) as n`, [live, prefixes]);

  const keys = ["bank-txn:verify-1", "bank-txn:verify-2", "ar-draft:verify-3", "dupe-charge:verify-4"];
  for (const k of keys) await dismiss(k);
  check("four invented states were written through acc_set_work_item_state",
    (await asOwner(admin, () => one(`select count(*)::int as n from acc_work_item_state`))).n === 4);

  console.log("  a scoped retire touches only its own page");
  const r = await retire(["bank-txn:verify-1"], BANKING);
  check("two Banking keys outside the live list resolved (bank-txn:verify-2, dupe-charge:verify-4)", r.n === 2, String(r.n));
  check("a Banking key in the live list stays dismissed", (await lifecycle("bank-txn:verify-1")) === "dismissed");
  check("a stale Banking key is resolved", (await lifecycle("bank-txn:verify-2")) === "resolved");
  check("a Sales key is left alone (the bug this fixes)", (await lifecycle("ar-draft:verify-3")) === "dismissed");
  check("a second call finds nothing more to resolve", (await retire(["bank-txn:verify-1"], BANKING)).n === 0);

  console.log("  empty prefixes");
  check("empty prefixes resolve nothing", (await retire([], [])).n === 0);
  check("null prefixes resolve nothing", (await retire([], null)).n === 0);
  check("an empty-string prefix resolves nothing", (await retire([], [""])).n === 0);
  check("…and the live and Sales keys are still dismissed",
    (await lifecycle("bank-txn:verify-1")) === "dismissed" && (await lifecycle("ar-draft:verify-3")) === "dismissed");
  check("null live keys with a prefix resolve that page's remaining active keys",
    (await retire(null, ["bank-txn:"])).n === 1 && (await lifecycle("bank-txn:verify-1")) === "resolved");

  console.log("  a prefix matches literally");
  for (const k of ["a_c:one", "abc:two", "x%y:one", "xzzy:two"]) await dismiss(k);
  check("an underscore in a prefix is not a wildcard", (await retire([], ["a_c:"])).n === 1
    && (await lifecycle("a_c:one")) === "resolved" && (await lifecycle("abc:two")) === "dismissed");
  check("a percent sign in a prefix is not a wildcard", (await retire([], ["x%y:"])).n === 1
    && (await lifecycle("x%y:one")) === "resolved" && (await lifecycle("xzzy:two")) === "dismissed");
  check("a prefix is a start, not a substring", (await retire([], [":two"])).n === 0);

  console.log("  who may call");
  await client.query("savepoint as_viewer");
  await asOwner(admin, () => client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin]));
  check("a viewer may call it", (await retire([], ["abc:"])).n === 1 && (await lifecycle("abc:two")) === "resolved");
  await client.query("rollback to savepoint as_viewer");
  await as(OUTSIDER);
  await refused("an outsider is refused", `select acc_retire_work_items(array[]::text[], array['ar-draft:']::text[])`, [], "Not authorized");
  await as(admin);

  const hasSingle = Boolean((await one(`select to_regprocedure('acc_retire_work_items(text[])') as oid`)).oid);
  if (hasSingle) {
    console.log("  the one-argument version, unchanged");
    const old = await one(`select acc_retire_work_items($1::text[]) as n`, [["bank-txn:none"]]);
    check("it still resolves every active key outside its list, whatever the page (documented old behaviour)",
      old.n >= 1 && (await lifecycle("ar-draft:verify-3")) === "resolved", String(old.n));
  } else {
    console.log("  (the one-argument version is gone: removed by 0148)");
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
      const sql = schema === "public"
        ? MIGRATION
        : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements.join("\n;\n");
      await client.query(sql);
      console.log("  (0147 applied inside the transaction, never committed)");
      await client.query(sql);
      check("applying 0147 a second time is harmless", true);
      await client.query(`set local search_path = ${schema}, extensions`);
      const { facts } = await one(FACTS, [schema]);
      structure(schema, facts);
      await emptyPrefixCall();
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
