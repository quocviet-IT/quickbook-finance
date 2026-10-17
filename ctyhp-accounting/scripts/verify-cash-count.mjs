/**
 * Behavioural verification of migrations 0152-0154 (cash count) on every company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. The three migrations are applied
 * inside it (retargeted to the schema, as scripts/migrate.mjs does), so nothing
 * is left behind and nothing needs to be live.
 *
 *  - In every schema: structure only, plus read-only checks. The table, RLS,
 *    grants, triggers, the approval policy row (off, threshold 0), the
 *    functions, account 7510 and the standing read.
 *  - In co_pc (the sample company) only: the behaviour. Counts are recorded,
 *    approved, rejected and refused there, every one of them rolled back, on
 *    dates in 2001 (and today) so no real period or entry is touched.
 *
 * A new enum value cannot be used in the transaction that adds it. Until 0152 is
 * committed, the behaviour checks borrow an existing label for it: inside the
 * transaction the label 'stock_count' is renamed to 'cash_count', which is
 * usable at once and is undone with everything else by the rollback. When
 * 0152 is live the real value is used.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-cash-count.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILES = ["0152_cash_count_source.sql", "0153_cash_over_and_short.sql", "0154_cash_count.sql"];
const SOURCES = FILES.map((file) => ({
  file,
  sql: readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"),
}));
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
  const t = await one(
    `select c.relrowsecurity as rls,
            has_table_privilege('authenticated', c.oid, 'select') as sel,
            has_table_privilege('authenticated', c.oid, 'insert') as ins,
            has_table_privilege('authenticated', c.oid, 'update') as upd,
            has_table_privilege('authenticated', c.oid, 'delete') as del,
            has_table_privilege('authenticated', c.oid, 'truncate') as trunc,
            has_table_privilege('anon', c.oid, 'select') as anon_sel,
            has_table_privilege('service_role', c.oid, 'insert') as svc
       from pg_class c where c.oid = to_regclass('acc_cash_count')`,
  );
  check("acc_cash_count exists with RLS on", Boolean(t) && t.rls === true);
  check("acc_cash_count is SELECT-only for signed-in users, closed to anon, open to the service role",
    Boolean(t) && t.sel && !t.ins && !t.upd && !t.del && !t.trunc && !t.anon_sel && t.svc, JSON.stringify(t));
  const policies = await all(`select cmd from pg_policies where schemaname = $1 and tablename = 'acc_cash_count'`, [schema]);
  check("the table has one read policy and no write policy", policies.length === 1 && policies[0].cmd === "SELECT", JSON.stringify(policies));
  const triggers = await all(`select tgname from pg_trigger where tgrelid = to_regclass('acc_cash_count') and not tgisinternal order by tgname`);
  check("the table has its actor-stamp and audit triggers",
    triggers.map((r) => r.tgname).join(",") === "acc_cash_count_actor_stamp,acc_cash_count_atomic_audit", JSON.stringify(triggers));
  check("a rejected request marks its count: the trigger is on acc_approval_request",
    (await one(`select count(*)::int as n from pg_trigger where tgrelid = to_regclass('acc_approval_request') and tgname = 'acc_approval_request_cash_count'`)).n === 1);

  const policy = await one(`select enabled, threshold_minor::bigint as threshold, require_segregation from acc_approval_policy where action_key = 'cash_count'`);
  check("the cash_count approval policy exists, off, with the default threshold (0, as every new policy row)",
    Boolean(policy) && policy.enabled === false && Number(policy.threshold) === 0, JSON.stringify(policy));
  const callable = [
    "acc_cash_book_minor(uuid,date)",
    "acc_post_cash_count(uuid,date,bigint,uuid,text)",
    "acc_cash_accounts_standing(date)",
    "acc_approve_request(uuid,text)",
  ];
  const internal = [
    "acc_cash_count_post_entry(uuid,uuid,date,uuid,bigint)",
    "acc_post_pending_cash_count(uuid)",
    "acc_cash_count_request_closed()",
  ];
  for (const fn of [...callable, ...internal]) {
    const isInternal = internal.includes(fn);
    const f = await one(
      `select p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
         from pg_proc p where p.oid = to_regprocedure($1)`,
      [fn],
    );
    check(
      `${fn} exists, is security definer with search_path, closed to anon, ${isInternal ? "closed to signed-in users" : "open to signed-in users"}`,
      Boolean(f) && f.definer && (f.config ?? []).some((c) => c.startsWith("search_path=")) && !f.anon_exec && f.auth_exec === !isInternal,
      JSON.stringify(f),
    );
  }

  const code = await all(`select account_code, name, account_type::text as type, status::text as status, is_posting_account as posting, cash_flow_role from acc_account where account_code = '7510'`);
  check("exactly one account has code 7510", code.length === 1, `${code.length}`);
  if (code[0]?.name === "Cash Over and Short") {
    check("…it is Cash Over and Short, an active other_expense posting account with operating cash-flow role",
      code[0].type === "other_expense" && code[0].status === "active" && code[0].posting && code[0].cash_flow_role === "operating", JSON.stringify(code[0]));
  } else {
    console.log("  (code 7510 already belongs to another account here; the migration left it alone)");
  }

  // read-only: the standing read as an administrator
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  if (admin) {
    const cashAccounts = (await one(`select count(*)::int as n from acc_account where account_type = 'bank' and detail_type = 'cash_on_hand' and status = 'active'`)).n;
    await client.query("set local role authenticated");
    await as(admin.id);
    try {
      const rows = await all(`select * from acc_cash_accounts_standing(current_date)`);
      check("the standing read gives one row per cash on hand account", rows.length === cashAccounts, `${rows.length} vs ${cashAccounts}`);
      check("…and every row's last-count columns are empty before any count exists",
        rows.every((r) => r.last_counted_on === null && r.counted_minor === null && r.days_since === null));
    } finally {
      await client.query("reset role");
    }
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

  // Owner prep, all rolled back: a cash account of our own, so the check does not depend on what the sample holds.
  const cash = (await one(
    `insert into acc_account (account_code, name, account_type, detail_type, currency_code, is_posting_account, status)
     values ('V-CASH-1', 'Verify till', 'bank', 'cash_on_hand', $1, true, 'active') returning id`,
    [base.code],
  )).id;
  const cash2 = (await one(
    `insert into acc_account (account_code, name, account_type, detail_type, currency_code, is_posting_account, status)
     values ('V-CASH-2', 'Verify safe', 'bank', 'cash_on_hand', $1, true, 'active') returning id`,
    [base.code],
  )).id;
  const checking = (await one(
    `insert into acc_account (account_code, name, account_type, detail_type, currency_code, is_posting_account, status)
     values ('V-BANK-1', 'Verify checking', 'bank', 'checking', $1, true, 'active') returning id`,
    [base.code],
  )).id;
  const equity = (await one(`select id from acc_account where account_type = 'equity' and is_posting_account and status = 'active' order by account_code limit 1`))?.id;
  const over = (await one(`select id from acc_account where account_code = '7510' and name = 'Cash Over and Short'`))?.id;
  check("account 7510 Cash Over and Short is there for the count to default to", Boolean(over));
  if (!equity || !over) return;
  await client.query(`update acc_approval_policy set enabled = false where action_key = 'cash_count'`);

  await client.query("set local role authenticated");
  await as(admin.id);

  const today = (await one(
    `select coalesce((select (now() at time zone s.time_zone)::date::text from acc_company_setting_version s order by s.version desc limit 1), current_date::text) as d`,
  )).d;
  const shift = (date, minor, debit, credit) =>
    one(`select acc_post_entry($1, 'Verify cash count: book shift', 'manual', null, $2,
                               jsonb_build_array(
                                 jsonb_build_object('account_id', $3::uuid, 'debit_minor', $4::bigint, 'credit_minor', 0, 'amount_base_minor', $4::bigint),
                                 jsonb_build_object('account_id', $5::uuid, 'debit_minor', 0, 'credit_minor', $4::bigint, 'amount_base_minor', $4::bigint))) as id`,
      [date, base.code, debit, minor, credit]);
  const COUNT = `select acc_post_cash_count($1, $2, $3, $4, $5) as r`;
  const count = async (account, date, counted, offset = over, memo = null) => (await one(COUNT, [account, date, counted, offset, memo])).r;
  const row = (id) => one(`select *, counted_on::text as counted_on_text from acc_cash_count where id = $1`, [id]);
  const linesOf = (entry) =>
    all(`select account_id, debit_minor::bigint as d, credit_minor::bigint as c from acc_journal_line where journal_entry_id = $1 order by line_order`, [entry]);
  const bookAt = async (account, date) =>
    Number((await one(`select acc_cash_book_minor($1, $2) as v`, [account, date])).v);

  // the books: 100,000 in the till on 1 June 2001
  await shift("2001-06-01", 100000, cash, equity);
  check("the book balance read agrees with the ledger", (await bookAt(cash, "2001-06-30")) === 100000);
  check("…and is nil before the first entry", (await bookAt(cash, "2001-05-31")) === 0);

  // ---- who may count
  await as(OUTSIDER);
  await refused("someone outside the company cannot record a count", COUNT, [cash, "2001-06-30", 100000, over, null], "Not authorized");
  await refused("someone outside the company cannot read the standing", `select * from acc_cash_accounts_standing('2001-06-30')`, [], "Not authorized");
  check("someone outside the company reads no counts", (await all(`select * from acc_cash_count`)).length === 0);
  await as(admin.id);

  // ---- what recording refuses
  await refused("no account is refused", COUNT, [null, "2001-06-30", 1, over, null], "Choose the cash account");
  await refused("no date is refused", COUNT, [cash, null, 1, over, null], "Enter the date");
  await refused("no amount is refused", COUNT, [cash, "2001-06-30", null, over, null], "Enter the amount counted");
  await refused("a negative amount is refused", COUNT, [cash, "2001-06-30", -1, over, null], "cannot be negative");
  await refused("a bank account that is not cash on hand is refused", COUNT, [checking, "2001-06-30", 1, over, null], "cash on hand account");
  await refused("an unknown account is refused", COUNT, [OUTSIDER, "2001-06-30", 1, over, null], "cash on hand account");
  await refused("an offset that is the cash account is refused", COUNT, [cash, "2001-06-30", 1, cash, null], "must differ");
  await refused("no offset account is refused", COUNT, [cash, "2001-06-30", 1, null, null], "offset account");
  await refused("an unknown offset account is refused", COUNT, [cash, "2001-06-30", 1, OUTSIDER, null], "offset account");
  await refused("a date after today is refused", COUNT, [cash, "2999-01-01", 1, over, null], "after today");
  await refused("a memo over 500 characters is refused", COUNT, [cash, "2001-06-30", 1, over, "x".repeat(501)], "too long");
  await client.query("savepoint closed");
  try {
    await asOwner(admin.id, () =>
      client.query(
        `insert into acc_accounting_period (fiscal_year, period_month, period_start, period_end, label, status)
         values (2001, 5, '2001-05-01', '2001-05-31', 'May 2001', 'closed')`,
      ),
    );
    await refused("a date in a closed period is refused", COUNT, [cash, "2001-05-15", 1, over, null], "Accounting period for 2001-05-15 is closed");
  } finally {
    await client.query("rollback to savepoint closed");
  }
  await asOwner(admin.id, () => client.query(`update acc_account set status = 'inactive' where id = $1`, [cash2]));
  await refused("an inactive cash account is refused", COUNT, [cash2, "2001-06-30", 1, over, null], "cash on hand account");
  await asOwner(admin.id, () => client.query(`update acc_account set status = 'active' where id = $1`, [cash2]));
  check("none of the refusals left a count behind", (await one(`select count(*)::int as n from acc_cash_count`)).n === 0);

  // ---- a shortfall: Dr offset / Cr cash
  const short = await count(cash, "2001-06-30", 97500, over, "  Verify shortfall  ");
  const shortRow = await row(short.cash_count_id);
  check("a shortfall is posted, with the server's book figure and a negative difference",
    short.status === "posted" && Number(short.book_minor) === 100000 && Number(short.difference_minor) === -2500 &&
      shortRow.status === "posted" && Number(shortRow.counted_minor) === 97500 && Number(shortRow.book_minor) === 100000 &&
      Number(shortRow.difference_minor) === -2500 && shortRow.offset_account_id === over && shortRow.counted_on_text === "2001-06-30" &&
      shortRow.memo === "Verify shortfall" && shortRow.created_by === admin.id && shortRow.approval_request_id === null,
    JSON.stringify(shortRow));
  const shortEntry = await one(`select source_type::text as source, source_id, status::text as status, entry_date::text as d, description from acc_journal_entry where id = $1`, [short.journal_entry_id]);
  check("the entry has source cash_count, points at the count and carries the count date",
    shortEntry.source === "cash_count" && shortEntry.source_id === short.cash_count_id && shortEntry.status === "posted" && shortEntry.d === "2001-06-30",
    JSON.stringify(shortEntry));
  const shortLines = await linesOf(short.journal_entry_id);
  check("a shortfall debits 7510 and credits cash for the difference",
    shortRow.journal_entry_id === short.journal_entry_id && shortLines.length === 2 &&
      shortLines[0].account_id === over && Number(shortLines[0].d) === 2500 &&
      shortLines[1].account_id === cash && Number(shortLines[1].c) === 2500,
    JSON.stringify(shortLines));
  check("the books now hold the counted amount: the balance was adjusted by the difference, not overwritten",
    (await bookAt(cash, "2001-06-30")) === 97500 &&
      (await one(`select count(*)::int as n from acc_journal_line where account_id = $1`, [cash])).n === 2);
  check("an audit row for the count and one for the entry are written",
    (await one(`select count(*)::int as n from acc_audit_log where table_name = 'acc_cash_count' and record_id = $1 and actor_id = $2`, [short.cash_count_id, admin.id])).n === 1 &&
      (await one(`select count(*)::int as n from acc_audit_log where table_name = 'acc_journal_entry' and record_id = $1 and action = 'post'`, [short.journal_entry_id])).n === 1);

  // ---- an overage: Dr cash / Cr offset
  const overage = await count(cash, "2001-07-15", 101000, over, null);
  const overLines = await linesOf(overage.journal_entry_id);
  check("an overage is posted against the books as they stood, with a positive difference",
    overage.status === "posted" && Number(overage.book_minor) === 97500 && Number(overage.difference_minor) === 3500, JSON.stringify(overage));
  check("an overage debits cash and credits 7510",
    overLines.length === 2 && overLines[0].account_id === cash && Number(overLines[0].d) === 3500 &&
      overLines[1].account_id === over && Number(overLines[1].c) === 3500, JSON.stringify(overLines));

  // ---- another account can be the offset
  const other = await count(cash, "2001-07-20", 100500, equity, null);
  const otherLines = await linesOf(other.journal_entry_id);
  check("a different offset account is used when chosen",
    Number(other.difference_minor) === -500 && otherLines[0].account_id === equity && otherLines[1].account_id === cash, JSON.stringify(otherLines));

  // ---- zero difference: recorded, nothing posted
  const entriesBefore = Number((await one(`select count(*) as n from acc_journal_entry`)).n);
  const zero = await count(cash, "2001-08-03", 100500, over, "All there");
  const zeroRow = await row(zero.cash_count_id);
  check("a zero difference posts no entry but is recorded as posted",
    zero.status === "posted" && zero.journal_entry_id === null && Number(zero.difference_minor) === 0 &&
      zeroRow.status === "posted" && zeroRow.journal_entry_id === null &&
      Number((await one(`select count(*) as n from acc_journal_entry`)).n) === entriesBefore);

  // ---- viewers read, others do not (the administrator, demoted for a moment inside this transaction)
  const setRole = (role) => asOwner(admin.id, () => client.query("update acc_app_user set role = $1 where id = $2", [role, admin.id]));
  await setRole("viewer");
  await refused("a viewer cannot record a count", COUNT, [cash, "2001-08-20", 1, over, null], "Not authorized");
  check("a viewer can read the book balance", (await bookAt(cash, "2001-08-03")) === 100500);
  check("a viewer can read the standing", (await all(`select * from acc_cash_accounts_standing('2001-08-10')`)).length >= 2);
  check("a viewer can read the counts", (await all(`select * from acc_cash_count`)).length === 4);
  await setRole("sales");
  await refused("a salesperson cannot record a count", COUNT, [cash, "2001-08-20", 1, over, null], "Not authorized");
  await refused("a salesperson cannot read the standing", `select * from acc_cash_accounts_standing('2001-08-10')`, [], "Not authorized");
  check("a salesperson reads no counts", (await all(`select * from acc_cash_count`)).length === 0);
  await setRole("admin");

  // ---- the standing
  const standingAt = (date) => all(`select s.*, s.last_counted_on::text as last_on from acc_cash_accounts_standing($1) s`, [date]);
  const standing = await standingAt("2001-08-10");
  const mine = standing.find((r) => r.account_id === cash);
  const never = standing.find((r) => r.account_id === cash2);
  check("the standing shows the latest posted count, its figures and the days since",
    Boolean(mine) && mine.last_on === "2001-08-03" && Number(mine.balance_minor) === 100500 &&
      Number(mine.counted_minor) === 100500 && Number(mine.difference_minor) === 0 && mine.days_since === 7,
    JSON.stringify(mine));
  check("a cash account never counted has empty last-count columns",
    Boolean(never) && never.last_on === null && never.days_since === null && Number(never.balance_minor) === 0, JSON.stringify(never));
  check("the standing leaves out accounts that are not cash on hand", !standing.some((r) => r.account_id === checking));
  const earlier = (await standingAt("2001-07-16")).find((r) => r.account_id === cash);
  check("as of an earlier date it shows the count that stood then",
    earlier.last_on === "2001-07-15" && Number(earlier.counted_minor) === 101000 && Number(earlier.difference_minor) === 3500 &&
      earlier.days_since === 1 && Number(earlier.balance_minor) === 101000, JSON.stringify(earlier));
  await refused("the standing needs a date", `select * from acc_cash_accounts_standing(null)`, [], "Choose the date");

  // ---- writes go through the functions only
  await refused("a signed-in user cannot insert into the table",
    `insert into acc_cash_count (account_id, counted_on, counted_minor, book_minor, difference_minor, offset_account_id, status)
     values ($1, '2001-01-01', 0, 0, 0, $2, 'posted')`, [cash, over], /permission denied|row-level security/);
  await refused("…nor update it", `update acc_cash_count set counted_minor = 0`, [], /permission denied|row-level security/);
  await refused("…nor delete from it", `delete from acc_cash_count`, [], /permission denied|row-level security/);
  await refused("the internal posting function is closed to signed-in users",
    `select acc_cash_count_post_entry($1, $2, '2001-01-01', $3, 100)`, [OUTSIDER, cash, over], "permission denied");
  await refused("the dispatch-only function is closed to signed-in users",
    `select acc_post_pending_cash_count($1)`, [OUTSIDER], "permission denied");

  // ---- the approval policy
  await asOwner(admin.id, () =>
    client.query(`update acc_approval_policy set enabled = true, threshold_minor = 1000, require_segregation = false where action_key = 'cash_count'`),
  );
  const small = await count(cash, "2001-09-01", 99700, over, null);
  check("below the threshold a count posts directly",
    small.status === "posted" && Number(small.difference_minor) === -800 && small.journal_entry_id !== null && small.approval_request_id === null);

  const before = await bookAt(cash, "2001-09-10");
  const entriesNow = Number((await one(`select count(*) as n from acc_journal_entry`)).n);
  const big = await count(cash, "2001-09-10", before + 3000, over, "Large overage");
  const bigRow = await row(big.cash_count_id);
  const request = await one(
    `select action_key, status::text as status, amount_minor::bigint as amount, payload, reason, requested_by from acc_approval_request where id = $1`,
    [big.approval_request_id],
  );
  check("at the threshold the count waits for approval, with a request linked both ways",
    big.status === "pending_approval" && big.journal_entry_id === null && Number(big.difference_minor) === 3000 &&
      bigRow.status === "pending_approval" && bigRow.approval_request_id === big.approval_request_id && bigRow.journal_entry_id === null &&
      Number(bigRow.difference_minor) === 3000, JSON.stringify(bigRow));
  check("…the request names the count, its size and the reason, and was made by the person counting",
    request.action_key === "cash_count" && request.status === "pending" && Number(request.amount) === 3000 &&
      request.payload.cash_count_id === big.cash_count_id && request.reason === "Large overage" && request.requested_by === admin.id,
    JSON.stringify(request));
  check("…and nothing was posted or moved",
    Number((await one(`select count(*) as n from acc_journal_entry`)).n) === entriesNow && (await bookAt(cash, "2001-09-10")) === before);
  const pending = (await standingAt("2001-09-10")).find((r) => r.account_id === cash);
  check("a count waiting for approval does not date the account: the last count is still the earlier one",
    pending.last_on === "2001-09-01" && Number(pending.counted_minor) === 99700, JSON.stringify(pending));

  // the books move before the approval: the difference is worked out again at approval
  await shift("2001-09-10", 500, cash, equity);
  const approved = (await one(`select acc_approve_request($1, 'Verify') as id`, [big.approval_request_id])).id;
  const bigAfter = await row(big.cash_count_id);
  check("approving posts the count and returns its entry",
    bigAfter.status === "posted" && bigAfter.journal_entry_id === approved && approved !== null, JSON.stringify(bigAfter));
  check("the difference is recomputed at approval, against the books as they stand",
    Number(bigAfter.book_minor) === before + 500 && Number(bigAfter.difference_minor) === 2500, `${bigAfter.book_minor} / ${bigAfter.difference_minor}`);
  const approvedLines = await linesOf(approved);
  check("…and the entry debits cash and credits 7510 by that difference",
    approvedLines[0].account_id === cash && Number(approvedLines[0].d) === 2500 && approvedLines[1].account_id === over && Number(approvedLines[1].c) === 2500);
  check("…the request is approved with the entry as its result",
    (await one(`select status::text as status, result_id from acc_approval_request where id = $1`, [big.approval_request_id])).result_id === approved);
  check("the books now hold the counted amount", (await bookAt(cash, "2001-09-10")) === before + 3000);

  // rejected, and cancelled: the count stays unposted, marked so
  const rej = await count(cash, "2001-09-20", (await bookAt(cash, "2001-09-20")) - 4000, over, "To be rejected");
  check("another large difference waits for approval", rej.status === "pending_approval");
  await one(`select acc_reject_request($1, 'Not now')`, [rej.approval_request_id]);
  const rejRow = await row(rej.cash_count_id);
  check("a rejected request leaves the count unposted and marked rejected", rejRow.status === "rejected" && rejRow.journal_entry_id === null, JSON.stringify(rejRow));
  const can = await count(cash, "2001-09-21", (await bookAt(cash, "2001-09-21")) + 4000, over, "To be cancelled");
  await one(`select acc_cancel_request($1)`, [can.approval_request_id]);
  check("a cancelled request does the same", (await row(can.cash_count_id)).status === "rejected");
  const after = (await standingAt("2001-09-30")).find((r) => r.account_id === cash);
  check("rejected counts never count as the last count: the approved one of the 10th still stands",
    after.last_on === "2001-09-10" && Number(after.counted_minor) === before + 3000 && Number(after.difference_minor) === 2500 && after.days_since === 20,
    JSON.stringify(after));
  check("…and the books did not move for them", (await bookAt(cash, "2001-09-30")) === before + 3000);

  // a zero difference needs no approval even with the policy on at threshold 0
  await asOwner(admin.id, () => client.query(`update acc_approval_policy set threshold_minor = 0 where action_key = 'cash_count'`));
  const zeroUnderPolicy = await count(cash, "2001-10-01", await bookAt(cash, "2001-10-01"), over, null);
  check("with the policy on at threshold 0, a zero difference still just records",
    zeroUnderPolicy.status === "posted" && zeroUnderPolicy.approval_request_id === null && zeroUnderPolicy.journal_entry_id === null);

  // ---- today, in the company's time zone, is allowed
  const todays = await count(cash, today, await bookAt(cash, today), over, null);
  const todayRow = await row(todays.cash_count_id);
  check("a count dated today is accepted", todays.status === "posted" && todayRow.counted_on_text === today, JSON.stringify(todayRow));
  const now = (await standingAt(today)).find((r) => r.account_id === cash);
  check("…and the standing then reads zero days since the last count", now.last_on === today && now.days_since === 0, JSON.stringify(now));
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
      const hasValue = async () =>
        (await client.query(
          `select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
            where n.nspname = $1 and t.typname = 'acc_journal_source' and e.enumlabel = 'cash_count'`,
          [schema],
        )).rowCount > 0;
      const valueLive = await hasValue();
      const lived = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILES[2]])).rowCount > 0;
      const wanted = schema === SAMPLE && !valueLive ? SOURCES.slice(1) : SOURCES; // the sample borrows a label instead, below
      const statements =
        schema === "public"
          ? wanted.map((s) => s.sql)
          : planCompanySchema(wanted, schema).statements;
      for (const statement of statements) await client.query(statement);
      for (const statement of statements) await client.query(statement);
      console.log(`  (0152-0154 ${lived ? "are live and were applied again" : "applied inside the transaction, never committed"}; a second pass was harmless)`);
      check("applying the migrations twice is harmless", true);

      await structure(schema);

      if (schema === SAMPLE) {
        if (!valueLive) {
          await client.query(`alter type acc_journal_source rename value 'stock_count' to 'cash_count'`);
          console.log("  (0152 is not live: the label stock_count stands in for cash_count inside this transaction)");
        }
        await behaviour();
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
