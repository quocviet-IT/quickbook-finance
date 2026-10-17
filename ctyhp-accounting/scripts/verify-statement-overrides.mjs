/**
 * Behavioural verification of migration 0149 (a statement imported out of
 * balance stays in sight, 2.11) on every company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0149 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing is left behind.
 *
 *  - In every schema: structure only. acc_statement_overrides is a security
 *    definer with a pinned search path, closed to anon and public, open to
 *    signed-in users and the service role, returning the agreed columns; the
 *    import function still has the same signature and grants and now knows the
 *    prior check.
 *  - In co_pc (the sample company) only: the behaviour, on an invented bank
 *    account, invented file names and invented amounts, all made inside the
 *    transaction. Imports go through acc_import_bank_statement_proved as an
 *    active administrator, the way the app does it. Reconciliations are made
 *    and completed through the app's own functions (acc_create_reconciliation
 *    and acc_complete_reconciliation, acc_bring_forward_reconciliation); one
 *    completed reconciliation with a closing other than zero is written as the
 *    owner, because an empty account can only close at zero.
 *
 * Prints counts and pass/fail lines only: no names, no amounts.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-statement-overrides.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0149_statement_override_visibility.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const IMPORT_SIGNATURE = "acc_import_bank_statement_proved(uuid,text,jsonb,jsonb)";
const OVERRIDES_SIGNATURE = "acc_statement_overrides()";
const COLUMNS =
  "batch_id uuid, bank_account_id uuid, filename text, imported_at timestamp with time zone, overridden_by uuid, " +
  "override_reason text, out_by_minor bigint, statement_opening_minor bigint, statement_closing_minor bigint, " +
  "first_line_date date, last_line_date date, settled_by_reconciliation_id uuid, settled_through date";

pg.types.setTypeParser(1082, (value) => value); // dates stay as YYYY-MM-DD text
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
const sha = (text) => createHash("sha256").update(text).digest("hex");
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
  'overrides', (
    select case when p.oid is null then null else jsonb_build_object(
             'definer', p.prosecdef,
             'stable', p.provolatile = 's',
             'path', (select s from unnest(p.proconfig) s where s like 'search_path=%'),
             'result', pg_get_function_result(p.oid),
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'member', has_function_privilege('authenticated', p.oid, 'execute'),
             'service', has_function_privilege('service_role', p.oid, 'execute'),
             'public', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                where x.grantee = 0 and x.privilege_type = 'EXECUTE'),
             'roleCheck', pg_get_functiondef(p.oid) ~* 'acc_is_staff[(][)] or coalesce[(]acc_current_role[(][)] = ''viewer''') end
      from (select to_regprocedure($1::text || '.${OVERRIDES_SIGNATURE}') as oid) f
      left join pg_proc p on p.oid = f.oid),
  'import', (
    select case when p.oid is null then null else jsonb_build_object(
             'definer', p.prosecdef,
             'path', (select s from unnest(p.proconfig) s where s like 'search_path=%'),
             'result', pg_get_function_result(p.oid),
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'member', has_function_privilege('authenticated', p.oid, 'execute'),
             'service', has_function_privilege('service_role', p.oid, 'execute'),
             'public', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                where x.grantee = 0 and x.privilege_type = 'EXECUTE'),
             'prior', pg_get_functiondef(p.oid) ~ 'The opening must be the closing of the last reconciliation',
             'proof', pg_get_functiondef(p.oid) ~ 'The statement does not add up') end
      from (select to_regprocedure($1::text || '.${IMPORT_SIGNATURE}') as oid) f
      left join pg_proc p on p.oid = f.oid)
) as facts`;

function structure(schema, facts) {
  const o = facts.overrides;
  check("acc_statement_overrides exists with the agreed columns", Boolean(o) && o.result === `TABLE(${COLUMNS})`, JSON.stringify(o?.result));
  check(`…is a stable security definer with search_path pinned to ${schema}`,
    Boolean(o) && o.definer && o.stable && o.path === `search_path=${schema}`, JSON.stringify(o && { definer: o.definer, stable: o.stable, path: o.path }));
  check("…is closed to anon and public, open to signed-in users and the service role",
    Boolean(o) && !o.anon && !o.public && o.member && o.service, JSON.stringify(o && { anon: o.anon, public: o.public, member: o.member, service: o.service }));
  check("…and checks the role inside: staff or viewer", Boolean(o) && o.roleCheck === true);
  const i = facts.import;
  check("the import function is still a security definer with the search path pinned",
    Boolean(i) && i.definer && i.path === `search_path=${schema}`, JSON.stringify(i && { definer: i.definer, path: i.path }));
  check("…closed to anon and public, open to signed-in users and the service role",
    Boolean(i) && !i.anon && !i.public && i.member && i.service, JSON.stringify(i && { anon: i.anon, public: i.public, member: i.member, service: i.service }));
  check("…still returns inserted, skipped and batch_id",
    Boolean(i) && i.result === "TABLE(inserted integer, skipped integer, batch_id uuid)", JSON.stringify(i?.result));
  check("…and carries both the proof and the prior check", Boolean(i) && i.prior === true && i.proof === true);
}

async function behaviour(base) {
  const admin = (await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`))?.id;
  if (!admin) {
    console.log("  (no active administrator; behaviour checks skipped)");
    return;
  }

  // ---- the books: two bank accounts with nothing in them yet
  const makeBank = async (code, name) => {
    const gl = (await one(
      `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
       values ($1, $2, 'bank', $3, true) returning id`,
      [code, name, base],
    )).id;
    return (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, $2, $3) returning id`, [gl, name, base])).id;
  };
  const bank = await makeBank("ZZ-VERIFY-OV1", "Verify overrides bank one");
  const bank2 = await makeBank("ZZ-VERIFY-OV2", "Verify overrides bank two");

  await client.query("set local role authenticated");
  await as(admin);

  const line = (date, amount, tag) => ({
    txn_date: date, description: `VERIFY ${tag}`, reference: null, amount_minor: amount,
    running_balance_minor: null, raw_line: "", raw_hash: sha(`${tag} ${date} ${amount} ${Math.random()}`), source: "file_upload",
  });
  const proof = (opening, closing, { openingBasis = "typed", override = null } = {}) => ({
    opening_minor: opening, closing_minor: closing, opening_basis: openingBasis, closing_basis: "typed", set_aside: 0,
    ...(override ? { override: { reason: override } } : {}),
  });
  const importFile = (bankId, name, lines, p) =>
    one(`select * from acc_import_bank_statement_proved($1, $2, $3::jsonb, $4::jsonb)`, [bankId, name, JSON.stringify(lines), JSON.stringify(p)]);
  const listed = async () => all(`select * from acc_statement_overrides()`);
  const mine = async (id) => (await listed()).find((r) => r.batch_id === id);

  console.log("  an out-of-balance import made as an administrator is listed, open");
  const before = (await listed()).length;
  const a = await importFile(bank, "verify-overrides-a.csv", [line("2026-05-10", 1000, "a1"), line("2026-05-20", 500, "a2")],
    proof(0, 1000, { override: "verification only" }));
  check("the import made a batch", typeof a.batch_id === "string");
  const ra = await mine(a.batch_id);
  check("it is listed", Boolean(ra));
  check("…with who, why and by how much", ra.overridden_by === admin && ra.override_reason === "verification only" && Number(ra.out_by_minor) === 500,
    JSON.stringify({ who: ra.overridden_by === admin, reason: ra.override_reason, out: ra.out_by_minor }));
  check("…with the account, file name and the opening and closing it was imported with",
    ra.bank_account_id === bank && ra.filename === "verify-overrides-a.csv"
      && Number(ra.statement_opening_minor) === 0 && Number(ra.statement_closing_minor) === 1000);
  check("…and when: the import's own time", ra.imported_at instanceof Date);
  check("…and the dates its lines cover", ra.first_line_date === "2026-05-10" && ra.last_line_date === "2026-05-20",
    `${ra.first_line_date} ${ra.last_line_date}`);
  check("…open: settled by nothing", ra.settled_by_reconciliation_id === null && ra.settled_through === null);
  check("…and the list grew by one", (await listed()).length === before + 1);

  console.log("  a balanced import is not listed");
  const ok = await importFile(bank, "verify-overrides-ok.csv", [line("2026-05-11", 300, "ok1")], proof(1000, 1300));
  check("a balanced import made a batch and is not listed", typeof ok.batch_id === "string" && !(await mine(ok.batch_id)));

  console.log("  a voided import is not listed");
  const v = await importFile(bank2, "verify-overrides-void.csv", [line("2026-05-12", 200, "v1")], proof(0, 100, { override: "to be undone" }));
  check("an overridden import is listed first", Boolean(await mine(v.batch_id)));
  await one(`select acc_undo_bank_statement_import($1, 'verification only') as n`, [v.batch_id]);
  check("…and after it is undone it is not", !(await mine(v.batch_id)));

  console.log("  a completed reconciliation settles it only when it reaches the last line");
  await one(`select acc_bring_forward_reconciliation($1, '2026-05-19', 0, 'Brought forward, verify') as id`, [bank]);
  check("a reconciliation ending the day before the last line leaves it open", (await mine(a.batch_id)).settled_by_reconciliation_id === null);
  const inProgress = (await one(`select acc_create_reconciliation($1, '2026-05-20', 0) as id`, [bank])).id;
  check("a reconciliation still in progress does not settle it", (await mine(a.batch_id)).settled_by_reconciliation_id === null);
  await one(`select acc_complete_reconciliation($1)`, [inProgress]);
  const settled = await mine(a.batch_id);
  check("one ending ON the last line date settles it", settled.settled_by_reconciliation_id === inProgress);
  check("…and says through when", settled.settled_through === "2026-05-20", String(settled.settled_through));
  const later = (await one(`select acc_create_reconciliation($1, '2026-06-30', 0) as id`, [bank])).id;
  await one(`select acc_complete_reconciliation($1)`, [later]);
  check("a later completed reconciliation does not take over: the earliest one that reaches it settles it",
    (await mine(a.batch_id)).settled_by_reconciliation_id === inProgress);
  const other = await importFile(bank2, "verify-overrides-other.csv", [line("2026-05-13", 100, "o1")], proof(0, 50, { override: "other account" }));
  check("a reconciliation of another account settles nothing here", (await mine(other.batch_id)).settled_by_reconciliation_id === null);

  console.log("  ordering");
  const b = await importFile(bank, "verify-overrides-b.csv", [line("2026-07-02", 100, "b1")], proof(1300, 1000, { override: "second" }));
  const rows = (await listed()).filter((r) => [a.batch_id, b.batch_id].includes(r.batch_id));
  check("both are listed", rows.length === 2);
  const all2 = await listed();
  const sorted = [...all2].sort((x, y) => x.imported_at - y.imported_at || (x.batch_id < y.batch_id ? -1 : x.batch_id > y.batch_id ? 1 : 0));
  check("rows come ordered by imported_at, then batch id", JSON.stringify(all2.map((r) => r.batch_id)) === JSON.stringify(sorted.map((r) => r.batch_id)));
  const rb = await mine(b.batch_id);
  check("an override whose last line is after every reconciliation stays open", rb.settled_by_reconciliation_id === null);

  console.log("  a prior opening must be the closing of the last reconciliation");
  const priorBank = (await one(`select statement_ending_balance_minor as closing from acc_statement_reconciliation
     where bank_account_id = $1 and status = 'completed' order by statement_ending_date desc limit 1`, [bank])).closing;
  check("the last completed reconciliation closes at zero", Number(priorBank) === 0);
  await refused("an opening of 5.00 marked prior is refused, naming the closing",
    `select * from acc_import_bank_statement_proved($1, 'verify-overrides-p1.csv', $2::jsonb, $3::jsonb)`,
    [bank, JSON.stringify([line("2026-07-10", 700, "p1")]), JSON.stringify(proof(500, 1200, { openingBasis: "prior" }))],
    "The opening must be the closing of the last reconciliation, 0.00.");
  const p2 = await importFile(bank, "verify-overrides-p2.csv", [line("2026-07-11", 700, "p2")], proof(0, 700, { openingBasis: "prior" }));
  check("an opening equal to the closing marked prior is accepted", typeof p2.batch_id === "string");
  const ob = await one(`select opening_basis from acc_bank_import_batch where id = $1`, [p2.batch_id]);
  check("…and recorded as prior", ob.opening_basis === "prior");
  const t = await importFile(bank, "verify-overrides-t.csv", [line("2026-07-12", 100, "t")], proof(777, 877, { openingBasis: "typed" }));
  check("a typed opening that differs from the closing is not checked", typeof t.batch_id === "string");
  await asOwner(admin, () => client.query(
    `insert into acc_statement_reconciliation
       (bank_account_id, statement_ending_date, beginning_balance_minor, statement_ending_balance_minor, status, prepared_by, completed_by, completed_at)
     values ($1, '2026-07-31', 0, 123456, 'completed', $2, $2, now())`, [bank, admin]));
  await refused("with a newer closing, the old one is refused and the new one named",
    `select * from acc_import_bank_statement_proved($1, 'verify-overrides-p3.csv', $2::jsonb, $3::jsonb)`,
    [bank, JSON.stringify([line("2026-08-02", 100, "p3")]), JSON.stringify(proof(0, 100, { openingBasis: "prior" }))],
    "The opening must be the closing of the last reconciliation, 1,234.56.");
  const p4 = await importFile(bank, "verify-overrides-p4.csv", [line("2026-08-03", 100, "p4")], proof(123456, 123556, { openingBasis: "prior" }));
  check("…and the newest closing is accepted", typeof p4.batch_id === "string");
  await refused("a prior opening on an account with no completed reconciliation is refused",
    `select * from acc_import_bank_statement_proved($1, 'verify-overrides-p5.csv', $2::jsonb, $3::jsonb)`,
    [bank2, JSON.stringify([line("2026-08-02", 100, "p5")]), JSON.stringify(proof(0, 100, { openingBasis: "prior" }))],
    "this account has none");
  await refused("an out-of-balance statement is still refused without an override",
    `select * from acc_import_bank_statement_proved($1, 'verify-overrides-p6.csv', $2::jsonb, $3::jsonb)`,
    [bank2, JSON.stringify([line("2026-08-02", 100, "p6")]), JSON.stringify(proof(0, 999))],
    "The statement does not add up");

  console.log("  who may read");
  await client.query("savepoint as_viewer");
  await asOwner(admin, () => client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin]));
  check("a viewer may read the list", (await mine(a.batch_id)) !== undefined);
  await client.query("rollback to savepoint as_viewer");
  await as(OUTSIDER);
  await refused("an outsider may not", `select * from acc_statement_overrides()`, [], "Not authorized to read statements imported out of balance");
  await as(admin);
  check("an administrator still may", (await mine(a.batch_id)) !== undefined);

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
      console.log("  (0149 applied inside the transaction, never committed)");
      await client.query(sql);
      check("applying 0149 a second time is harmless", true);
      await client.query(`set local search_path = ${schema}, extensions`);
      const { facts } = await one(FACTS, [schema]);
      structure(schema, facts);
      if (schema === SAMPLE) {
        const base = (await one(`select code from acc_currency where is_base limit 1`))?.code;
        if (base) await behaviour(base);
        else console.log("  (no base currency; behaviour checks skipped)");
      }
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
