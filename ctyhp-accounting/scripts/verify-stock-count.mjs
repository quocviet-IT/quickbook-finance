/**
 * Behavioural verification of migration 0139 (Stock Count) on every company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0139 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing is left behind.
 *
 *  - In every schema: structure only. Tables, RLS, grants, the sequence and the
 *    functions exist; the inventory-account rule and the default accounts
 *    resolve to something.
 *  - In co_pc (the sample company) only: the behaviour. Counts are created,
 *    saved, posted, sent for approval, rejected and refused there, every one of
 *    them rolled back, on dates in 2099 so no real period or entry is touched.
 *
 * Posting needs the 'stock_count' value of acc_journal_source (0138). When it is
 * not yet a committed value in a schema, the posting checks are skipped with one
 * line instead of failing.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-stock-count.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0139_stock_count.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const AS_OF = "2099-06-30";
const APPROVAL_GUARD = /requires approval;\s*submit it for approval instead/i;

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
  const tables = ["acc_stock_count", "acc_stock_count_line"];
  for (const table of tables) {
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
  }
  const policies = await all(`select tablename, cmd from pg_policies where schemaname = $1 and tablename = any($2::text[])`, [schema, tables]);
  check("both tables have a read policy and no write policy",
    policies.length === 2 && policies.every((p) => p.cmd === "SELECT"), JSON.stringify(policies));
  const triggers = await all(
    `select tgname from pg_trigger where tgrelid = to_regclass('acc_stock_count') and not tgisinternal order by tgname`,
  );
  check("the header has its actor-stamp and audit triggers",
    triggers.map((r) => r.tgname).join(",") === "acc_stock_count_actor_stamp,acc_stock_count_atomic_audit", JSON.stringify(triggers));
  check("a rejected request returns its count: the trigger is on acc_approval_request",
    (await one(`select count(*)::int as n from pg_trigger where tgrelid = to_regclass('acc_approval_request') and tgname = 'acc_approval_request_stock_count'`)).n === 1);
  check("the SC- sequence row exists",
    (await one(`select count(*)::int as n from acc_sequence where key = 'stock_count' and prefix = 'SC-'`)).n === 1);

  const functions = [
    "acc_inventory_account_ids()",
    "acc_stock_count_default_accounts()",
    "acc_create_stock_count(date)",
    "acc_save_stock_count(uuid,date,text,jsonb)",
    "acc_post_stock_count(uuid,uuid,uuid)",
    "acc_mark_stock_count_pending(uuid,uuid)",
    "acc_approve_request(uuid,text)",
  ];
  for (const fn of functions) {
    const f = await one(
      `select p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
         from pg_proc p where p.oid = to_regprocedure($1)`,
      [fn],
    );
    check(`${fn} exists, is security definer with search_path, closed to anon, open to signed-in users`,
      Boolean(f) && f.definer && (f.config ?? []).some((c) => c.startsWith("search_path=")) && !f.anon_exec && f.auth_exec,
      JSON.stringify(f));
  }

  const ids = await all(`select acc_inventory_account_ids() as id`);
  check("the inventory-account rule finds at least one account", ids.length > 0, `${ids.length}`);
  const defaults = await one(`select * from acc_stock_count_default_accounts()`);
  check("the default inventory and offset accounts resolve", Boolean(defaults?.inventory_account_id) && Boolean(defaults?.offset_account_id), JSON.stringify(defaults));
}

// ---------------------------------------------------------------------------
// Behaviour, in the sample company only
// ---------------------------------------------------------------------------
async function behaviour() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  const viewer = await one(`select id from acc_app_user where role = 'viewer' and status = 'active' order by created_at limit 1`);
  const base = await one(`select code from acc_currency where is_base limit 1`);
  if (!admin || !base) {
    console.log("  (no active administrator or base currency; behaviour checks skipped)");
    return;
  }

  // Owner prep: a clean slate for the checks, rolled back with everything else.
  await client.query(`delete from acc_stock_count where status in ('draft', 'pending_approval')`);
  await client.query(`update acc_item set is_active = false where is_inventory`);
  await client.query(`update acc_approval_policy set enabled = false where action_key = 'inventory_adjustment'`);
  const { inventory_account_id: inv, offset_account_id: off } = await one(`select * from acc_stock_count_default_accounts()`);

  await client.query("set local role authenticated");
  await as(admin.id);

  const bookAt = async (date) =>
    Number((await one(
      `select (coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else 0 end), 0)
             - coalesce(sum(case when l.credit_minor > 0 then l.amount_base_minor else 0 end), 0))::bigint as v
         from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
        where l.account_id in (select acc_inventory_account_ids()) and e.status = 'posted' and e.entry_date <= $1`,
      [date],
    )).v);
  const shift = (date, minor) =>
    one(`select acc_post_entry($1, 'Verify stock count: book shift', 'manual', null, $2,
                               jsonb_build_array(
                                 jsonb_build_object('account_id', $3::uuid, 'debit_minor', $4::bigint, 'credit_minor', 0, 'amount_base_minor', $4::bigint),
                                 jsonb_build_object('account_id', $5::uuid, 'debit_minor', 0, 'credit_minor', $4::bigint, 'amount_base_minor', $4::bigint))) as id`,
      [date, base.code, inv, minor, off]);
  const line = (name, quantity, cost, extra = {}) => ({ name, sku: null, quantity, unit_cost_minor: cost, sells_for_minor: null, ...extra });
  const save = (id, asOf, lines, memo = null) =>
    one(`select acc_save_stock_count($1, $2, $3, $4::jsonb) as n`, [id, asOf, memo, JSON.stringify(lines)]);
  /** A count whose lines add up to `target`: three lines that exercise rounding, and one that tops it up. */
  const sheet = (target) => {
    const known = 12500 + 833 + 396; // 10 x 1250, round(2.5 x 333), 4 x 99
    return [
      line("Sample widget", 10, 1250, { sku: "W-1", sells_for_minor: 999999 }),
      line("Sample gadget, large", 2.5, 333),
      line("Sample box", 4, 99),
      line("Balancing stock", 1, target - known),
    ];
  };
  const post = (id) => one(`select acc_post_stock_count($1, $2, $3) as id`, [id, inv, off]);
  const POST = `select acc_post_stock_count($1, $2, $3)`;
  const countRow = (id) => one(`select *, as_of::text as as_of_text from acc_stock_count where id = $1`, [id]);

  // the books: 200,000 of stock on 1 June 2099, so both signs of difference are possible
  await shift("2099-06-01", 200000);
  const book0 = await bookAt(AS_OF);

  // ---- who may create
  if (viewer) {
    await as(viewer.id);
    await refused("a viewer cannot create a count", `select acc_create_stock_count($1)`, [AS_OF], "Not authorized");
  }
  await as(OUTSIDER);
  await refused("someone outside the company cannot create a count", `select acc_create_stock_count($1)`, [AS_OF], "Not authorized");
  await as(admin.id);

  // ---- create, save, read back
  const a = (await one(`select acc_create_stock_count($1) as id`, [AS_OF])).id;
  const aRow = await countRow(a);
  check("a new count is a draft numbered SC-", aRow.status === "draft" && /^SC-\d{6}$/.test(aRow.count_number) && aRow.as_of_text === AS_OF);
  check("asking again returns the open count, not a second one",
    (await one(`select acc_create_stock_count('2099-07-31') as id`)).id === a &&
      (await one(`select count(*)::int as n from acc_stock_count where status in ('draft', 'pending_approval')`)).n === 1);
  check("a first count starts with no lines", (await one(`select count(*)::int as n from acc_stock_count_line where stock_count_id = $1`, [a])).n === 0);

  const target = book0 + 5000;
  check("saving returns the number of lines", (await save(a, AS_OF, sheet(target), "Verify memo")).n === 4);
  const saved = await all(`select * from acc_stock_count_line where stock_count_id = $1 order by line_order`, [a]);
  check("the lines read back in order, with the SKU, fractional quantity and sells-for kept",
    saved.length === 4 && saved.map((l) => l.line_order).join() === "1,2,3,4" &&
      saved[0].sku === "W-1" && Number(saved[0].sells_for_minor) === 999999 &&
      saved[1].name === "Sample gadget, large" && Number(saved[1].quantity) === 2.5 && saved[1].sells_for_minor === null,
    JSON.stringify(saved));
  check("the header keeps the memo", (await countRow(a)).memo === "Verify memo");
  check("saving again replaces the lines rather than adding to them",
    (await save(a, AS_OF, sheet(target), "Verify memo")).n === 4 &&
      (await one(`select count(*)::int as n from acc_stock_count_line where stock_count_id = $1`, [a])).n === 4);

  // ---- what saving refuses
  const SAVE = `select acc_save_stock_count($1, $2, null, $3::jsonb)`;
  const bad = (lines) => [a, AS_OF, JSON.stringify(lines)];
  await refused("a line without a name is refused", SAVE, bad([line("  ", 1, 1)]), "Line 1: a name is required");
  await refused("a negative quantity is refused", SAVE, bad([line("X", -1, 1)]), "Line 1: the quantity cannot be negative");
  await refused("a negative cost is refused", SAVE, bad([line("X", 1, 5), line("Y", 1, -1)]), "Line 2: the cost each cannot be negative");
  await refused("a negative sells-for is refused", SAVE, bad([line("X", 1, 1, { sells_for_minor: -5 })]), "sells for cannot be negative");
  await refused("a missing quantity is refused", SAVE, bad([{ name: "X", unit_cost_minor: 1 }]), "a quantity is required");
  await refused("more than 2,000 lines are refused", SAVE, bad(Array.from({ length: 2001 }, (_, i) => line(`L${i}`, 1, 1))), "at most 2,000 lines");
  await refused("a list that is not a list is refused", SAVE, [a, AS_OF, "{}"], "must be a list");
  await refused("an unknown count is refused", SAVE, [OUTSIDER, AS_OF, "[]"], "Stock count not found");
  check("a refused save leaves the lines as they were",
    (await one(`select count(*)::int as n from acc_stock_count_line where stock_count_id = $1`, [a])).n === 4);

  // ---- what posting refuses
  await asOwner(admin.id, () => client.query(`update acc_role_permission set allowed = false where role = 'admin' and permission_key = 'inventory.adjust'`));
  await refused("posting without the inventory.adjust permission is refused", POST, [a, inv, off], "do not have permission to adjust inventory");
  await asOwner(admin.id, () => client.query(`update acc_role_permission set allowed = true where role = 'admin' and permission_key = 'inventory.adjust'`));
  if (viewer) {
    await as(viewer.id);
    await refused("a viewer cannot post", POST, [a, inv, off], "Not authorized");
    await as(admin.id);
  }
  await refused("posting an unknown count is refused", POST, [OUTSIDER, inv, off], "Stock count not found");
  await refused("an account that is not an inventory account is refused", POST, [a, off, off], "not one of this company's inventory accounts");
  await refused("an offset that is not cost of sales is refused", POST, [a, inv, inv], "must be an active cost of sales account");

  await asOwner(admin.id, async () => {
    await client.query(
      `insert into acc_item (name, is_inventory, inventory_account_id, is_active) values ('Verify tracked item', true, $1, true)`,
      [inv],
    );
  }).catch((e) => check("a tracked item can be added for the check", false, e.message));
  await refused("a company that tracks items is refused", POST, [a, inv, off], "tracks stock item by item; adjust items on the Products & Services page");
  await asOwner(admin.id, () => client.query(`update acc_item set is_active = false where name = 'Verify tracked item'`));

  await save(a, AS_OF, sheet(book0));
  await refused("a zero difference is refused", POST, [a, inv, off], "The count already agrees with the books.");

  // a closed period: the check runs inside a savepoint, so the count keeps its date
  await client.query("savepoint closed");
  try {
    await asOwner(admin.id, () =>
      client.query(
        `insert into acc_accounting_period (fiscal_year, period_month, period_start, period_end, label, status)
         values (2099, 5, '2099-05-01', '2099-05-31', 'May 2099', 'closed')`,
      ),
    );
    await save(a, "2099-05-15", [line("Closed-period stock", 1, 1000)]);
    await client.query("savepoint closed_post");
    try {
      await client.query(POST, [a, inv, off]);
      check("a closed period is refused", false, "it was accepted");
    } catch (error) {
      check("a closed period is refused", error.message.includes("Accounting period for 2099-05-15 is closed"), error.message);
    }
    await client.query("rollback to savepoint closed_post");
  } finally {
    await client.query("rollback to savepoint closed");
  }
  check("…and the refusal left the count dated as before", (await countRow(a)).as_of_text === AS_OF);

  // ---- the book value is the base-currency ledger balance
  const ledgerBase = async (date) =>
    Number((await one(
      `select coalesce(sum(b.debit_base - b.credit_base), 0)::bigint as v
         from acc_ledger_balances(null, $1) b where b.account_id in (select acc_inventory_account_ids())`,
      [date],
    )).v);
  check("the book value agrees with acc_ledger_balances over the inventory accounts", (await ledgerBase(AS_OF)) === book0, `${book0} vs ${await ledgerBase(AS_OF)}`);
  // A line whose base amount differs from its own debit/credit, as a foreign-currency line does:
  // acc_post_entry balances debit against credit and takes amount_base_minor as given.
  await client.query("savepoint fx_line");
  try {
    await one(`select acc_post_entry('2099-06-02', 'Verify stock count: foreign-style line', 'manual', null, $1,
                 jsonb_build_array(
                   jsonb_build_object('account_id', $2::uuid, 'debit_minor', 1000, 'credit_minor', 0, 'amount_base_minor', 1700),
                   jsonb_build_object('account_id', $3::uuid, 'debit_minor', 0, 'credit_minor', 1000, 'amount_base_minor', 1700))) as id`,
      [base.code, inv, off]);
    const bookFx = await bookAt(AS_OF);
    check("a line with a different base amount moves the book value by its base amount", bookFx === book0 + 1700, `${bookFx} vs ${book0 + 1700}`);
    check("…and the ledger report agrees", (await ledgerBase(AS_OF)) === bookFx);
    await save(a, AS_OF, sheet(bookFx + 2500));
    await post(a);
    const fx = await countRow(a);
    check("posting uses the base amount: book value and difference are in base currency",
      Number(fx.book_minor) === book0 + 1700 && Number(fx.difference_minor) === 2500, JSON.stringify(fx));
  } finally {
    await client.query("rollback to savepoint fx_line");
  }
  check("…and the rolled-back post left the count a draft", (await countRow(a)).status === "draft");

  // ---- posting a surplus
  await save(a, AS_OF, sheet(target));
  const entryA = (await post(a)).id;
  const posted = await countRow(a);
  check("the count is posted, with its figures frozen",
    posted.status === "posted" && Number(posted.counted_minor) === target && Number(posted.book_minor) === book0 &&
      Number(posted.difference_minor) === 5000 && posted.inventory_account_id === inv && posted.offset_account_id === off &&
      posted.journal_entry_id === entryA && posted.posted_by === admin.id && posted.posted_at !== null,
    JSON.stringify(posted));
  const entry = await one(`select source_type::text as source, source_id, status::text as status, description from acc_journal_entry where id = $1`, [entryA]);
  check("the entry has source stock_count, points at the count and is posted",
    entry.source === "stock_count" && entry.source_id === a && entry.status === "posted" && entry.description.startsWith(`Stock count ${posted.count_number} as of 2099-06-30`),
    JSON.stringify(entry));
  const lines = await all(`select account_id, debit_minor::bigint as d, credit_minor::bigint as c from acc_journal_line where journal_entry_id = $1 order by line_order`, [entryA]);
  check("a surplus debits inventory and credits the offset by the difference",
    lines.length === 2 && lines[0].account_id === inv && Number(lines[0].d) === 5000 && lines[1].account_id === off && Number(lines[1].c) === 5000,
    JSON.stringify(lines));
  check("the entry is marked adjusting",
    (await one(`select count(*)::int as n from acc_adjusting_entry where journal_entry_id = $1`, [entryA])).n === 1);
  check("an audit row with action post is written",
    (await one(`select count(*)::int as n from acc_audit_log where table_name = 'acc_journal_entry' and record_id = $1 and action = 'post' and actor_id = $2`, [entryA, admin.id])).n === 1);
  check("the book value is now the counted value", (await bookAt(AS_OF)) === target);
  await refused("a posted count cannot be posted again", POST, [a, inv, off], "already posted");
  await refused("a posted count cannot be edited", SAVE, [a, AS_OF, "[]"], "Only a draft count can be edited");

  // ---- the next count starts from the last one, and posts a shortfall
  const b = (await one(`select acc_create_stock_count($1) as id`, [AS_OF])).id;
  const copied = await all(`select name, sku, quantity::float as q, unit_cost_minor::bigint as cost, sells_for_minor::bigint as sells from acc_stock_count_line where stock_count_id = $1 order by line_order`, [b]);
  check("a new count starts as a copy of the previous count's lines",
    copied.length === 4 && copied[0].name === "Sample widget" && copied[0].sku === "W-1" && Number(copied[0].sells) === 999999 && copied[1].q === 2.5,
    JSON.stringify(copied));
  await refused("an unchanged copy agrees with the books", POST, [b, inv, off], "The count already agrees with the books.");
  await save(b, AS_OF, sheet(target - 7000));
  const entryB = (await post(b)).id;
  const postedB = await countRow(b);
  check("a shortfall is posted with a negative difference and the book value it found",
    Number(postedB.difference_minor) === -7000 && Number(postedB.book_minor) === target && Number(postedB.counted_minor) === target - 7000);
  const linesB = await all(`select account_id, debit_minor::bigint as d, credit_minor::bigint as c from acc_journal_line where journal_entry_id = $1 order by line_order`, [entryB]);
  check("a shortfall debits the offset and credits inventory",
    linesB.length === 2 && linesB[0].account_id === off && Number(linesB[0].d) === 7000 && linesB[1].account_id === inv && Number(linesB[1].c) === 7000,
    JSON.stringify(linesB));
  check("the earlier count's figures did not move", Number((await countRow(a)).book_minor) === book0 && Number((await countRow(a)).difference_minor) === 5000);

  // ---- the approval policy
  await asOwner(admin.id, () =>
    client.query(`update acc_approval_policy set enabled = true, threshold_minor = 1000, require_segregation = false where action_key = 'inventory_adjustment'`),
  );
  const c = (await one(`select acc_create_stock_count($1) as id`, [AS_OF])).id;
  const bookC = await bookAt(AS_OF);
  await save(c, AS_OF, sheet(bookC + 3000));
  let guard = "";
  await client.query("savepoint guard");
  try {
    await client.query(POST, [c, inv, off]);
  } catch (error) {
    guard = error.message;
  }
  await client.query("rollback to savepoint guard");
  check("above the threshold, posting raises the approval guard", APPROVAL_GUARD.test(guard), guard);
  check("…and posts nothing", (await countRow(c)).status === "draft");

  const payload = { stock_count_id: c, inventory_account_id: inv, offset_account_id: off };
  const submit = async (id) =>
    (await one(`select acc_submit_for_approval('inventory_adjustment', 'Stock count', 3000, $1::jsonb, 'Verify') as id`, [JSON.stringify({ ...payload, stock_count_id: id })])).id;
  const reqC = await submit(c);
  const MARK = `select acc_mark_stock_count_pending($1, $2)`;
  const NOT_THIS = "not a pending request for this stock count";
  await refused("a request id that does not exist cannot be linked", MARK, [c, OUTSIDER], NOT_THIS);
  const reqOther = await submit(OUTSIDER);
  await refused("a request whose payload names another count cannot be linked", MARK, [c, reqOther], NOT_THIS);
  check("…and the count was not changed by the refusals", (await countRow(c)).status === "draft" && (await countRow(c)).approval_request_id === null);
  await refused("an unknown count cannot be marked pending", MARK, [OUTSIDER, reqC], "Stock count not found");
  if (viewer) {
    await as(viewer.id);
    await refused("a viewer cannot mark a count pending", MARK, [c, reqC], "Not authorized");
    await as(admin.id);
  }
  await refused("a posted count cannot be marked pending", MARK, [a, reqC], "Only a draft count can be sent for approval");
  await one(`select acc_mark_stock_count_pending($1, $2)`, [c, reqC]);
  const pending = await countRow(c);
  check("a submitted count waits for approval, linked to its request", pending.status === "pending_approval" && pending.approval_request_id === reqC);
  await refused("a count waiting for approval cannot be edited", SAVE, [c, AS_OF, "[]"], "Only a draft count can be edited");
  await refused("a count waiting for approval cannot be posted directly", POST, [c, inv, off], "waiting for approval");
  check("a count waiting for approval is still the open count",
    (await one(`select acc_create_stock_count('2099-08-31') as id`)).id === c);

  // the books move before the approval: the difference is worked out again at approval
  await shift("2099-06-15", 500);
  const approved = (await one(`select acc_approve_request($1, 'Verify') as id`, [reqC])).id;
  const postedC = await countRow(c);
  check("approving posts the count and returns its entry",
    postedC.status === "posted" && postedC.journal_entry_id === approved, JSON.stringify(postedC));
  check("the difference is recomputed at approval, against the books as they stand",
    Number(postedC.difference_minor) === 2500 && Number(postedC.book_minor) === bookC + 500,
    `${postedC.difference_minor} / ${postedC.book_minor}`);
  const reqRow = await one(`select status::text as status, result_id from acc_approval_request where id = $1`, [reqC]);
  check("the request is approved with the entry as its result", reqRow.status === "approved" && reqRow.result_id === approved);

  // rejected, and cancelled: the count goes back to draft and can be edited again
  const d = (await one(`select acc_create_stock_count($1) as id`, [AS_OF])).id;
  await save(d, AS_OF, sheet((await bookAt(AS_OF)) + 4000));
  const reqD = await submit(d);
  await one(`select acc_mark_stock_count_pending($1, $2)`, [d, reqD]);
  await one(`select acc_reject_request($1, 'Not now')`, [reqD]);
  const rejected = await countRow(d);
  check("a rejected request returns the count to draft, unlinked", rejected.status === "draft" && rejected.approval_request_id === null, JSON.stringify(rejected));
  check("…and the draft can be edited again", (await save(d, AS_OF, sheet(1000000))).n === 4);
  const reqD2 = await submit(d);
  await one(`select acc_mark_stock_count_pending($1, $2)`, [d, reqD2]);
  await one(`select acc_cancel_request($1)`, [reqD2]);
  check("a cancelled request returns the count to draft too", (await countRow(d)).status === "draft");
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
      const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        for (const statement of statements) await client.query(statement);
        console.log("  (0139 applied inside the transaction, never committed)");
      }
      for (const statement of statements) await client.query(statement);
      check("applying 0139 a second time is harmless", true);

      await structure(schema);

      if (schema === SAMPLE) {
        const hasValue = (await client.query(
          `select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
            where n.nspname = $1 and t.typname = 'acc_journal_source' and e.enumlabel = 'stock_count'`,
          [schema],
        )).rowCount > 0;
        if (hasValue) await behaviour();
        else console.log(`  0138 not applied in ${schema}: posting checks skipped`);
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
