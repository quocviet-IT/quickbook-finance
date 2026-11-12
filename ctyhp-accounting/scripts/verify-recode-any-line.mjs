/**
 * Behavioural verification of migration 0194 on every company's books: a line
 * coded in Bank Transactions can be moved to another account inside a month
 * already reconciled, the reconciliation still agrees and stays completed, the
 * audit log keeps the account before and after, and Change, which would void
 * the entry, is still refused there.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0194 has not been applied it is applied first, inside that transaction.
 * Only a company marked is_sample has entries posted in it: posting takes the
 * company's next entry number and holds it until the transaction ends. In
 * every other company the run compares what acc_bank_recodes says about its
 * own recodes before and after 0194: the same rows, every one.
 *
 * Run: node --env-file=.env.local scripts/verify-recode-any-line.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0194_recode_any_bank_line.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";

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
const all = async (sql, params = []) => (await client.query(sql, params)).rows;
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
const refused = async (label, sql, params, pattern) => {
  const why = await refusal(sql, params);
  check(label, why !== null && pattern.test(why), why ?? "not refused");
};
const RECODE = `select acc_recode_bank_transaction($1, $2) as r`;
const recodes = () =>
  all(`select bank_transaction_id, original_entry_id, recode_entry_id, account_id from acc_bank_recodes(null)
        order by bank_transaction_id, recode_entry_id`);

/** A sample company: every case, on a month reconciled here and rolled back. */
async function fullChecks(admin, base) {
  const account = async (code, name, type, extra = "") =>
    (await one(
      `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account${extra ? ", status" : ""})
       values ($1, $2, $3, $4, true${extra ? ", $5" : ""}) returning id`,
      extra ? [code, name, type, base.code, extra] : [code, name, type, base.code],
    )).id;
  const gl = await account("ZZ-VERIFY-RC-B", "Verify recode bank", "bank");
  const otherBank = await account("ZZ-VERIFY-RC-B2", "Verify recode other bank", "bank");
  const supplies = await account("ZZ-VERIFY-RC-X1", "Verify recode supplies", "expense");
  const rent = await account("ZZ-VERIFY-RC-X2", "Verify recode rent", "expense");
  const travel = await account("ZZ-VERIFY-RC-X3", "Verify recode travel", "expense");
  const retired = await account("ZZ-VERIFY-RC-X4", "Verify recode retired", "expense", "inactive");
  const sales = await account("ZZ-VERIFY-RC-I", "Verify recode sales", "income");
  const bank = (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`, [gl, base.code])).id;
  const newLine = async (tag, amount) =>
    (await one(
      `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, status, source)
       values ($1, '2026-07-15', $2, $3, $4, 'unmatched', 'file_upload') returning id`,
      [bank, `Recode probe ${tag}`, amount, createHash("sha256").update(`0194:${tag}`).digest("hex")],
    )).id;
  const out = await newLine("out", -12500);
  const inLine = await newLine("in", 8000);
  const asAdmin = async () => {
    await client.query("set local role authenticated");
    await as(admin.id);
  };
  await asAdmin();
  const coded = (await one(`select acc_categorise_bank_transaction($1, $2) as r`, [out, supplies])).r;
  const codedIn = (await one(`select acc_categorise_bank_transaction($1, $2) as r`, [inLine, sales])).r;
  const bankLine = (await one(`select id from acc_journal_line where journal_entry_id = $1 and account_id = $2`, [coded.entry_id, gl])).id;

  // The month is reconciled with the line ticked, and agrees: 0 + (-125.00) = -125.00.
  await client.query("reset role");
  const month = (await one(
    `insert into acc_statement_reconciliation (bank_account_id, statement_ending_date, beginning_balance_minor, statement_ending_balance_minor, status)
     values ($1, '2026-07-31', 0, -12500, 'completed') returning id`,
    [bank],
  )).id;
  await client.query(`insert into acc_reconciliation_line (reconciliation_id, journal_line_id) values ($1, $2)`, [month, bankLine]);
  await asAdmin();
  const balance = async (accountId) =>
    Number((await one(
      `select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint as n
         from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
        where l.account_id = $1 and e.status = 'posted'`,
      [accountId],
    )).n);
  const bankBefore = await balance(gl);

  await refused(
    "Change on a line of a reconciled month is refused, and names Recode",
    `select acc_uncategorise_bank_transaction($1, $2)`,
    [out, "wrong account"],
    /reconciled to Jul 31, 2026, so its entry is not voided: its date, amount and bank account stay as reconciled\. To move it to another account, use Recode/,
  );

  const moved = await refusal(RECODE, [out, rent]);
  check("Recode moves a line of a reconciled month to another expense account", moved === null, moved ?? "");
  check("the money is on the new account, and off the old one", (await balance(rent)) === 12500 && (await balance(supplies)) === 0);
  check("the bank account has not moved by a cent", (await balance(gl)) === bankBefore);
  const recon = await one(`select status::text from acc_statement_reconciliation where id = $1`, [month]);
  const ticked = await one(
    `select coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint as n
       from acc_reconciliation_line rl join acc_journal_line l on l.id = rl.journal_line_id
       join acc_journal_entry e on e.id = l.journal_entry_id and e.status = 'posted'
      where rl.reconciliation_id = $1`,
    [month],
  );
  check("the reconciliation stays completed and still agrees: its ticked lines come to its ending balance", recon.status === "completed" && Number(ticked.n) === -12500);
  const changes = await all(`select * from acc_reconciliation_changes() where reconciliation_id = $1`, [month]).catch((e) => [{ error: e.message }]);
  check("nothing about it is reported as changed after sign-off", changes.length === 0, JSON.stringify(changes));
  const shown = (await recodes()).filter((r) => r.bank_transaction_id === out);
  check("Bank Transactions reads the new account for the line", shown.length === 1 && shown[0].account_id === rent, JSON.stringify(shown));
  const audit = await one(
    `select before_json, after_json, actor_id from acc_audit_log
      where table_name = 'acc_bank_transaction' and record_id = $1 and action = 'recode'
        and after_json ->> 'account_id' = $2`,
    [out, rent],
  );
  check(
    "the audit log keeps the account before and after, and who changed it",
    audit?.before_json?.account_id === supplies && audit?.after_json?.account_id === rent && audit?.actor_id === admin.id,
    JSON.stringify(audit),
  );

  check("recoding again moves it on, from its own entry, with one recode standing", (await refusal(RECODE, [out, travel])) === null);
  const standing = await all(`select id from acc_journal_entry where source_type = 'bank' and source_id = $1 and status = 'posted'`, [coded.entry_id]);
  check("only one recode stands, and the money is on the third account", standing.length === 1 && (await balance(travel)) === 12500 && (await balance(rent)) === 0);
  check("recoding to its own entry's account takes the recode back", (await refusal(RECODE, [out, supplies])) === null && (await balance(supplies)) === 12500 && (await balance(travel)) === 0);
  const none = await all(`select id from acc_journal_entry where source_type = 'bank' and source_id = $1 and status = 'posted'`, [coded.entry_id]);
  check("and leaves no recode standing", none.length === 0);

  check("money in recodes the other way round", (await refusal(RECODE, [inLine, travel])) === null && (await balance(travel)) === -8000 && (await balance(sales)) === 0);

  await refused("the account it is on already is refused", RECODE, [out, supplies], /already posted to Verify recode supplies/);
  await refused("a bank account is refused", RECODE, [out, otherBank], /A bank account is not a category/);
  await refused("an inactive account is refused", RECODE, [out, retired], /not an active posting account/);
  await refused("an account that is not there is refused", RECODE, [out, OUTSIDER], /Account not found/);
  const waiting = await (async () => {
    await client.query("reset role");
    const id = await newLine("waiting", -300);
    await asAdmin();
    return id;
  })();
  await refused("a line not coded yet is refused", RECODE, [waiting, rent], /This line is not coded/);

  await as(OUTSIDER);
  await refused("someone who is not staff is refused", RECODE, [out, rent], /Not authorized to recode a bank transaction/);
  void codedIn;
}

/** A company people work in: what Bank Transactions reads about its recodes does not change. */
async function sameRecodes(before) {
  const after = await recodes();
  const key = (rows) => JSON.stringify(rows.map((r) => [r.bank_transaction_id, r.original_entry_id, r.recode_entry_id, r.account_id]));
  check(`acc_bank_recodes reads the same ${before.length} recode(s) after 0194 as before`, key(after) === key(before), `${before.length} before, ${after.length} after`);
}

const { rows: companies } = await client.query(
  `select schema_name, is_sample from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema, is_sample: sample } of companies) {
    console.log(`\n${schema}${sample ? " (sample: every case)" : " (read only)"}`);
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '30s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const before = await recodes();
      const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        for (const statement of statements) await client.query(statement);
        console.log("  (0194 applied inside the transaction, never committed)");
      }
      await sameRecodes(before);
      if (!sample) continue;
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; the rest skipped)");
        continue;
      }
      await fullChecks(admin, base);
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
