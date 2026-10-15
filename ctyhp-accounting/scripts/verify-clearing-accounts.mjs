/**
 * Behavioural verification of migration 0145 (Clearing accounts, 2.06) on every
 * company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0145 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing is left behind.
 *
 *  - In every schema: structure and a read-only call. The column and the type
 *    rule exist; the backfill left no current-asset Undeposited Funds account
 *    unticked and ticked nothing a current asset or liability is not; the
 *    function exists with its result columns, security definer, pinned search
 *    path and grants; and, acting as the company's administrator,
 *    acc_clearing_standing returns one row per ticked account, each agreeing
 *    with the ledger, without erroring. Counts only.
 *  - In co_pc (the sample company) only: the behaviour, on invented books made
 *    inside the transaction:
 *      A  an asset clearing account: many small receipts, then two deposits that
 *         part-clear the oldest items
 *      B  a liability clearing account: credits are the items
 *      C  a clearing account back to a zero balance
 *      E  a clearing account with no lines
 *      D  a current asset that is not ticked
 *    Every column is asserted at several as-of dates, including one before the
 *    deposits; the type rule is exercised; the tick is saved through the same
 *    path the app uses (a staff update under row level security); and who may
 *    call is checked.
 *
 * Prints counts and pass/fail lines only: no names, no amounts.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-clearing-accounts.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0145_clearing_accounts.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const STANDING = "acc_clearing_standing(date)";
const COLUMNS =
  "TABLE(account_id uuid, balance_minor bigint, last_movement_date date, open_count integer, " +
  "open_oldest_date date, open_minor bigint)";

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
/** Runs `sql`, expecting a refusal holding `expect`; the savepoint puts everything back as it was. */
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
// Structure, in every schema: one query.
// ---------------------------------------------------------------------------
const FACTS = `
select jsonb_build_object(
  'column', (
    select jsonb_build_object('type', c.data_type, 'nullable', c.is_nullable, 'default', c.column_default)
      from information_schema.columns c
     where c.table_schema = $1 and c.table_name = 'acc_account' and c.column_name = 'is_clearing'),
  'rule', (
    select pg_get_constraintdef(k.oid)
      from pg_constraint k
     where k.conrelid = to_regclass($1::text || '.acc_account') and k.conname = 'acc_account_clearing_type_ck'),
  'standing', (
    select case when p.oid is null then null else jsonb_build_object(
             'definer', p.prosecdef,
             'stable', p.provolatile = 's',
             'path', (select s from unnest(p.proconfig) s where s like 'search_path=%'),
             'result', pg_get_function_result(p.oid),
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'member', has_function_privilege('authenticated', p.oid, 'execute'),
             'service', has_function_privilege('service_role', p.oid, 'execute'),
             'public', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                where x.grantee = 0 and x.privilege_type = 'EXECUTE')) end
      from (select to_regprocedure($1::text || '.${STANDING}') as oid) f
      left join pg_proc p on p.oid = f.oid)
) as facts`;

function structure(schema, facts) {
  const c = facts.column;
  check("acc_account.is_clearing is a boolean, not null, default false",
    Boolean(c) && c.type === "boolean" && c.nullable === "NO" && c.default === "false", JSON.stringify(c));
  check("only a current asset or a current liability may carry the tick",
    typeof facts.rule === "string" && facts.rule.includes("current_asset") && facts.rule.includes("current_liability"), String(facts.rule));
  const f = facts.standing;
  check(`${STANDING} exists and returns the columns the service maps`, Boolean(f) && f.result === COLUMNS, JSON.stringify(f?.result));
  check(`${STANDING} is stable security definer, search_path pinned to ${schema}`,
    Boolean(f) && f.definer && f.stable && f.path === `search_path=${schema}`, JSON.stringify(f && { definer: f.definer, path: f.path }));
  check(`${STANDING} is closed to anon and public, open to signed-in users and the service role`,
    Boolean(f) && !f.anon && !f.public && f.member && f.service,
    JSON.stringify(f && { anon: f.anon, public: f.public, member: f.member, service: f.service }));
}

