/**
 * Behavioural verification of migration 0144 (Bank standing, 2.05) on every
 * company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0144 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing is left behind.
 *
 *  - In every schema: structure and a read-only call. The function exists with
 *    its result columns, security definer, pinned search path and grants;
 *    acc_unreconciled_bank leaves Cash on Hand out; and, acting as the
 *    company's administrator, acc_bank_standing returns one row per bank
 *    account, without erroring. Counts only.
 *  - In co_pc (the sample company) only: the behaviour. Six bank accounts are
 *    made inside the transaction, each with its own ledger account and a few
 *    invented entries, so no existing reconciliation can interfere:
 *      N  never reconciled, with lines
 *      C  current: reconciled recently, lines since, one item outstanding
 *      S  stale: reconciled long ago, nothing since
 *      F  brought forward, one line since
 *      V  a ticked entry voided after the reconciliation was completed
 *      Z  no lines and no balance
 *    Every column is asserted for each, then the as-of behaviour (a past date
 *    leaves out later reconciliations and later lines), Cash on Hand leaving
 *    acc_unreconciled_bank, and who may call.
 *
 * Prints counts and pass/fail lines only: no names, no amounts.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-bank-standing.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0144_bank_standing.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const STANDING = "acc_bank_standing(date)";
const COLUMNS =
  "TABLE(bank_account_id uuid, last_completed_id uuid, last_completed_date date, last_closing_minor bigint, " +
  "last_brought_forward boolean, since_count integer, since_net_minor bigint, earlier_open_count integer, " +
  "earlier_open_net_minor bigint, void_ticked_count integer, void_ticked_minor bigint, " +
  "void_reconciliation_date date, book_minor bigint)";

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
      left join pg_proc p on p.oid = f.oid),
  'unreconciled', (
    select jsonb_build_object('definer', p.prosecdef,
             'cash_left_out', p.prosrc like '%detail_type is distinct from ''cash_on_hand''%')
      from pg_proc p where p.oid = to_regprocedure($1::text || '.acc_unreconciled_bank(date)'))
) as facts`;

function structure(schema, facts) {
  const f = facts.standing;
  check(`${STANDING} exists and returns the columns the service maps`, Boolean(f) && f.result === COLUMNS, JSON.stringify(f?.result));
  check(`${STANDING} is stable security definer, search_path pinned to ${schema}`,
    Boolean(f) && f.definer && f.stable && f.path === `search_path=${schema}`, JSON.stringify(f && { definer: f.definer, path: f.path }));
  check(`${STANDING} is closed to anon and public, open to signed-in users and the service role`,
    Boolean(f) && !f.anon && !f.public && f.member && f.service,
    JSON.stringify(f && { anon: f.anon, public: f.public, member: f.member, service: f.service }));
  const u = facts.unreconciled;
  check("acc_unreconciled_bank leaves Cash on Hand out and is still not security definer",
    Boolean(u) && u.cash_left_out === true && u.definer === false, JSON.stringify(u));
}

/** Read only: acting as an active administrator, one row per bank account and no error. */
async function readOnlyCall() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  if (!admin) {
    console.log("  (no active administrator; the read-only call is skipped)");
    return;
  }
  const banks = (await one(`select count(*)::int as n from acc_bank_account`)).n;
  const cashBanks = (await one(
    `select count(*)::int as n from acc_bank_account b join acc_account a on a.id = b.account_id where a.detail_type = 'cash_on_hand'`,
  )).n;
  await client.query("set local role authenticated");
  await as(admin.id);
  try {
    const rows = await all(`select * from acc_bank_standing(current_date)`);
    check(`acc_bank_standing returns one row per bank account (${banks})`, rows.length === banks, String(rows.length));
    check("…none of them Cash on Hand", cashBanks === 0);
    check("…each with a book balance and counts that are not negative",
      rows.every((r) => r.book_minor !== null && r.since_count >= 0 && r.earlier_open_count >= 0 && r.void_ticked_count >= 0));
    check("…and each row names a different account", new Set(rows.map((r) => r.bank_account_id)).size === rows.length);
    const past = await all(`select * from acc_bank_standing(date '2000-01-01')`);
    check("a date before any activity gives the same accounts, each with no lines",
      past.length === banks && past.every((r) => r.since_count === 0 && r.earlier_open_count === 0 && Number(r.book_minor) === 0 && r.last_completed_id === null));
    const cash = await one(`select item_count from acc_unreconciled_bank(current_date)`);
    check("acc_unreconciled_bank answers", cash && Number(cash.item_count) >= 0);
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
  const offset = (await one(
    `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
     values ($1, 'Verify standing offset', 'expense', $2, true) returning id`,
    [`ZZ-VBS-X-${stamp}`, base.code],
  )).id;
  const makeBank = async (letter) => {
    const gl = (await one(
      `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
       values ($1, $2, 'bank', $3, true) returning id`,
      [`ZZ-VBS-${letter}-${stamp}`, `Verify standing bank ${letter}`, base.code],
    )).id;
    const id = (await one(
      `insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, $2, $3) returning id`,
      [gl, `Verify Standing Bank ${letter}`, base.code],
    )).id;
    return { id, gl };
  };
  const N = await makeBank("N");
  const C = await makeBank("C");
  const S = await makeBank("S");
  const F = await makeBank("F");
  const V = await makeBank("V");
  const Z = await makeBank("Z");
  const cashGl = (await one(
    `insert into acc_account (account_code, name, account_type, detail_type, currency_code, is_posting_account)
     values ($1, 'Verify standing cash', 'bank', 'cash_on_hand', $2, true) returning id`,
    [`ZZ-VBS-K-${stamp}`, base.code],
  )).id;
  const bankCount = (await one(`select count(*)::int as n from acc_bank_account`)).n;

  await client.query("set local role authenticated");
  await as(admin.id);

  /** Posts one manual entry moving `minor` into (positive) or out of (negative) the account; returns its ledger line. */
  const post = async (gl, date, minor) => {
    const lines =
      minor > 0
        ? [{ account_id: gl, debit_minor: minor, credit_minor: 0 }, { account_id: offset, debit_minor: 0, credit_minor: minor }]
        : [{ account_id: offset, debit_minor: -minor, credit_minor: 0 }, { account_id: gl, debit_minor: 0, credit_minor: -minor }];
    const entry = (await one(`select acc_post_manual_journal($1, 'Verify bank standing', null, $2, $3::jsonb) as id`, [
      date, base.code, JSON.stringify(lines),
    ])).id;
    const line = (await one(`select id from acc_journal_line where journal_entry_id = $1 and account_id = $2`, [entry, gl])).id;
    return { entry, line };
  };
  /** A completed reconciliation made as the owner, holding the given ledger lines. */
  const complete = (bank, endedOn, closing, lines, brought = false) =>
    asOwner(admin.id, async () => {
      const id = (await one(
        `insert into acc_statement_reconciliation
           (bank_account_id, statement_ending_date, beginning_balance_minor, statement_ending_balance_minor,
            status, completed_by, completed_at, brought_forward)
         values ($1, $2::date, 0, $3, 'completed', $4, now(), $5) returning id`,
        [bank.id, endedOn, closing, admin.id, brought],
      )).id;
      for (const l of lines) {
        await client.query(`insert into acc_reconciliation_line (reconciliation_id, journal_line_id) values ($1, $2)`, [id, l.line]);
      }
      return id;
    });

  // ---- the scenario
  // N: never reconciled
  await post(N.gl, ago(100), 10000);
  await post(N.gl, ago(20), -2500);
  // C: reconciled 60 days ago; one outstanding item from before; two lines since
  const c1 = await post(C.gl, ago(90), 50000);
  const c2 = await post(C.gl, ago(70), -10000);
  await post(C.gl, ago(80), -700);
  await post(C.gl, ago(10), 3000);
  await post(C.gl, ago(5), -500);
  const recC = await complete(C, ago(60), 40000, [c1, c2]);
  // S: reconciled 380 days ago, nothing since
  const s1 = await post(S.gl, ago(400), 20000);
  const recS = await complete(S, ago(380), 20000, [s1]);
  // F: brought forward 280 days ago; one line since
  const f1 = await post(F.gl, ago(300), 8000);
  const f2 = await post(F.gl, ago(290), -3000);
  const recF = await complete(F, ago(280), 5000, [f1, f2], true);
  await post(F.gl, ago(100), 1000);
  // V: two entries ticked in a reconciliation 150 days ago, one voided since
  const v1 = await post(V.gl, ago(200), 6000);
  const v2 = await post(V.gl, ago(190), 4000);
  const recV = await complete(V, ago(150), 10000, [v1, v2]);
  await asOwner(admin.id, () =>
    client.query(`update acc_journal_entry set status = 'void', voided_at = now() where id = $1`, [v2.entry]));
  // Cash on Hand: a posted line, never a bank account
  await post(cashGl, ago(30), 99900);

  const standing = async (asOf) => {
    const rows = await all(
      `select bank_account_id, last_completed_id, last_completed_date::text as last_date, last_closing_minor::int as closing,
              last_brought_forward as carried, since_count, since_net_minor::int as since_net, earlier_open_count,
              earlier_open_net_minor::int as earlier_net, void_ticked_count, void_ticked_minor::int as void_net,
              void_reconciliation_date::text as void_date, book_minor::int as book
         from acc_bank_standing($1::date)`,
      [asOf],
    );
    return Object.fromEntries(rows.map((r) => [r.bank_account_id, r]));
  };
  const same = (row, want) => Object.entries(want).every(([k, v]) => row?.[k] === v);
  const show = (row, want) => JSON.stringify(Object.fromEntries(Object.keys(want).map((k) => [k, row?.[k] === want[k]])));
  const expectRow = (label, row, want) => check(label, same(row, want), show(row, want));

  console.log("  at today");
  let rows = await standing(today);
  check("one row per bank account, and Cash on Hand is not among them",
    Object.keys(rows).length === bankCount && !rows[cashGl]);

  expectRow("never reconciled: no last reconciliation, two lines since, nothing earlier", rows[N.id], {
    last_completed_id: null, last_date: null, closing: null, carried: null,
    since_count: 2, since_net: 7500, earlier_open_count: 0, earlier_net: 0,
    void_ticked_count: 0, void_net: 0, void_date: null, book: 7500,
  });
  expectRow("current: last reconciliation, its closing, two lines since, one outstanding item", rows[C.id], {
    last_completed_id: recC, last_date: ago(60), closing: 40000, carried: false,
    since_count: 2, since_net: 2500, earlier_open_count: 1, earlier_net: -700,
    void_ticked_count: 0, void_net: 0, void_date: null, book: 41800,
  });
  expectRow("stale: an old reconciliation, nothing since, nothing outstanding", rows[S.id], {
    last_completed_id: recS, last_date: ago(380), closing: 20000, carried: false,
    since_count: 0, since_net: 0, earlier_open_count: 0, earlier_net: 0,
    void_ticked_count: 0, void_net: 0, void_date: null, book: 20000,
  });
  expectRow("brought forward: marked so, the proved closing, one line since", rows[F.id], {
    last_completed_id: recF, last_date: ago(280), closing: 5000, carried: true,
    since_count: 1, since_net: 1000, earlier_open_count: 0, earlier_net: 0,
    void_ticked_count: 0, void_net: 0, void_date: null, book: 6000,
  });
  expectRow("voided tick: the entry that was voided counts once, with its amount and the reconciliation's date", rows[V.id], {
    last_completed_id: recV, last_date: ago(150), closing: 10000, carried: false,
    since_count: 0, since_net: 0, earlier_open_count: 0, earlier_net: 0,
    void_ticked_count: 1, void_net: 4000, void_date: ago(150), book: 6000,
  });
  expectRow("no lines and no balance: zeros and nulls", rows[Z.id], {
    last_completed_id: null, last_date: null, closing: null, carried: null,
    since_count: 0, since_net: 0, earlier_open_count: 0, earlier_net: 0,
    void_ticked_count: 0, void_net: 0, void_date: null, book: 0,
  });

  console.log("  as of a past date");
  rows = await standing(ago(65));
  expectRow("before the current account's reconciliation ended: it is not there yet; its three older lines are all open", rows[C.id], {
    last_completed_id: null, last_date: null, closing: null, carried: null,
    since_count: 3, since_net: 39300, earlier_open_count: 0, earlier_net: 0, book: 39300,
  });
  rows = await standing(ago(55));
  expectRow("five days after it ended: the reconciliation counts, nothing is since, the outstanding item is earlier", rows[C.id], {
    last_completed_id: recC, last_date: ago(60), closing: 40000,
    since_count: 0, since_net: 0, earlier_open_count: 1, earlier_net: -700, book: 39300,
  });
  rows = await standing(ago(60));
  expectRow("on the day it ended: it counts (on or before)", rows[C.id], { last_completed_id: recC, since_count: 0, earlier_open_count: 1 });
  rows = await standing(ago(7));
  expectRow("a later date leaves out the line dated after it: one line since, book moves with the date", rows[C.id], {
    last_completed_id: recC, since_count: 1, since_net: 3000, earlier_open_count: 1, book: 42300,
  });
  rows = await standing(ago(160));
  expectRow("the voided-tick account, before its reconciliation: no reconciliation, no voided tick, the live entry open", rows[V.id], {
    last_completed_id: null, void_ticked_count: 0, void_net: 0, void_date: null, since_count: 1, since_net: 6000, book: 6000,
  });
  expectRow("the stale account, in the past before it was reconciled, shows its line as open from the beginning", (await standing(ago(390)))[S.id], {
    last_completed_id: null, since_count: 1, since_net: 20000, book: 20000,
  });
  expectRow("a date before everything: every account is empty", (await standing(ago(500)))[N.id], {
    last_completed_id: null, since_count: 0, since_net: 0, book: 0,
  });
  await refused("no date: refused", `select * from acc_bank_standing(null)`, [], "Choose the date to read the bank accounts at");

  console.log("  Cash on Hand and the dashboard");
  const dash = async () => one(`select item_count::int as n, amount_minor::int as net from acc_unreconciled_bank($1::date)`, [today]);
  const withCash = await dash();
  await asOwner(admin.id, () => client.query(`update acc_account set detail_type = null where id = $1`, [cashGl]));
  const asBank = await dash();
  check("a Cash on Hand line is left out; the same line on a bank account with no detail type counts",
    asBank.n === withCash.n + 1 && asBank.net === withCash.net + 99900, `${withCash.n} / ${asBank.n}`);
  await asOwner(admin.id, () => client.query(`update acc_account set detail_type = 'cash_on_hand' where id = $1`, [cashGl]));
  await refused("a Cash on Hand account cannot be made a bank account (0072)",
    `insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify cash', $2)`,
    [cashGl, base.code], /./);

  console.log("  who may");
  await client.query("savepoint as_viewer");
  await asOwner(admin.id, () => client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]));
  check("a viewer reads the standing", (await all(`select 1 from acc_bank_standing($1::date)`, [today])).length === bankCount);
  await client.query("rollback to savepoint as_viewer");
  await client.query("savepoint as_accountant");
  await asOwner(admin.id, () => client.query(`update acc_app_user set role = 'accountant' where id = $1`, [admin.id]));
  check("an accountant reads the standing", (await all(`select 1 from acc_bank_standing($1::date)`, [today])).length === bankCount);
  await client.query("rollback to savepoint as_accountant");
  await as(OUTSIDER);
  await refused("an outsider cannot read the standing", `select * from acc_bank_standing($1::date)`, [today], "Not authorized");
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
      console.log("  (0144 applied inside the transaction, never committed)");
      await client.query(sql);
      check("applying 0144 a second time is harmless", true);
      await client.query(`set local search_path = ${schema}, extensions`);
      const { facts } = await one(FACTS, [schema]);
      structure(schema, facts);
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
