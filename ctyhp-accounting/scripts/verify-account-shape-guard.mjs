/**
 * Behavioural verification of migration 0195 on every company's books: an
 * account with postings keeps its type and its code, its name changes at any
 * time and is read everywhere at once, and the audit log keeps the old and the
 * new name.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0195 has not been applied it is applied first, inside that transaction.
 * Only a company marked is_sample has an entry posted and an account renamed
 * in it. Every other company is checked by trying, inside a savepoint, to
 * change the type of one of its own accounts with postings: the change must be
 * refused, and the savepoint leaves the row as it was.
 *
 * Run: node --env-file=.env.local scripts/verify-account-shape-guard.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0195_account_shape_guard.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 5 * 60 * 1000);
await client.connect();

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const as = (userId) =>
  client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: "authenticated" })]);
async function refusal(sql, params) {
  await client.query("savepoint trial");
  try {
    await client.query(sql, params);
    await client.query("release savepoint trial");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint trial");
    return error.message;
  }
}
const SAVE = `select acc_save_account($1, $2::jsonb)`;

/** A company people work in: one of its accounts with postings refuses a new type. */
async function readOnlyChecks(admin) {
  const account = await one(
    `select a.id, a.name, a.account_type::text as type from acc_account a
      where exists (select 1 from acc_journal_line l where l.account_id = a.id)
      order by a.account_code limit 1`,
  );
  if (!account) {
    console.log("  (no account with postings)");
    return;
  }
  await client.query("set local role authenticated");
  await as(admin.id);
  const other = account.type === "expense" ? "other_expense" : "expense";
  const why = await refusal(SAVE, [account.id, JSON.stringify({ account_type: other })]);
  check("changing the type of one of its accounts with postings is refused", /has postings, so its type stays/.test(why ?? ""), why ?? "not refused");
  const after = await one(`select account_type::text as type from acc_account where id = $1`, [account.id]);
  check("and the account is as it was", after.type === account.type);
}

/** A sample company: rename an account with postings, and try its type and code. */
async function fullChecks(admin, base) {
  const account = async (code, name, type) =>
    (await one(
      `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
       values ($1, $2, $3, $4, true) returning id`,
      [code, name, type, base.code],
    )).id;
  const gl = await account("ZZ-VERIFY-SG-B", "Verify shape bank", "bank");
  const supplies = await account("ZZ-VERIFY-SG-X", "Verify shape supplies", "expense");
  const unused = await account("ZZ-VERIFY-SG-U", "Verify shape unused", "expense");
  await client.query("set local role authenticated");
  await as(admin.id);
  await one(`select acc_post_manual_journal('2026-07-15', 'Verify supplies', null, $1, $2::jsonb) as id`, [
    base.code,
    JSON.stringify([
      { account_id: supplies, debit_minor: 2750, credit_minor: 0 },
      { account_id: gl, debit_minor: 0, credit_minor: 2750 },
    ]),
  ]);
  const balance = async (id) =>
    Number((await one(
      `select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint as n
         from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
        where l.account_id = $1 and e.status = 'posted'`,
      [id],
    )).n);
  const before = await balance(supplies);

  check("an account with postings is renamed", (await refusal(SAVE, [supplies, JSON.stringify({ name: "Verify office supplies" })])) === null);
  const row = await one(`select id, account_code, name from acc_account where id = $1`, [supplies]);
  check("its code and its id are unchanged", row.id === supplies && row.account_code === "ZZ-VERIFY-SG-X" && row.name === "Verify office supplies");
  check("and no balance moved by a cent", (await balance(supplies)) === before);
  const ledger = await one(
    `select a.name from acc_journal_line l join acc_account a on a.id = l.account_id
      join acc_journal_entry e on e.id = l.journal_entry_id
     where e.description = 'Verify supplies' and l.account_id = $1`,
    [supplies],
  );
  check("the journal reads the new name", ledger?.name === "Verify office supplies");
  const audit = await one(
    `select before_json ->> 'name' as was, after_json ->> 'name' as now, actor_id
       from acc_audit_log where table_name = 'acc_account' and record_id = $1 and action = 'update'
        and after_json ->> 'name' = 'Verify office supplies'`,
    [supplies],
  );
  check("the audit log keeps the old and the new name, and who renamed it", audit?.was === "Verify shape supplies" && audit?.actor_id === admin.id, JSON.stringify(audit));

  const typed = await refusal(SAVE, [supplies, JSON.stringify({ account_type: "other_expense" })]);
  check("its type is refused, in words that say why", /Verify office supplies has postings, so its type stays expense/.test(typed ?? ""), typed ?? "not refused");
  const coded = await refusal(SAVE, [supplies, JSON.stringify({ account_code: "ZZ-VERIFY-SG-Y" })]);
  check("its code is refused by the save function", /cannot be saved here: account_code/.test(coded ?? ""), coded ?? "not refused");
  await client.query("reset role");
  const direct = await refusal(`update acc_account set account_code = 'ZZ-VERIFY-SG-Y' where id = $1`, [supplies]);
  check("and by the table itself, whoever writes it", /has postings, so its code stays ZZ-VERIFY-SG-X/.test(direct ?? ""), direct ?? "not refused");
  await client.query("set local role authenticated");
  await as(admin.id);
  check("an account nothing was posted to can still change its type", (await refusal(SAVE, [unused, JSON.stringify({ account_type: "other_expense" })])) === null);
}

const { rows: companies } = await client.query(
  `select schema_name, is_sample from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema, is_sample: sample } of companies) {
    console.log(`\n${schema}${sample ? " (sample: every case)" : " (refuse only)"}`);
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '30s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        for (const statement of statements) await client.query(statement);
        console.log("  (0195 applied inside the transaction, never committed)");
      }
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }
      if (sample) await fullChecks(admin, base);
      else await readOnlyChecks(admin);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  the run threw — ${error.message}`);
    } finally {
      await client.query("rollback");
    }
  }
} finally {
  clearTimeout(killer);
  await client.end().catch(() => {});
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