/** The backfill, read as plain data: counts only. */
async function backfillFacts() {
  const r = await one(
    `select count(*) filter (where account_type = 'current_asset' and name ilike '%undeposited%' and not is_clearing)::int as missed,
            count(*) filter (where account_type = 'current_asset' and detail_type in ('undeposited_funds','transfer_clearing') and not is_clearing)::int as missed_detail,
            count(*) filter (where is_clearing and account_type not in ('current_asset','current_liability'))::int as wrong_type,
            count(*) filter (where is_clearing)::int as ticked
       from acc_account`,
  );
  check(`the backfill ticked every current-asset Undeposited Funds and Transfer Clearing account (${r.ticked} ticked)`,
    r.missed === 0 && r.missed_detail === 0, JSON.stringify(r));
  check("…and no ticked account is of another type", r.wrong_type === 0);
}

/** Read only: acting as an active administrator, one row per ticked account, each agreeing with the ledger. */
async function readOnlyCall() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  if (!admin) {
    console.log("  (no active administrator; the read-only call is skipped)");
    return;
  }
  const ticked = (await one(`select count(*)::int as n from acc_account where is_clearing`)).n;
  const ledger = Object.fromEntries(
    (await all(
      `select a.id,
              (select coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
                 from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
                where l.account_id = a.id and e.status = 'posted' and e.entry_date <= current_date) as bal,
              (select count(*)::int
                 from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
                where l.account_id = a.id and e.status = 'posted' and e.entry_date <= current_date) as lines
         from acc_account a
        where a.is_clearing`,
    )).map((r) => [r.id, r]),
  );
  await client.query("set local role authenticated");
  await as(admin.id);
  try {
    const rows = await all(`select * from acc_clearing_standing(current_date)`);
    check(`acc_clearing_standing returns one row per ticked account (${ticked})`, rows.length === ticked, String(rows.length));
    check("…each naming a different account", new Set(rows.map((r) => r.account_id)).size === rows.length);
    check("…each balance agreeing with the posted ledger",
      rows.every((r) => Number(r.balance_minor) === Number(ledger[r.account_id]?.bal)));
    check("…open_minor is the absolute balance, and a zero balance has no open items",
      rows.every((r) => Number(r.open_minor) === Math.abs(Number(r.balance_minor)) &&
        (Number(r.balance_minor) !== 0 ? r.open_count >= 1 && r.open_oldest_date !== null : r.open_count === 0 && r.open_oldest_date === null)));
    check("…and the last movement is null exactly when the account has no posted lines",
      rows.every((r) => (r.last_movement_date === null) === (ledger[r.account_id]?.lines === 0)));
    const past = await all(`select * from acc_clearing_standing(date '2000-01-01')`);
    check("a date before any activity gives the same accounts, each empty",
      past.length === ticked && past.every((r) => Number(r.balance_minor) === 0 && r.open_count === 0 && r.last_movement_date === null));
  } finally {
    await client.query("reset role");
  }
}

