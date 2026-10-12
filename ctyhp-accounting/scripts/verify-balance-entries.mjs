/**
 * Behavioural verification of migration 0140 (removing a balance posted as
 * payments) on every company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0140 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing has to be live and
 * nothing is left behind.
 *
 *  - In every schema: structure only. Both functions exist, are security
 *    definer with a fixed search_path, and are closed to anon.
 *  - In co_pc (the sample company) only: the behaviour. A small balance series
 *    is posted on a bank account and removed, then every refusal is exercised.
 *    All dates are in 2099 so no real period or entry is touched.
 *
 * Prints counts and pass/fail lines only.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-balance-entries.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0140_remove_balance_entries.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const REASON = "Verify: a balance column read as payments";

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
/** Runs `sql`, expecting a refusal holding `expect`; the savepoint puts the books back as they were. */
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
async function structure() {
  for (const fn of ["acc_balance_entry_blockers(uuid[])", "acc_remove_balance_entries(uuid,uuid[],text)"]) {
    const f = await one(
      `select p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
              has_function_privilege('service_role', p.oid, 'execute') as svc_exec
         from pg_proc p where p.oid = to_regprocedure($1)`,
      [fn],
    );
    check(`${fn} exists, is security definer with search_path`,
      Boolean(f) && f.definer && (f.config ?? []).some((c) => c.startsWith("search_path=")), JSON.stringify(f));
    check(`${fn} is closed to anon, open to signed-in users and the service role`,
      Boolean(f) && !f.anon_exec && f.auth_exec && f.svc_exec, JSON.stringify(f));
    const pub = await one(
      `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where p.oid = to_regprocedure($1) and a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub`,
      [fn],
    );
    check(`${fn} is not executable by public`, pub.pub === false);
  }
}

