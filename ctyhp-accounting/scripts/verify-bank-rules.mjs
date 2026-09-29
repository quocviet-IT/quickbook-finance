/**
 * Behavioural verification of migration 0126 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0126 has not been applied it is applied first, inside that transaction,
 * so this proves the migration against the real books before it is applied
 * for real and leaves nothing behind either way.
 *
 * Run: node --env-file=.env.local scripts/verify-bank-rules.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0126_bank_rules.sql";
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
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
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
const as = (userId) => client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);

const { rows: companies } = await client.query(
  `select schema_name from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
        for (const statement of statements) await client.query(statement);
        console.log("  (0126 applied inside the transaction, never committed)");
      }

      const admin = (await client.query(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`)).rows[0];
      const account = (
        await client.query(`select id from acc_account where account_type = 'expense' and status = 'active' and is_posting_account order by account_code limit 1`)
      ).rows[0];
      if (!admin || !account) {
        console.log("  (no active administrator or expense account; rule checks skipped)");
      } else {
        await client.query("set local role authenticated");
        await as(admin.id);
        const inserted = (
          await client.query(
            `insert into acc_bank_rule (position, match_kind, match_text, direction, account_id)
             values (1, 'words', 'verify probe', 'out', $1) returning id, created_by`,
            [account.id],
          )
        ).rows[0];
        check("staff can add a rule, stamped with who added it", Boolean(inserted?.id) && inserted.created_by === admin.id);
        await client.query(`update acc_bank_rule set match_text = 'verify probe two' where id = $1`, [inserted.id]);
        await client.query(`select acc_reorder_bank_rules(array(select id from acc_bank_rule order by position, id))`);
        const count = (await client.query(`select count(*)::int as n from acc_bank_rule`)).rows[0].n;
        const positions = (await client.query(`select array_agg(position order by position) as p from acc_bank_rule`)).rows[0].p;
        check("rules can be put in order", positions.every((p, i) => p === i + 1) && positions.length === count, positions.join(","));
        const badOrder = await refused(`select acc_reorder_bank_rules($1::uuid[])`, [[inserted.id, inserted.id]]);
        check("an order that does not list every rule once is refused", /every rule once/.test(badOrder ?? ""), badOrder ?? "accepted");
        await client.query(`delete from acc_bank_rule where id = $1`, [inserted.id]);
        await client.query("reset role");
        const audit = (await client.query(`select action from acc_audit_log where table_name = 'acc_bank_rule' and record_id = $1`, [inserted.id])).rows.map(
          (r) => r.action,
        );
        check("every change is in the audit log", ["insert", "update", "delete"].every((a) => audit.includes(a)), audit.join(","));

        await client.query("set local role authenticated");
        await as(OUTSIDER);
        const outsider = await refused(`insert into acc_bank_rule (position, match_text, account_id) values (1, 'x', $1)`, [account.id]);
        check("someone who is not staff cannot add a rule", outsider !== null, outsider ?? "accepted");
        await client.query("reset role");

        const badWindow = await refused(
          `insert into acc_bank_rule (position, match_text, account_id, min_minor, max_minor) values (1, 'x', $1, 500, 100)`,
          [account.id],
        );
        check("a window whose lowest amount is above its highest is refused", /amount_window/.test(badWindow ?? ""), badWindow ?? "accepted");
      }

      const history = (await client.query(`select count(*)::int as n from acc_coding_history()`)).rows[0].n;
      const misshapen = (
        await client.query(
          `with h as (select * from acc_coding_history())
           select count(*)::int as n from h
            where (select count(*) from acc_journal_line l join acc_account a on a.id = l.account_id
                    where l.journal_entry_id = h.entry_id and a.account_type = 'bank') <> 1
               or (select count(*) from acc_journal_line l join acc_account a on a.id = l.account_id
                    where l.journal_entry_id = h.entry_id and a.account_type <> 'bank') <> 1
               or not exists (select 1 from acc_journal_entry e where e.id = h.entry_id and e.status = 'posted')`,
        )
      ).rows[0].n;
      check(`history holds only posted entries of one bank leg and one other (${history})`, misshapen === 0, String(misshapen));
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
