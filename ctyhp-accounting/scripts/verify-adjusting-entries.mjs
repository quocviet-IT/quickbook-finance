/**
 * Behavioural verification of adjusting entries (migration 0124).
 *
 * Every scenario runs inside its own transaction and is ROLLED BACK. When the
 * migration has not been applied yet, each scenario applies it first, inside
 * that same transaction — so this proves the migration against the real
 * database before it is applied for real, and leaves nothing behind either way.
 *
 * Run: node --env-file=.env.local scripts/verify-adjusting-entries.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const MIGRATION = readFileSync(
  new URL("../supabase/migrations/0124_adjusting_entries.sql", import.meta.url),
  "utf8",
);

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const ADMIN =
  process.env.ADMIN_USER_ID ??
  (
    await client.query(
      `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
    )
  ).rows[0]?.id;
if (!ADMIN) {
  console.error("No active admin to authenticate as; set ADMIN_USER_ID.");
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

async function as(userId) {
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

async function scenario(name, body) {
  console.log(`\n== ${name}`);
  await client.query("begin");
  try {
    const applied = (await one(`select to_regclass('acc_adjusting_entry') is not null as ok`)).ok;
    if (!applied) await client.query(MIGRATION);
    await as(ADMIN);
    await body();
  } catch (error) {
    failed++;
    console.log(`  FAIL  scenario threw — ${error.message}`);
  } finally {
    await client.query("rollback");
  }
}

/** Runs a statement expected to fail and returns its message, without aborting the transaction. */
async function refusal(sql, params = []) {
  await client.query("savepoint expect_refusal");
  try {
    await client.query(sql, params);
    await client.query("release savepoint expect_refusal");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint expect_refusal");
    return error.message;
  }
}

/** Every journal entry and line, reduced to two values that move if any row does. */
async function ledgerFingerprint() {
  return one(`
    select
      (select md5(coalesce(string_agg(e.id::text || '|' || e.status || '|' || e.entry_date || '|' ||
                                      coalesce(e.description, ''), ',' order by e.id), ''))
         from acc_journal_entry e) as entries,
      (select md5(coalesce(string_agg(l.id::text || '|' || l.account_id || '|' || l.debit_minor || '|' ||
                                      l.credit_minor || '|' || l.amount_base_minor, ',' order by l.id), ''))
         from acc_journal_line l) as lines`);
}

/** A small balanced entry: an expense accrued against a liability. */
async function postProbe({ sourceType = "manual", description = "Adjusting-entry probe" } = {}) {
  const a = await one(`
    select
      (select id from acc_account where account_type = 'expense' and is_posting_account
         and status = 'active' order by account_code limit 1) as expense,
      (select id from acc_account where account_type = 'current_liability' and is_posting_account
         and status = 'active' order by account_code limit 1) as liability,
      (select code from acc_currency where is_base limit 1) as currency`);
  const lines = [
    { account_id: a.expense, debit_minor: 12_345, credit_minor: 0, amount_base_minor: 12_345 },
    { account_id: a.liability, debit_minor: 0, credit_minor: 12_345, amount_base_minor: 12_345 },
  ];
  return (
    await one(
      `select acc_post_entry(current_date, $1, $2::acc_journal_source, null, $3, $4::jsonb) as id`,
      [description, sourceType, a.currency, JSON.stringify(lines)],
    )
  ).id;
}

const markOf = (id) => one(`select note, marked_by from acc_adjusting_entry where journal_entry_id = $1`, [id]);

await scenario("marking and unmarking an entry changes no ledger row", async () => {
  const id = await postProbe();
  const before = await ledgerFingerprint();

  await client.query(`select acc_mark_adjusting($1, $2)`, [id, "Accrued audit fee"]);
  const mark = await markOf(id);
  check("the entry is marked, with its note", mark?.note === "Accrued audit fee", JSON.stringify(mark));
  check("the mark names who made it", mark?.marked_by === ADMIN, JSON.stringify(mark));

  await client.query(`select acc_mark_adjusting($1, $2)`, [id, "Accrued audit fee, year end"]);
  const again = await one(
    `select count(*)::int as n, max(note) as note from acc_adjusting_entry where journal_entry_id = $1`,
    [id],
  );
  check("marking again replaces only the note", again.n === 1 && again.note === "Accrued audit fee, year end", JSON.stringify(again));

  await client.query(`select acc_unmark_adjusting($1)`, [id]);
  check("unmarking removes the mark and its note", !(await markOf(id)));

  const audit = (
    await client.query(
      `select action, before_json from acc_audit_log where table_name = 'acc_adjusting_entry' and record_id = $1`,
      [id],
    )
  ).rows;
  check(
    "each change wrote one audit row",
    JSON.stringify(audit.map((r) => r.action).sort()) ===
      JSON.stringify(["edit_adjusting_note", "mark_adjusting", "unmark_adjusting"]),
    JSON.stringify(audit.map((r) => r.action)),
  );
  const unmarked = audit.find((r) => r.action === "unmark_adjusting");
  check("the unmark audit keeps the note it removed", unmarked?.before_json?.note === "Accrued audit fee, year end");

  const after = await ledgerFingerprint();
  check("no journal entry or line changed", after.entries === before.entries && after.lines === before.lines);
});

