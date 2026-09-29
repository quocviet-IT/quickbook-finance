/**
 * Behavioural verification of migration 0125 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0125 has not been applied yet it is applied first, inside that same
 * transaction — so this proves the migration against the real books before it
 * is applied for real, and leaves nothing behind either way.
 *
 * Run: node --env-file=.env.local scripts/verify-coa-structure.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0125_chart_of_accounts_structure.sql";
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
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const FINGERPRINT = `
  select md5(coalesce(string_agg(
    account_code || '|' || name || '|' || account_type::text || '|' || coalesce(parent_account_id::text, ''),
    E'\\n' order by account_code), '')) as f
    from acc_account`;

async function refused(sql, params) {
  await client.query("savepoint probe");
  try {
    await client.query(sql, params);
    await client.query("release savepoint probe");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint probe");
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
      // Applying 0125 here takes a lock on the live acc_account: give up fast
      // rather than queue the app's reads behind a lock we are waiting for.
      await client.query("set local lock_timeout = '5s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const applied =
        (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      const before = (await client.query(FINGERPRINT)).rows[0].f;
      if (!applied) {
        const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
        for (const statement of statements) await client.query(statement);
        console.log("  (0125 applied inside the transaction, never committed)");
      }
      check("no account's code, name, type or parent changed", (await client.query(FINGERPRINT)).rows[0].f === before);

      const expectedContra = (
        await client.query(
          `select account_code from acc_account
            where detail_type ~* '^\\s*contra\\M' or (account_code = '1190' and name ilike 'allowance%')
            order by account_code`,
        )
      ).rows.map((r) => r.account_code);
      const flagged = (await client.query(`select account_code from acc_account where is_contra order by account_code`)).rows.map(
        (r) => r.account_code,
      );
      check(
        "the system contra accounts are flagged",
        expectedContra.every((c) => flagged.includes(c)),
        `expected ${expectedContra.join(",")} flagged ${flagged.join(",")}`,
      );
      if (!applied) {
        check("nothing else is flagged contra", flagged.length === expectedContra.length, flagged.join(","));
      }

      const undeposited = (
        await client.query(`select detail_type from acc_account where account_code = '1210' and name ilike '%undeposited%'`)
      ).rows[0];
      if (undeposited) check("Undeposited Funds carries its detail type", undeposited.detail_type === "undeposited_funds");

      const enumHas = (
        await client.query(
          `select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
            where t.typname = 'acc_account_type' and t.typnamespace = $1::regnamespace and e.enumlabel = 'long_term_liability'`,
          [schema],
        )
      ).rowCount > 0;
      check("the account type long_term_liability exists", enumHas);

      const income = (await client.query(`select id from acc_account where account_type = 'income' order by account_code limit 1`)).rows[0];
      const expense = (await client.query(`select id from acc_account where account_type = 'expense' order by account_code limit 1`)).rows[0];
      if (income && expense) {
        const message = await refused(`update acc_account set parent_account_id = $1 where id = $2`, [income.id, expense.id]);
        check("a parent of another type is refused", /same type as its parent/.test(message ?? ""), message ?? "accepted");
      }

      await client.query(
        `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
         values ('ZZ-VERIFY-P', 'Verify parent', 'expense', 'USD', true),
                ('ZZ-VERIFY-C', 'Verify child', 'expense', 'USD', true)`,
      );
      const sameType = await refused(
        `update acc_account set parent_account_id = (select id from acc_account where account_code = 'ZZ-VERIFY-P')
          where account_code = 'ZZ-VERIFY-C'`,
      );
      check("a parent of the same type is accepted", sameType === null, sameType ?? "");
      const retype = await refused(`update acc_account set account_type = 'income' where account_code = 'ZZ-VERIFY-P'`);
      check("a parent cannot change type under a child of the old type", /same type as its parent/.test(retype ?? ""), retype ?? "accepted");

      if (applied) {
        const longTerm = await refused(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ('ZZ-VERIFY-LT', 'Verify long-term loan', 'long_term_liability', 'USD', true)`,
        );
        check("a long-term liability account can be created", longTerm === null, longTerm ?? "");
      } else {
        console.log("  (creating a long_term_liability account waits until 0125 is committed)");
      }
    } finally {
      await client.query("rollback");
    }
  }
} finally {
  await client.end();
  clearTimeout(killer);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
