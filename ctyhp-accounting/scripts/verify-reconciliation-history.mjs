/**
 * Behavioural verification of migration 0142 (Reconciliation history, 2.03) on
 * every company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0142 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing is left behind.
 *
 *  - In every schema: structure only. The new column, and the six functions
 *    with their result types, security definer, pinned search path and grants,
 *    read in one query.
 *  - In co_pc (the sample company) only: the behaviour, acting as a staff user.
 *    Three bank accounts are made inside the transaction, each with its own
 *    ledger account and a few invented entries posted through
 *    acc_post_manual_journal, so no existing reconciliation can interfere:
 *      A  bring forward refused (out, past today, a session in progress that
 *         ends too early) and then done; the history row before and after
 *      B  a session in progress from an invented statement: the rebase, a
 *         statement line set aside and restored, the duplicate lookup, and
 *         discarding it (with every refusal, an adjustment among them)
 *      C  0132's bring-forward on the shared rule
 *    A viewer and an outsider are checked by turning the administrator into
 *    one inside the same transaction.
 *
 * 0142 adds a column to acc_reconciliation_statement_line, which takes that
 * table's strongest lock until the transaction ends. The migration is sent in
 * one round trip and the structure read in one more, so a real company's
 * statement lines are held for as little time as possible.
 *
 * Prints counts and pass/fail lines only: no names, no amounts.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-reconciliation-history.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0142_reconciliation_history.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const FUNCTIONS = {
  "acc_bring_history_forward(uuid,date,bigint,text)": "jsonb",
  "acc_bring_forward_reconciliation(uuid,date,bigint,text)": "uuid",
  "acc_discard_reconciliation(uuid,text)": "integer",
  "acc_reconciliation_history()":
    "TABLE(bank_account_id uuid, open_lines integer, first_open_date date, last_open_date date, last_reconciled_date date, in_progress_id uuid, in_progress_ending_date date)",
  "acc_set_statement_line_aside(uuid,integer,boolean)": "void",
  "acc_statement_line_duplicates(uuid,integer[])":
    "TABLE(line_no integer, journal_line_id uuid, entry_id uuid, entry_number text, entry_date date)",
};

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
    // The message is printed only when it is not the one expected; it can name an entry number, never an amount here.
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// Structure, in every schema: one query.
// ---------------------------------------------------------------------------
const FACTS = `
select jsonb_build_object(
  'column', (
    select jsonb_build_object('type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
                              'default', pg_get_expr(d.adbin, d.adrelid),
                              'member_update', has_column_privilege('authenticated', a.attrelid, a.attnum, 'update'))
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = to_regclass($1::text || '.acc_reconciliation_statement_line')
       and a.attname = 'set_aside' and not a.attisdropped),
  'functions', (
    select jsonb_object_agg(f.sig, case when p.oid is null then null else jsonb_build_object(
             'definer', p.prosecdef,
             'path', (select s from unnest(p.proconfig) s where s like 'search_path=%'),
             'result', pg_get_function_result(p.oid),
             'shared', p.prosrc like '%acc_bring_history_forward(%',
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'member', has_function_privilege('authenticated', p.oid, 'execute'),
             'service', has_function_privilege('service_role', p.oid, 'execute'),
             'public', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                where x.grantee = 0 and x.privilege_type = 'EXECUTE')) end)
      from unnest($2::text[]) as f(sig)
      left join pg_proc p on p.oid = to_regprocedure($1::text || '.' || f.sig))
) as facts`;

function structure(schema, facts) {
  const c = facts.column;
  check("acc_reconciliation_statement_line.set_aside is a boolean, not null, false by default",
    Boolean(c) && c.type === "boolean" && c.not_null === true && c.default === "false", JSON.stringify(c));
  check("signed-in users cannot write set_aside directly", Boolean(c) && c.member_update === false, JSON.stringify(c));
  for (const [sig, result] of Object.entries(FUNCTIONS)) {
    const f = facts.functions?.[sig];
    check(`${sig} exists, returns what parts 2 and 3 expect`, Boolean(f) && f.result === result, JSON.stringify(f?.result));
    check(`${sig} is security definer, search_path pinned to ${schema}`,
      Boolean(f) && f.definer && f.path === `search_path=${schema}`, JSON.stringify(f && { definer: f.definer, path: f.path }));
    check(`${sig} is closed to anon and public, open to signed-in users and the service role`,
      Boolean(f) && !f.anon && !f.public && f.member && f.service,
      JSON.stringify(f && { anon: f.anon, public: f.public, member: f.member, service: f.service }));
  }
  check("acc_bring_forward_reconciliation calls acc_bring_history_forward",
    facts.functions?.["acc_bring_forward_reconciliation(uuid,date,bigint,text)"]?.shared === true);
}

// ---------------------------------------------------------------------------
// Behaviour, in the sample company only
// ---------------------------------------------------------------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** An ISO date as to_char(d, 'Mon FMDD, YYYY') writes it. */
const spoken = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;