await scenario("a blank note is kept as none, and a long one is refused", async () => {
  const id = await postProbe();
  await client.query(`select acc_mark_adjusting($1, $2)`, [id, "   "]);
  check("a blank note is stored as none", (await markOf(id))?.note === null);
  const long = await refusal(`select acc_mark_adjusting($1, $2)`, [id, "x".repeat(501)]);
  check("a note over 500 characters is refused", /500/.test(long ?? ""), long ?? "accepted");
});

await scenario("only someone who may post a journal may mark one", async () => {
  const id = await postProbe();
  await as("00000000-0000-4000-8000-000000000000");
  const marking = await refusal(`select acc_mark_adjusting($1, null)`, [id]);
  const unmarking = await refusal(`select acc_unmark_adjusting($1)`, [id]);
  await as(ADMIN);
  check("marking is refused", /permission/i.test(marking ?? ""), marking ?? "accepted");
  check("unmarking is refused", /permission/i.test(unmarking ?? ""), unmarking ?? "accepted");
});

await scenario("a voided entry cannot be marked", async () => {
  const id = await postProbe();
  await client.query(`update acc_journal_entry set status = 'void' where id = $1`, [id]);
  const text = await refusal(`select acc_mark_adjusting($1, null)`, [id]);
  check("refused, naming why", /posted/i.test(text ?? ""), text ?? "accepted");
});

await scenario("a closed period asks first, and allows once confirmed", async () => {
  const id = await postProbe();
  const month = await one(`
    select to_char(date_trunc('month', current_date), 'YYYY-MM-DD') as first_day,
           to_char(date_trunc('month', current_date) + interval '1 month' - interval '1 day', 'YYYY-MM-DD') as last_day`);
  await client.query(
    `insert into acc_accounting_period (fiscal_year, period_month, period_start, period_end, label, status)
     values (extract(year from $1::date)::int, extract(month from $1::date)::int, $1::date, $2::date,
             to_char($1::date, 'YYYY-MM'), 'closed')
     on conflict (period_start) do update set status = 'closed'`,
    [month.first_day, month.last_day],
  );

  const asked = await refusal(`select acc_mark_adjusting($1, $2)`, [id, "Year-end accrual"]);
  check(
    "marking asks first, naming the entry's date and the end of the closed period",
    new RegExp(`^closed_period:\\d{4}-\\d{2}-\\d{2}:${month.last_day}$`).test(asked ?? ""),
    asked ?? "accepted",
  );
  check("nothing is marked while it asks", !(await markOf(id)));

  await client.query(`select acc_mark_adjusting($1, $2, true)`, [id, "Year-end accrual"]);
  const audit = await one(
    `select after_json from acc_audit_log
      where table_name = 'acc_adjusting_entry' and record_id = $1 and action = 'mark_adjusting'`,
    [id],
  );
  check("confirmed, it marks, and the audit says the period was closed", audit?.after_json?.closed_period === true, JSON.stringify(audit));

  await client.query(`select acc_mark_adjusting($1, $2)`, [id, "Year-end accrual, revised"]);
  check("changing the note does not ask again", (await markOf(id))?.note === "Year-end accrual, revised");

  const unmarkAsked = await refusal(`select acc_unmark_adjusting($1)`, [id]);
  check("unmarking asks first", /^closed_period:/.test(unmarkAsked ?? ""), unmarkAsked ?? "accepted");
  await client.query(`select acc_unmark_adjusting($1, true)`, [id]);
  check("confirmed, it unmarks", !(await markOf(id)));
});

await scenario("depreciation is marked as it posts, and nothing else is", async () => {
  const dep = await postProbe({ sourceType: "depreciation", description: "Depreciation PROBE-1 - probe month" });
  const mark = await markOf(dep);
  check(
    "a depreciation entry is marked, with its description as the note, by nobody",
    mark?.note === "Depreciation PROBE-1 - probe month" && mark.marked_by === null,
    JSON.stringify(mark),
  );
  const manual = await postProbe();
  check("a manual entry is not marked", !(await markOf(manual)));
});

await scenario("every depreciation entry already in the books is marked", async () => {
  const missing = await one(`
    select count(*)::int as n from acc_journal_entry e
     where e.source_type = 'depreciation' and e.status = 'posted'
       and not exists (select 1 from acc_adjusting_entry a where a.journal_entry_id = e.id)`);
  check("no posted depreciation entry is left unmarked", missing.n === 0, `${missing.n} unmarked`);
});

await scenario("an application session can read the marks and cannot write them", async () => {
  const id = await postProbe();
  await client.query("set local role authenticated");
  const write = await refusal(`insert into acc_adjusting_entry (journal_entry_id, note) values ($1, 'direct')`, [id]);
  const read = await refusal(`select count(*) from acc_adjusting_entry`);
  await client.query("reset role");
  check("a direct insert is refused", /row-level security|permission denied/i.test(write ?? ""), write ?? "accepted");
  check("reading is allowed", read === null, read ?? "");
});

console.log(`\n${passed} passed, ${failed} failed`);
await client.end();
process.exit(failed === 0 ? 0 : 1);
