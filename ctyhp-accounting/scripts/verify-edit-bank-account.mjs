/**
 * Behavioural verification of migration 0191 (acc_update_bank_account) on
 * every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0191 has not been applied it is applied first, inside that transaction.
 * The bank account the checks rename is one the company already has; its name
 * is back as it was when the transaction ends. A refusal is tried inside a
 * savepoint. Nothing is left behind, and a lock wanted for more than five
 * seconds stops the run rather than making anyone wait.
 *
 * Run: node --env-file=.env.local scripts/verify-edit-bank-account.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0191_edit_bank_account.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 3 * 60 * 1000);
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

/** Why a call is refused, or null when it is not. Tried inside a savepoint, so a refusal leaves the transaction usable. */
async function refusal(sql, params) {
  await client.query("savepoint trial");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint trial");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint trial");
    return error.message;
  }
}

const { rows: companies } = await client.query(
  `select schema_name from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '20s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        for (const statement of statements) await client.query(statement);
        console.log("  (0191 applied inside the transaction, never committed)");
      }
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const account = await one(`select id, account_id, bank_name, account_number_masked, currency_code from acc_bank_account order by created_at limit 1`);
      if (!admin || !account) {
        console.log("  (no active administrator or no bank account; skipped)");
        continue;
      }

      await as(admin.id);
      const saved = await one(`select acc_update_bank_account($1, $2::jsonb) as row`, [
        account.id,
        JSON.stringify({ bank_name: "Verify 0191 Renamed", account_number_masked: "0191" }),
      ]);
      check("it returns the row as saved", saved.row.bank_name === "Verify 0191 Renamed" && saved.row.account_number_masked === "0191", JSON.stringify(saved.row));
      const after = await one(`select account_id, bank_name, account_number_masked, currency_code from acc_bank_account where id = $1`, [account.id]);
      check("the name and the number are changed", after.bank_name === "Verify 0191 Renamed" && after.account_number_masked === "0191");
      check("the ledger account and the currency are not", after.account_id === account.account_id && after.currency_code === account.currency_code);
      const audit = await one(
        `select before_json ->> 'bank_name' as was, after_json ->> 'bank_name' as now, actor_id
           from acc_audit_log
          where table_name = 'acc_bank_account' and record_id = $1 and action = 'update'
          order by created_at desc limit 1`,
        [account.id],
      );
      check(
        "the audit log keeps the old and the new name, and who changed it",
        audit?.was === account.bank_name && audit?.now === "Verify 0191 Renamed" && audit?.actor_id === admin.id,
        JSON.stringify(audit),
      );

      const numberOnly = await one(`select acc_update_bank_account($1, $2::jsonb) as row`, [account.id, JSON.stringify({ account_number_masked: null })]);
      check("a number can be cleared without naming the name", numberOnly.row.account_number_masked === null && numberOnly.row.bank_name === "Verify 0191 Renamed");

      const blank = await refusal(`select acc_update_bank_account($1, $2::jsonb)`, [account.id, JSON.stringify({ bank_name: "   " })]);
      check("an empty name is refused", /Enter the bank account's name/.test(blank ?? ""), blank ?? "not refused");
      const ledger = await refusal(`select acc_update_bank_account($1, $2::jsonb)`, [account.id, JSON.stringify({ account_id: account.account_id })]);
      check("the ledger account cannot be written through it", /cannot be saved here/.test(ledger ?? ""), ledger ?? "not refused");
      const currency = await refusal(`select acc_update_bank_account($1, $2::jsonb)`, [account.id, JSON.stringify({ currency_code: "USD" })]);
      check("nor the currency", /cannot be saved here/.test(currency ?? ""), currency ?? "not refused");
      const missing = await refusal(`select acc_update_bank_account($1, $2::jsonb)`, [OUTSIDER, JSON.stringify({ bank_name: "Nobody" })]);
      check("a bank account that is not there is refused", /no longer here/.test(missing ?? ""), missing ?? "not refused");
      const noId = await refusal(`select acc_update_bank_account(null, $1::jsonb)`, [JSON.stringify({ bank_name: "Nobody" })]);
      check("no bank account chosen is refused", /Choose the bank account/.test(noId ?? ""), noId ?? "not refused");

      await as(OUTSIDER);
      const outsider = await refusal(`select acc_update_bank_account($1, $2::jsonb)`, [account.id, JSON.stringify({ bank_name: "Outsider" })]);
      check("someone who is not staff is refused", /Not authorized to change a bank account/.test(outsider ?? ""), outsider ?? "not refused");
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