// ---------------------------------------------------------------------------
// Behaviour, in the sample company only
// ---------------------------------------------------------------------------
async function behaviour() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  const base = await one(`select code from acc_currency where is_base limit 1`);
  if (!admin || !base) {
    console.log("  (no active administrator or base currency; behaviour checks skipped)");
    return;
  }
  const today = (await one(
    `select coalesce((select (now() at time zone time_zone)::date from acc_company_setting_version
                        order by version desc limit 1), current_date)::text as d`,
  )).d;
  const ago = (n) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };

  // ---- invented books, made inside this rolled-back transaction
  const stamp = Date.now().toString(36).toUpperCase();
  if ((await one(`select acc_approval_required('manual_journal', 100000) as required`)).required) {
    await client.query(`update acc_approval_policy set enabled = false where action_key = 'manual_journal'`);
    console.log("  (manual-journal approval switched off inside this transaction)");
  }
  const make = async (letter, type, ticked) =>
    (await one(
      `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account, is_clearing)
       values ($1, $2, $3::acc_account_type, $4, true, $5) returning id`,
      [`ZZ-VCA-${letter}-${stamp}`, `Verify clearing ${letter}`, type, base.code, ticked],
    )).id;
  const offset = await make("X", "expense", false);
  const A = await make("A", "current_asset", true);
  const B = await make("B", "current_liability", true);
  const C = await make("C", "current_asset", true);
  const E = await make("E", "current_asset", true);
  const D = await make("D", "current_asset", false);

  const sampleUndeposited = await one(
    `select count(*)::int as n, count(*) filter (where is_clearing)::int as ticked
       from acc_account where account_type = 'current_asset' and name ilike '%undeposited%' and account_code not like 'ZZ-VCA-%'`,
  );
  check("the sample company's Undeposited Funds was ticked by the backfill",
    sampleUndeposited.n >= 1 && sampleUndeposited.n === sampleUndeposited.ticked, JSON.stringify(sampleUndeposited));
  const tickedBefore = (await one(`select count(*)::int as n from acc_account where is_clearing`)).n;

  await client.query("set local role authenticated");
  await as(admin.id);

  /** Posts one manual entry moving `minor` into (positive) or out of (negative) the account. */
  const post = async (account, date, minor) => {
    const lines =
      minor > 0
        ? [{ account_id: account, debit_minor: minor, credit_minor: 0 }, { account_id: offset, debit_minor: 0, credit_minor: minor }]
        : [{ account_id: offset, debit_minor: -minor, credit_minor: 0 }, { account_id: account, debit_minor: 0, credit_minor: -minor }];
    return (await one(`select acc_post_manual_journal($1, 'Verify clearing', null, $2, $3::jsonb) as id`, [
      date, base.code, JSON.stringify(lines),
    ])).id;
  };

  // ---- the scenario
  // A: five receipts of 1000 on 100, 95, 90, 85, 80 days ago; a deposit of 2500 at 50 days
  //    (clears two receipts and half of the third); twelve small receipts of 100 from 30 to 19
  //    days ago; a deposit of 1700 at 10 days ago.
  for (const n of [100, 95, 90, 85, 80]) await post(A, ago(n), 1000);
  await post(A, ago(50), -2500);
  for (let n = 30; n >= 19; n -= 1) await post(A, ago(n), 100);
  const lastDeposit = await post(A, ago(10), -1700);
  // B: payroll-style liability: credits are the items. Owed 3000 at 40 days and 2000 at 35; paid 3500 at 20.
  await post(B, ago(40), -3000);
  await post(B, ago(35), -2000);
  await post(B, ago(20), 3500);
  // C: in at 30 days, out at 10: back to zero
  await post(C, ago(30), 700);
  await post(C, ago(10), -700);
  // D: not ticked, with a line
  await post(D, ago(15), 123);
  // An entry that is not posted never counts: post one more to A, then void it
  const voided = await post(A, ago(5), 4000);
  await asOwner(admin.id, () =>
    client.query(`update acc_journal_entry set status = 'void', voided_at = now() where id = $1`, [voided]));

  const standing = async (asOf) => {
    const rows = await all(
      `select account_id, balance_minor::int as bal, last_movement_date::text as last_on, open_count,
              open_oldest_date::text as oldest, open_minor::int as open_minor
         from acc_clearing_standing($1::date)`,
      [asOf],
    );
    return Object.fromEntries(rows.map((r) => [r.account_id, r]));
  };
  const same = (row, want) => Object.entries(want).every(([k, v]) => row?.[k] === v);
  const show = (row, want) => JSON.stringify(Object.fromEntries(Object.keys(want).map((k) => [k, row?.[k] === want[k]])));
  const expectRow = (label, row, want) => check(label, same(row, want), show(row, want));

  console.log("  at today");
  let rows = await standing(today);
  check("one row per ticked account; the unticked account is not returned",
    Object.keys(rows).length === tickedBefore && !rows[D] && Boolean(rows[A] && rows[B] && rows[C] && rows[E]),
    `${Object.keys(rows).length} of ${tickedBefore}`);
  expectRow("asset: two deposits left one part-cleared receipt and the twelve small ones; the voided entry does not count", rows[A], {
    bal: 2000, last_on: ago(10), open_count: 13, oldest: ago(80), open_minor: 2000,
  });
  expectRow("liability: the credits are the items; the payment cleared the first and part of the second", rows[B], {
    bal: -1500, last_on: ago(20), open_count: 1, oldest: ago(35), open_minor: 1500,
  });
  expectRow("zero balance: no open items and no oldest date, but it did move", rows[C], {
    bal: 0, last_on: ago(10), open_count: 0, oldest: null, open_minor: 0,
  });
  expectRow("no lines: zeros and nulls", rows[E], { bal: 0, last_on: null, open_count: 0, oldest: null, open_minor: 0 });

  console.log("  as of earlier dates");
  rows = await standing(ago(60));
  expectRow("before the deposits: all five receipts open", rows[A], { bal: 5000, last_on: ago(80), open_count: 5, oldest: ago(100), open_minor: 5000 });
  rows = await standing(ago(50));
  expectRow("on the day of the first deposit: it counts, and clears two receipts and half of the third", rows[A], {
    bal: 2500, last_on: ago(50), open_count: 3, oldest: ago(90), open_minor: 2500,
  });
  rows = await standing(ago(25));
  expectRow("part way through the small receipts", rows[A], { bal: 3100, last_on: ago(25), open_count: 9, oldest: ago(90), open_minor: 3100 });
  expectRow("liability, before the payment: both credits open", rows[B], { bal: -5000, last_on: ago(35), open_count: 2, oldest: ago(40), open_minor: 5000 });
  expectRow("zero account, mid-way: the receipt is open", rows[C], { bal: 700, last_on: ago(30), open_count: 1, oldest: ago(30), open_minor: 700 });
  rows = await standing(ago(11));
  expectRow("the day before the last deposit: not counted yet", rows[A], { bal: 3700, last_on: ago(19), open_count: 15, oldest: ago(90), open_minor: 3700 });
  rows = await standing(ago(200));
  expectRow("a date before everything: every account is empty", rows[A], { bal: 0, last_on: null, open_count: 0, oldest: null, open_minor: 0 });
  await refused("no date: refused", `select * from acc_clearing_standing(null)`, [], "Choose the date to read the clearing accounts at");
  check("the last deposit really was posted (the scenario ran)", Boolean(lastDeposit));

  console.log("  the type rule and the write path");
  await asOwner(admin.id, async () => {
    const expense = await make("G", "expense", false);
    await refused("ticking an expense account is refused", `update acc_account set is_clearing = true where id = $1`, [expense], "acc_account_clearing_type_ck");
    await refused("creating an expense account already ticked is refused",
      `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account, is_clearing)
       values ($1, 'Verify clearing H', 'expense', $2, true, true)`,
      [`ZZ-VCA-H-${stamp}`, base.code], "acc_account_clearing_type_ck");
    await refused("retyping a ticked asset account to income is refused",
      `update acc_account set account_type = 'income' where id = $1`, [A], "acc_account_clearing_type_ck");
  });
  await client.query("savepoint staff_write");
  const ticked = await one(`update acc_account set is_clearing = true where id = $1 returning is_clearing`, [D]);
  check("staff tick an account through the ordinary table update (row level security)", ticked?.is_clearing === true);
  rows = await standing(today);
  expectRow("…and it is returned at once, with its one open item", rows[D], { bal: 123, last_on: ago(15), open_count: 1, oldest: ago(15), open_minor: 123 });
  const unticked = await one(`update acc_account set is_clearing = false where id = $1 returning is_clearing`, [D]);
  check("…and untick it the same way", unticked?.is_clearing === false);
  await client.query("rollback to savepoint staff_write");

  console.log("  who may");
  await client.query("savepoint as_viewer");
  await asOwner(admin.id, () => client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]));
  check("a viewer reads the standing", (await all(`select 1 from acc_clearing_standing($1::date)`, [today])).length === tickedBefore);
  const viewerWrite = await client.query(`update acc_account set is_clearing = true where id = $1`, [D]);
  check("…but cannot tick an account", viewerWrite.rowCount === 0, String(viewerWrite.rowCount));
  await client.query("rollback to savepoint as_viewer");
  await client.query("savepoint as_accountant");
  await asOwner(admin.id, () => client.query(`update acc_app_user set role = 'accountant' where id = $1`, [admin.id]));
  check("an accountant reads the standing", (await all(`select 1 from acc_clearing_standing($1::date)`, [today])).length === tickedBefore);
  await client.query("rollback to savepoint as_accountant");
  await as(OUTSIDER);
  await refused("an outsider cannot read the standing", `select * from acc_clearing_standing($1::date)`, [today], "Not authorized");
  await as(admin.id);
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
      // One round trip. A newline before every semicolon, so a statement
      // ending in a line comment cannot swallow the next one.
      const sql = schema === "public"
        ? MIGRATION
        : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements.join("\n;\n");
      await client.query(sql);
      console.log("  (0145 applied inside the transaction, never committed)");
      await client.query(sql);
      check("applying 0145 a second time is harmless", true);
      await client.query(`set local search_path = ${schema}, extensions`);
      const { facts } = await one(FACTS, [schema]);
      structure(schema, facts);
      await backfillFacts();
      await readOnlyCall();
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