// ---------------------------------------------------------------------------
// Behaviour, in the sample company only
// ---------------------------------------------------------------------------
async function behaviour() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  const base = await one(`select code from acc_currency where is_base limit 1`);
  const bank = await one(`select id, account_id from acc_bank_account order by created_at limit 1`);
  if (!admin || !base || !bank) {
    console.log("  (no active administrator, base currency or bank account; behaviour checks skipped)");
    return;
  }
  const others = await all(
    `select id from acc_account where status = 'active' and is_posting_account and id <> $1 order by account_code limit 2`,
    [bank.account_id],
  );
  if (others.length < 2) {
    console.log("  (fewer than two other posting accounts; behaviour checks skipped)");
    return;
  }
  const [other, other2] = [others[0].id, others[1].id];
  await client.query("set local role authenticated");
  await as(admin.id);

  const ledger = async () =>
    Number((await one(
      `select coalesce(sum(b.debit_base - b.credit_base), 0)::bigint as v
         from acc_ledger_balances(null, '2099-12-31') b where b.account_id = $1`,
      [bank.account_id],
    )).v);
  const post = (date, source, from, to, amount, description = "Verify balance entry") =>
    one(
      `select acc_post_entry($1, $2, $3::acc_journal_source, null, $4,
                             jsonb_build_array(
                               jsonb_build_object('account_id', $5::uuid, 'debit_minor', $7::bigint, 'credit_minor', 0, 'amount_base_minor', $7::bigint),
                               jsonb_build_object('account_id', $6::uuid, 'debit_minor', 0, 'credit_minor', $7::bigint, 'amount_base_minor', $7::bigint))) as id`,
      [date, description, source, base.code, from, to, amount],
    ).then((r) => r.id);
  /** A bank line that categorising turns into a `bank` entry; returns { txn, entry }. */
  let seq = 0;
  const bankLine = async (date, amount, batchId = null) => {
    seq += 1;
    const txn = await asOwner(admin.id, async () =>
      (await one(
        `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, transaction_batch_id)
         values ($1, $2, 'Verify balance entry', $3, $4, $5) returning id`,
        [bank.id, date, amount, `verify-balance-${seq}-${Date.now()}`, batchId],
      )).id);
    await one(`select acc_categorise_bank_transaction($1, $2)`, [txn, other]);
    const entry = (await one(
      `select l.journal_entry_id as id from acc_reconciliation r join acc_journal_line l on l.id = r.journal_line_id
        where r.bank_transaction_id = $1`,
      [txn],
    )).id;
    return { txn, entry };
  };
  const blockersOf = (ids) => all(`select * from acc_balance_entry_blockers($1::uuid[])`, [ids]);
  const REMOVE = `select acc_remove_balance_entries($1, $2::uuid[], $3) as r`;
  const remove = (ids, reason = REASON) => one(REMOVE, [bank.id, ids, reason]).then((x) => x.r);
  const status = async (id) => (await one(`select status::text as s from acc_journal_entry where id = $1`, [id])).s;

  const startBalance = await ledger();

  // ---- the series: three manual entries, two bank lines (one from an import batch)
  const manual = [
    await post("2099-03-10", "manual", bank.account_id, other, 10000),
    await post("2099-03-17", "manual", bank.account_id, other, 20000),
    await post("2099-03-24", "opening_balance", bank.account_id, other, 30000),
  ];
  const batch = await asOwner(admin.id, async () =>
    (await one(
      `insert into acc_import_batch (source, mode, file_name, sha256, entry_count, line_count, total_minor)
       values ('wave_ledger', 'balances', 'verify.csv', repeat('a', 64), 0, 0, 0) returning id`,
    )).id);
  const b1 = await bankLine("2099-03-31", 5000);
  const b2 = await bankLine("2099-03-31", 7000, batch);
  const untouched = await asOwner(admin.id, async () =>
    (await one(
      `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, transaction_batch_id)
       values ($1, '2099-03-31', 'Verify untouched', 9000, $2, $3) returning id`,
      [bank.id, `verify-untouched-${Date.now()}`, batch],
    )).id);
  const series = [...manual, b1.entry, b2.entry];
  check("the series moves the account by its total", (await ledger()) === startBalance + 72000, `${(await ledger()) - startBalance}`);

  // ---- nothing blocks it, and a mixed request is refused whole
  check("no blocker comes back for a clean series", (await blockersOf(series)).length === 0);
  const absent = "00000000-0000-0000-0000-0000000000aa";
  const withUnknown = await blockersOf([...series, absent]);
  check("an unknown id is reported, and only that one",
    withUnknown.length === 1 && withUnknown[0].entry_id === absent && withUnknown[0].entry_number === null, JSON.stringify(withUnknown));

  // ---- removing the series
  const result = await remove(series);
  check("the answer counts what was removed, reversed and voided",
    result.removed === 5 && result.reversed === 3 && result.voided === 2 && Number(result.total_minor) === 72000, JSON.stringify(result));
  const links = await all(
    `select k.original_entry_id, k.reason, o.entry_date::text as od, r.entry_date::text as rd, r.status::text as rs,
            r.source_type::text as rsrc, r.source_id, o.source_type::text as osrc, o.status::text as os
       from acc_journal_reversal_link k
       join acc_journal_entry o on o.id = k.original_entry_id
       join acc_journal_entry r on r.id = k.reversal_entry_id
      where k.original_entry_id = any($1::uuid[])`,
    [manual],
  );
  check("each manual entry has a posted reversal on its own date, marked as acc_reverse_entry marks it",
    links.length === 3 && links.every((l) => l.od === l.rd && l.rs === "posted" && l.rsrc === l.osrc && l.os === "posted" && l.reason === REASON),
    JSON.stringify(links.map((l) => [l.od, l.rd, l.rs])));
  const swapped = await one(
    `select count(*)::int as n
       from acc_journal_reversal_link k
       join acc_journal_line ol on ol.journal_entry_id = k.original_entry_id
       join acc_journal_line rl on rl.journal_entry_id = k.reversal_entry_id and rl.account_id = ol.account_id
      where k.original_entry_id = any($1::uuid[]) and rl.debit_minor = ol.credit_minor and rl.credit_minor = ol.debit_minor`,
    [manual],
  );
  check("every reversal line is the original with debit and credit swapped", swapped.n === 6, `${swapped.n}`);
  check("the bank entries are void", (await status(b1.entry)) === "void" && (await status(b2.entry)) === "void");
  const gone = await one(`select count(*)::int as n from acc_bank_transaction where id = any($1::uuid[])`, [[b1.txn, b2.txn]]);
  check("their bank lines are gone", gone.n === 0);
  check("the rest of the import batch is untouched",
    (await one(`select count(*)::int as n from acc_bank_transaction where id = $1 and transaction_batch_id = $2`, [untouched, batch])).n === 1);
  check("the originals of the manual entries are still in the books",
    (await one(`select count(*)::int as n from acc_journal_entry where id = any($1::uuid[])`, [series])).n === 5);
  check("the account's ledger balance is back to where it started", (await ledger()) === startBalance, `${(await ledger()) - startBalance}`);
  const logs = await all(
    `select before_json from acc_audit_log where action = 'remove_balance_entries' and record_id = $1`,
    [bank.id],
  );
  check("one log row is written, with the count and the total",
    logs.length === 1 && logs[0].before_json.count === 5 && Number(logs[0].before_json.total_minor) === 72000 &&
      logs[0].before_json.payee === "Verify balance entry", JSON.stringify(logs[0]?.before_json ? Object.keys(logs[0].before_json) : logs));
  check("removing the same series again lists every entry as blocked", (await blockersOf(series)).length === 5);

  // ---- refusals
  console.log("  refusals");
  const manualOn = (date) => post(date, "manual", bank.account_id, other, 1000);

  {
    const e = await manualOn("2099-04-02");
    const line = (await one(`select id from acc_journal_line where journal_entry_id = $1 and account_id = $2`, [e, bank.account_id])).id;
    await asOwner(admin.id, async () => {
      const s = (await one(
        `insert into acc_statement_reconciliation (bank_account_id, statement_ending_date, statement_ending_balance_minor, status, completed_at)
         values ($1, '2099-04-30', 0, 'completed', now()) returning id`, [bank.id])).id;
      await client.query(`insert into acc_reconciliation_line (reconciliation_id, journal_line_id) values ($1, $2)`, [s, line]);
    });
    const b = await blockersOf([e]);
    check("a line ticked in a completed reconciliation names the statement date", /statement dated Apr 30, 2099/.test(b[0]?.reason ?? ""), b[0]?.reason);
    await refused("…and removing it is refused", REMOVE, [bank.id, [e], REASON], /1 of these entries cannot be removed: .*Apr 30, 2099/);
  }
  {
    const e = await manualOn("2099-05-10");
    await asOwner(admin.id, () =>
      client.query(
        `insert into acc_accounting_period (fiscal_year, period_month, period_start, period_end, label, status)
         values (2099, 5, '2099-05-01', '2099-05-31', 'Verify May 2099', 'closed')`,
      ));
    const b = await blockersOf([e]);
    check("an entry in a closed period is blocked", /closed period/.test(b[0]?.reason ?? ""), b[0]?.reason);
    await refused("…and removing it is refused", REMOVE, [bank.id, [e], REASON], /closed period/);
  }
  {
    const e = await post("2099-06-10", "payment", bank.account_id, other, 1000);
    const b = await blockersOf([e]);
    check("a document-owned entry says which document to void", /belongs to payment.*void the payment instead/.test(b[0]?.reason ?? ""), b[0]?.reason);
    await refused("…and removing it is refused", REMOVE, [bank.id, [e], REASON], /belongs to payment/);
  }
  {
    const e = await manualOn("2099-06-12");
    await remove([e]);
    const b = await blockersOf([e]);
    check("an entry already reversed is blocked", /already been reversed/.test(b[0]?.reason ?? ""), b[0]?.reason);
    await refused("…and removing it again is refused", REMOVE, [bank.id, [e], REASON], /already been reversed/);
    const rev = (await one(`select reversal_entry_id as id from acc_journal_reversal_link where original_entry_id = $1`, [e])).id;
    await refused("a reversal cannot be removed either", REMOVE, [bank.id, [rev], REASON], /itself a reversal/);
  }
  {
    const { txn, entry } = await bankLine("2099-06-14", 3000);
    await asOwner(admin.id, () =>
      client.query(`insert into acc_reconciliation (bank_transaction_id, status, confidence) values ($1, 'approved', 1)`, [txn]));
    const b = await blockersOf([entry]);
    check("a bank line settled against a document is blocked", /settled against an invoice or bill/.test(b[0]?.reason ?? ""), b[0]?.reason);
    await refused("…and removing it is refused", REMOVE, [bank.id, [entry], REASON], /settled against an invoice or bill/);
  }
  {
    const e = await manualOn("2099-06-16");
    const blockedDoc = await post("2099-06-17", "payment", bank.account_id, other, 1000);
    const before = await ledger();
    await refused("one blocked entry stops the whole request", REMOVE, [bank.id, [e, blockedDoc], REASON], /1 of these entries cannot be removed/);
    check("…and the good entry is untouched", (await ledger()) === before && (await status(e)) === "posted");
    await refused("two blocked entries are both listed in one message",
      REMOVE, [bank.id, [blockedDoc, absent], REASON], /2 of these entries cannot be removed: .*belongs to payment.*is not in the books/);
  }
  {
    const e = await manualOn("2099-06-18");
    await refused("an empty reason is refused", REMOVE, [bank.id, [e], "   "], "A reason is required");
    await refused("an empty list is refused", REMOVE, [bank.id, [], REASON], "Choose at least one entry");
    await refused("a repeated id is refused", REMOVE, [bank.id, [e, e], REASON], "more than once");
    await refused("an unknown bank account is refused", REMOVE, [OUTSIDER, [e], REASON], "Bank account not found");
    const elsewhere = await post("2099-06-19", "manual", other, other2, 1000);
    await refused("an entry that is not on that account is refused", REMOVE, [bank.id, [e, elsewhere], REASON], /have no line on/);
    check("…and nothing was reversed", (await status(e)) === "posted" && (await status(elsewhere)) === "posted");
    // A viewer and a staff role without the posting permission, made out of the administrator inside
    // this rolled-back transaction when the company has no such user.
    await client.query("savepoint as_viewer");
    await asOwner(admin.id, () => client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]));
    await refused("a viewer cannot remove", REMOVE, [bank.id, [e], REASON], "Not authorized");
    await refused("a viewer cannot ask what blocks", `select * from acc_balance_entry_blockers($1::uuid[])`, [[e]], "Not authorized");
    await client.query("rollback to savepoint as_viewer");
    await client.query("savepoint no_post");
    await asOwner(admin.id, () =>
      client.query(
        `update acc_role_permission set allowed = false
          where permission_key = 'journal.post' and role = (select role from acc_app_user where id = $1)`,
        [admin.id],
      ));
    await refused("staff without the journal-posting permission cannot remove", REMOVE, [bank.id, [e], REASON], "do not have permission");
    await client.query("rollback to savepoint no_post");
    await as(OUTSIDER);
    await refused("an outsider cannot remove", REMOVE, [bank.id, [e], REASON], "Not authorized");
    await refused("an outsider cannot ask what blocks", `select * from acc_balance_entry_blockers($1::uuid[])`, [[e]], "Not authorized");
    await as(admin.id);
  }
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
      for (const statement of statements) await client.query(statement);
      console.log("  (0140 applied inside the transaction, never committed)");
      for (const statement of statements) await client.query(statement);
      check("applying 0140 a second time is harmless", true);

      await structure();
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