async function behaviour() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  const base = await one(`select code from acc_currency where is_base limit 1`);
  if (!admin || !base) {
    console.log("  (no active administrator or base currency; behaviour checks skipped)");
    return;
  }
  // The company's today, as 0142 counts it; every date below is that many days before it.
  const today = (await one(
    `select coalesce((select (now() at time zone time_zone)::date from acc_company_setting_version
                        order by version desc limit 1), current_date)::text as d`,
  )).d;
  const ago = (n) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };

  // ---- invented books, made as the owner inside this rolled-back transaction
  const stamp = Date.now().toString(36).toUpperCase();
  if ((await one(`select acc_approval_required('manual_journal', 100000) as required`)).required) {
    await client.query(`update acc_approval_policy set enabled = false where action_key = 'manual_journal'`);
    console.log("  (manual-journal approval switched off inside this transaction)");
  }
  const offset = (await one(
    `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
     values ($1, 'Verify history offset', 'expense', $2, true) returning id`,
    [`ZZ-VRH-X-${stamp}`, base.code],
  )).id;
  const makeBank = async (letter) => {
    const gl = (await one(
      `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
       values ($1, $2, 'bank', $3, true) returning id`,
      [`ZZ-VRH-${letter}-${stamp}`, `Verify history bank ${letter}`, base.code],
    )).id;
    const id = (await one(
      `insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, $2, $3) returning id`,
      [gl, `Verify History Bank ${letter}`, base.code],
    )).id;
    return { id, gl };
  };
  const A = await makeBank("A");
  const B = await makeBank("B");
  const C = await makeBank("C");
  const bankCount = (await one(`select count(*)::int as n from acc_bank_account`)).n;

  await client.query("set local role authenticated");
  await as(admin.id);

  /** Posts one manual entry moving `minor` into (positive) or out of (negative) the bank; returns its bank line. */
  const post = async (bank, date, minor, ref = null) => {
    const lines =
      minor > 0
        ? [{ account_id: bank.gl, debit_minor: minor, credit_minor: 0 }, { account_id: offset, debit_minor: 0, credit_minor: minor }]
        : [{ account_id: offset, debit_minor: -minor, credit_minor: 0 }, { account_id: bank.gl, debit_minor: 0, credit_minor: -minor }];
    const entry = (await one(`select acc_post_manual_journal($1, 'Verify reconciliation history', $2, $3, $4::jsonb) as id`, [
      date, ref, base.code, JSON.stringify(lines),
    ])).id;
    const line = (await one(`select id from acc_journal_line where journal_entry_id = $1 and account_id = $2`, [entry, bank.gl])).id;
    const number = (await one(`select entry_number from acc_journal_entry where id = $1`, [entry])).entry_number;
    return { entry, line, number, date };
  };
  const entryCount = async () => (await one(`select count(*)::int as n from acc_journal_entry`)).n;
  const postedOn = async (bank) =>
    (await one(
      `select count(*)::int as n from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
        where l.account_id = $1 and e.status = 'posted'`,
      [bank.gl],
    )).n;
  const ticks = async (rec) => (await one(`select count(*)::int as n from acc_reconciliation_line where reconciliation_id = $1`, [rec])).n;
  const session = (rec) => one(`select * from acc_statement_reconciliation where id = $1`, [rec]);
  const historyOf = async (bank) => {
    const row = await one(
      `select open_lines, first_open_date::text as first, last_open_date::text as last,
              last_reconciled_date::text as reconciled, in_progress_id, in_progress_ending_date::text as in_progress_on
         from acc_reconciliation_history() where bank_account_id = $1`,
      [bank.id],
    );
    return row ?? null;
  };
  const audit = (rec, action) =>
    asOwner(admin.id, () =>
      all(`select before_json, after_json from acc_audit_log
            where table_name = 'acc_statement_reconciliation' and record_id = $1 and action = $2 order by created_at, id`,
        [rec, action]));

  const BRING = `select acc_bring_history_forward($1, $2::date, $3, $4) as r`;
  const WRAPPER = `select acc_bring_forward_reconciliation($1, $2::date, $3, $4) as id`;
  const DISCARD = `select acc_discard_reconciliation($1, $2) as n`;
  const ASIDE = `select acc_set_statement_line_aside($1, $2, $3)`;
  const DUPLICATES = `select line_no, journal_line_id, entry_id, entry_number, entry_date::text as entry_date
                        from acc_statement_line_duplicates($1, $2::int[])`;
  const NOTE = "Verify: brought forward, proved by an invented statement";

  // ======================================================================
  // A: bringing the history forward, and its refusals
  // ======================================================================
  console.log("  bringing the history forward (account A)");
  const a1 = await post(A, ago(50), 100000);
  await post(A, ago(45), -25000, "4411");
  await post(A, ago(40), 5000);
  const a4 = await post(A, ago(30), -12000, "4412");
  const a5 = await post(A, ago(20), 7000);
  const through = ago(35);

  let h = await historyOf(A);
  check("history, before: one row per bank account", (await one(`select count(*)::int as n from acc_reconciliation_history()`)).n === bankCount);
  check("history, before: five open lines from the first to the last entry, nothing reconciled, nothing in progress",
    Boolean(h) && h.open_lines === 5 && h.first === a1.date && h.last === a5.date && h.reconciled === null && h.in_progress_id === null,
    JSON.stringify(h && { n: h.open_lines, first: h.first === a1.date, last: h.last === a5.date }));

  await refused("out: refused with both figures, the date and the amount it is out by", BRING, [A.id, through, 90000, NOTE],
    `The books hold 800.00 on ${spoken(through)}; the statement shows 900.00. Out by 100.00.`);
  await refused("out the other way: the amount it is out by is never negative", BRING, [A.id, through, 70000, NOTE],
    `The books hold 800.00 on ${spoken(through)}; the statement shows 700.00. Out by 100.00.`);
  await refused("past today: refused", BRING, [A.id, ago(-2), 80000, NOTE], "A bank account cannot be brought forward past today");
  await refused("no date: refused", BRING, [A.id, null, 80000, NOTE], "Choose the date the history is brought forward through");
  await refused("no balance: refused", BRING, [A.id, through, null, NOTE], "Enter the statement balance on that date");
  await refused("an unknown bank account: refused", BRING, [OUTSIDER, through, 0, NOTE], "Bank account not found");

  await client.query("savepoint early_session");
  await one(`select acc_create_reconciliation($1, $2::date, 0) as id`, [A.id, through]);
  await refused("a session in progress that ends on the date: refused", BRING, [A.id, through, 80000, NOTE],
    "Finish or discard the reconciliation in progress first.");
  await refused("…and 0132's bring-forward still refuses an account with only a session in progress", WRAPPER, [A.id, through, 80000, NOTE],
    "This bank account already has a reconciliation; only the first one can be brought forward");
  await client.query("rollback to savepoint early_session");

  const entriesBefore = await entryCount();
  const ra = (await one(BRING, [A.id, through, 80000, `  ${NOTE}  `])).r;
  check("matching: the answer names the new session, three lines, none moved, nothing rebased",
    typeof ra.reconciliation_id === "string" && ra.lines === 3 && ra.moved === 0 && ra.rebased_reconciliation_id === null,
    JSON.stringify({ lines: ra.lines, moved: ra.moved, rebased: ra.rebased_reconciliation_id }));
  const fa = await session(ra.reconciliation_id);
  check("matching: one completed, brought-forward session through the date, from 0 to the statement balance",
    fa.status === "completed" && fa.brought_forward === true && Number(fa.beginning_balance_minor) === 0 &&
      Number(fa.statement_ending_balance_minor) === 80000 && fa.completed_by === admin.id && fa.prepared_by === admin.id);
  check("matching: the note is kept, trimmed", fa.note === NOTE);
  check("matching: it holds the three lines through the date", (await ticks(ra.reconciliation_id)) === 3);
  check("matching: nothing was posted", (await entryCount()) === entriesBefore);
  const insertRows = await audit(ra.reconciliation_id, "insert");
  check("matching: one audit row for the new session, with the account, the date, the balance and the lines",
    insertRows.length === 1 && insertRows[0].after_json.bank_account_id === A.id && insertRows[0].after_json.through === through &&
      Number(insertRows[0].after_json.balance_minor) === 80000 && insertRows[0].after_json.lines === 3 &&
      insertRows[0].after_json.moved === 0);
  check("matching: and its sign-off, as a completed session has", (await audit(ra.reconciliation_id, "post")).length === 1);

  h = await historyOf(A);
  check("history, after: two open lines left, after the date; reconciled up to the date",
    Boolean(h) && h.open_lines === 2 && h.first === a4.date && h.last === a5.date && h.reconciled === through && h.in_progress_id === null,
    JSON.stringify(h && { n: h.open_lines, reconciled: h.reconciled === through }));

  await refused("a second time: refused", BRING, [A.id, through, 80000, NOTE], "This account already has a completed reconciliation.");
  await refused("a second time, through a later date: refused", BRING, [A.id, ago(25), 68000, NOTE],
    "This account already has a completed reconciliation.");

  // ======================================================================
  // B: a session in progress, rebased; set aside; duplicates; discard
  // ======================================================================
  console.log("  a session in progress (account B)");
  const b1 = await post(B, ago(50), 20000);
  await post(B, ago(48), -5000);
  const b3 = await post(B, ago(30), -7500, "5531");
  const b4 = await post(B, ago(12), -3300);
  const b5 = await post(B, ago(12), 3300);
  const bThrough = ago(40);

  // An invented statement. Line 1 is a check image read twice: the same check
  // number ten days later. Lines 2 and 3 are fees 5 and 6 days from the books'
  // fee; line 4 is money in of the same size as that fee; line 6 carries no
  // check number, at the amount of an old payment.
  const statement = [
    { txn_date: ago(30), description: "CHECK", reference: "5531", amount_minor: -7500, balance_minor: 7500 },
    { txn_date: ago(20), description: "CHECK IMAGE", reference: "#5531", amount_minor: -7500, balance_minor: 0 },
    { txn_date: ago(17), description: "SERVICE FEE", reference: null, amount_minor: -3300, balance_minor: -3300 },
    { txn_date: ago(18), description: "SERVICE FEE", reference: null, amount_minor: -3300, balance_minor: -6600 },
    { txn_date: ago(8), description: "DEPOSIT", reference: null, amount_minor: 3300, balance_minor: -3300 },
    { txn_date: ago(9), description: "WIRE", reference: "ZZ-1", amount_minor: -999, balance_minor: -4299 },
    { txn_date: ago(25), description: "PAYMENT", reference: null, amount_minor: -5000, balance_minor: -9299 },
  ];
  const S = (await one(
    `select acc_create_reconciliation_from_statement($1, $2::date, $3, $4, $5, $6::jsonb) as id`,
    [B.id, ago(5), 7500, "verify-invented-statement.pdf", 15000, JSON.stringify(statement)],
  )).id;
  check("the session from the invented statement begins at 0 and holds its seven lines",
    Number((await session(S)).beginning_balance_minor) === 0 &&
      (await one(`select count(*)::int as n from acc_reconciliation_statement_line where reconciliation_id = $1`, [S])).n === 7);
  await one(`select acc_set_cleared_many($1, $2::uuid[], true) as n`, [S, [b1.line, b3.line]]);
  const tickedAt = (await one(`select cleared_at::text as t from acc_reconciliation_line where reconciliation_id = $1 and journal_line_id = $2`, [S, b1.line])).t;

  h = await historyOf(B);
  check("history: a tick in a session in progress still counts as open; the session and its ending date are named",
    Boolean(h) && h.open_lines === 5 && h.first === b1.date && h.last === b4.date && h.reconciled === null &&
      h.in_progress_id === S && h.in_progress_on === ago(5),
    JSON.stringify(h && { n: h.open_lines, inProgress: h.in_progress_id === S }));

  const rb = (await one(BRING, [B.id, bThrough, 15000, NOTE])).r;
  check("rebase: two lines brought forward, one of them moved out of the session in progress, which is named",
    rb.lines === 2 && rb.moved === 1 && rb.rebased_reconciliation_id === S,
    JSON.stringify({ lines: rb.lines, moved: rb.moved, rebased: rb.rebased_reconciliation_id === S }));
  const movedTick = await one(
    `select reconciliation_id, cleared_at::text as t from acc_reconciliation_line where journal_line_id = $1`, [b1.line]);
  check("rebase: the tick on the earlier line moved to the new session, keeping when it was ticked",
    movedTick.reconciliation_id === rb.reconciliation_id && movedTick.t === tickedAt);
  check("rebase: the new session holds both earlier lines", (await ticks(rb.reconciliation_id)) === 2);
  check("rebase: the session in progress keeps its later tick only", (await ticks(S)) === 1 &&
    (await one(`select count(*)::int as n from acc_reconciliation_line where reconciliation_id = $1 and journal_line_id = $2`, [S, b3.line])).n === 1);
  const sAfter = await session(S);
  check("rebase: the session in progress now begins at the statement balance, and is still in progress",
    Number(sAfter.beginning_balance_minor) === 15000 && sAfter.status === "in_progress");
  const offered = await all(`select journal_line_id from acc_reconciliation_lines($1)`, [S]);
  check("rebase: the session now offers only the lines after the date", offered.length === 3 &&
    !offered.some((l) => l.journal_line_id === b1.line), String(offered.length));
  const updateRows = await audit(S, "update");
  const rebaseRow = updateRows.find((r) => r.after_json?.brought_forward_id === rb.reconciliation_id);
  check("rebase: an audit row for the changed session, with the old and new beginning and the lines moved",
    Boolean(rebaseRow) && Number(rebaseRow.before_json.beginning_balance_minor) === 0 &&
      Number(rebaseRow.after_json.beginning_balance_minor) === 15000 && rebaseRow.after_json.lines === 1 &&
      rebaseRow.after_json.through === bThrough);
  const bInsert = await audit(rb.reconciliation_id, "insert");
  check("rebase: the new session's audit row counts the moved tick", bInsert.length === 1 && bInsert[0].after_json.moved === 1 &&
    bInsert[0].after_json.lines === 2);
  h = await historyOf(B);
  check("history, after the rebase: three open lines, reconciled up to the date, the session still named",
    Boolean(h) && h.open_lines === 3 && h.first === b3.date && h.last === b4.date && h.reconciled === bThrough && h.in_progress_id === S);

  // ---- set aside
  console.log("  setting a statement line aside");
  const asideOf = async (no) =>
    (await one(`select set_aside from acc_reconciliation_statement_line where reconciliation_id = $1 and line_no = $2`, [S, no])).set_aside;
  // Every row in one transaction shares one created_at, so rows are told apart by what they hold.
  const asideRows = async () => (await audit(S, "update")).filter((r) => r.after_json?.line_no === 1);
  await one(ASIDE, [S, 1, true]);
  check("a line is set aside", (await asideOf(1)) === true && (await asideOf(0)) === false);
  let rows = await asideRows();
  check("…with one audit row naming the line", rows.length === 1 && rows[0].after_json.set_aside === true &&
    rows[0].before_json.set_aside === false);
  await one(ASIDE, [S, 1, true]);
  check("setting it aside again changes nothing and writes nothing", (await asideRows()).length === 1);
  await one(ASIDE, [S, 1, false]);
  rows = await asideRows();
  check("…and Restore brings it back, with its own audit row", (await asideOf(1)) === false && rows.length === 2 &&
    rows.some((r) => r.after_json.set_aside === false && r.before_json.set_aside === true));
  await refused("an unknown line: refused", ASIDE, [S, 99, true], "Statement line not found");
  await refused("a completed session: refused", ASIDE, [ra.reconciliation_id, 0, true], "Reconciliation is not in progress");
  await refused("no answer either way: refused", ASIDE, [S, 1, null], "Say whether the line is set aside or brought back");

  // ---- duplicates
  console.log("  looking for duplicates");
  const found = await all(DUPLICATES, [S, [0, 1, 2, 3, 4, 5, 6, 77]]);
  const pairs = found.map((r) => [r.line_no, r.journal_line_id]);
  check("the right book lines come back, in statement-line order",
    same(pairs, [[0, b3.line], [1, b3.line], [2, b4.line], [4, b5.line]]), `${found.length} rows`);
  check("by check number: a check image ten days on is found by its cleaned number", pairs.some(([n, l]) => n === 1 && l === b3.line));
  check("by date: a fee 5 days from the books' fee is found", pairs.some(([n, l]) => n === 2 && l === b4.line));
  check("…but not one 6 days away", !pairs.some(([n]) => n === 3));
  check("the sign is respected: a fee never matches money in of the same size, nor the other way round",
    !pairs.some(([n, l]) => (n === 2 && l === b5.line) || (n === 4 && l === b4.line)));
  check("an amount the books do not hold finds nothing", !pairs.some(([n]) => n === 5));
  check("an empty check number never matches, so an old payment of the same amount is not found", !pairs.some(([n]) => n === 6));
  check("each match carries its entry, entry number and date",
    found.every((r) => typeof r.entry_id === "string" && /\S/.test(r.entry_number) && /^\d{4}-\d{2}-\d{2}$/.test(r.entry_date)) &&
      found.find((r) => r.line_no === 2)?.entry_number === b4.number && found.find((r) => r.line_no === 2)?.entry_date === b4.date);
  check("no line numbers asked, nothing found", (await all(DUPLICATES, [S, []])).length === 0);
  await refused("more than 500 line numbers: refused", DUPLICATES, [S, Array.from({ length: 501 }, (_, i) => i)],
    "At most 500 statement lines can be checked at once");
  await refused("an unknown session: refused", DUPLICATES, [OUTSIDER, [0]], "Reconciliation not found");

  // ---- who may
  console.log("  who may");
  await client.query("savepoint as_viewer");
  await asOwner(admin.id, () => client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]));
  check("a viewer reads the history", (await one(`select count(*)::int as n from acc_reconciliation_history()`)).n === bankCount);
  check("a viewer reads the duplicates", (await all(DUPLICATES, [S, [1]])).length === 1);
  await refused("a viewer cannot bring the history forward", BRING, [C.id, ago(50), 0, NOTE], "Not authorized");
  await refused("a viewer cannot use 0132's bring-forward", WRAPPER, [C.id, ago(50), 0, NOTE], "Not authorized");
  await refused("a viewer cannot discard", DISCARD, [S, "Verify"], "Not authorized");
  await refused("a viewer cannot set a line aside", ASIDE, [S, 1, true], "Not authorized");
  await client.query("rollback to savepoint as_viewer");
  await as(OUTSIDER);
  await refused("an outsider cannot read the history", `select * from acc_reconciliation_history()`, [], "Not authorized");
  await refused("an outsider cannot read the duplicates", DUPLICATES, [S, [1]], "Not authorized");
  await refused("an outsider cannot bring the history forward", BRING, [C.id, ago(50), 0, NOTE], "Not authorized");
  await refused("an outsider cannot discard", DISCARD, [S, "Verify"], "Not authorized");
  await as(admin.id);

  // ---- discard
  console.log("  discarding");
  await refused("a completed session: refused", DISCARD, [ra.reconciliation_id, "Verify"],
    "Only a reconciliation in progress can be discarded");
  await refused("a blank reason: refused", DISCARD, [S, "   "], "A reason is required to discard a reconciliation");
  await refused("an unknown session: refused", DISCARD, [OUTSIDER, "Verify"], "Reconciliation not found");

  await client.query("savepoint adjusted");
  await one(`select acc_set_cleared($1, $2, false)`, [S, b3.line]);
  const adjustment = (await one(`select acc_record_reconciliation_adjustment($1, $2, 'Verify adjustment') as id`, [S, offset])).id;
  const adjustmentNumber = (await one(`select entry_number from acc_journal_entry where id = $1`, [adjustment])).entry_number;
  await refused("a posted adjustment: refused, naming the entry", DISCARD, [S, "Verify"],
    `This reconciliation posted an adjustment (${adjustmentNumber}), so it cannot be discarded.`);
  await asOwner(admin.id, () => client.query(`update acc_journal_entry set status = 'void', voided_at = now() where id = $1`, [adjustment]));
  check("…and once that adjustment is void, the session can be discarded", (await one(DISCARD, [S, "Verify"])).n === 1);
  await client.query("rollback to savepoint adjusted");

  const postedBefore = await postedOn(B);
  const removed = (await one(DISCARD, [S, "  Verify: started on the wrong statement  "])).n;
  check("discard: the number of ticks removed comes back", removed === 1, String(removed));
  check("discard: the session is gone", (await one(`select count(*)::int as n from acc_statement_reconciliation where id = $1`, [S])).n === 0);
  check("discard: its ticks and statement lines went with it",
    (await ticks(S)) === 0 &&
      (await one(`select count(*)::int as n from acc_reconciliation_statement_line where reconciliation_id = $1`, [S])).n === 0);
  check("discard: every entry is still posted", (await postedOn(B)) === postedBefore && postedBefore === 5);
  check("discard: the brought-forward session stays", (await session(rb.reconciliation_id))?.status === "completed");
  const discardRows = await audit(S, "delete");
  check("discard: one audit row with the reason, the account, the statement ending date and the ticks",
    discardRows.length === 1 && discardRows[0].before_json.reason === "Verify: started on the wrong statement" &&
      discardRows[0].before_json.bank_account_id === B.id && discardRows[0].before_json.statement_ending_date === ago(5) &&
      discardRows[0].before_json.ticks === 1 && typeof discardRows[0].before_json.account === "string");
  h = await historyOf(B);
  check("history, after the discard: nothing in progress", Boolean(h) && h.in_progress_id === null && h.open_lines === 3);
  check("a new session can be started on the account", typeof (await one(`select acc_create_reconciliation($1, $2::date, 0) as id`, [B.id, ago(5)])).id === "string");

  // ======================================================================
  // C: 0132's bring-forward on the shared rule
  // ======================================================================
  console.log("  0132's bring-forward (account C)");
  await post(C, ago(60), 4000);
  await post(C, ago(55), -1000);
  await refused("out: 0132's bring-forward now refuses with the shared message", WRAPPER, [C.id, ago(50), 2500, NOTE],
    `The books hold 30.00 on ${spoken(ago(50))}; the statement shows 25.00. Out by 5.00.`);
  const rc = (await one(WRAPPER, [C.id, ago(50), 3000, NOTE])).id;
  const fc = await session(rc);
  check("on a fresh account it still brings the history forward and returns the session",
    typeof rc === "string" && fc.status === "completed" && fc.brought_forward === true && (await ticks(rc)) === 2);
  await refused("it still refuses an account with any reconciliation", WRAPPER, [A.id, through, 80000, NOTE],
    "This bank account already has a reconciliation; only the first one can be brought forward");
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
      // One round trip each. A newline before every semicolon, so a statement
      // ending in a line comment cannot swallow the next one.
      const sql = schema === "public"
        ? MIGRATION
        : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements.join("\n;\n");
      await client.query(sql);
      console.log("  (0142 applied inside the transaction, never committed)");
      await client.query(sql);
      check("applying 0142 a second time is harmless", true);
      await client.query(`set local search_path = ${schema}, extensions`);
      const { facts } = await one(FACTS, [schema, Object.keys(FUNCTIONS)]);
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
