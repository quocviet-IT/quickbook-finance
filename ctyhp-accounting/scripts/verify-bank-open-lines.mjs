/**
 * Behavioural verification of migration 0133 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0133 has not been applied it is applied first, inside that transaction,
 * and every account, bank account, entry and reconciliation the checks need is
 * made there too — so nothing is left behind. A viewer is checked by turning
 * the administrator into one inside the same transaction.
 *
 * Run: node --env-file=.env.local scripts/verify-bank-open-lines.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0133_bank_open_lines.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 6 * 60 * 1000);
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
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const as = (userId) =>
  client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);

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
        console.log("  (0133 applied inside the transaction, never committed)");
      }
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      // ---- the books: a bank account with two July entries and one in August
      const account = async (code, name, type) =>
        (await one(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ($1, $2, $3, $4, true) returning id`,
          [code, name, type, base.code],
        )).id;
      const gl = await account("ZZ-VERIFY-OB", "Verify open lines bank", "bank");
      const other = await account("ZZ-VERIFY-OX", "Verify open lines other", "expense");
      const bank = (await one(
        `insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`,
        [gl, base.code],
      )).id;

      await client.query("set local role authenticated");
      await as(admin.id);
      const post = async (date, minor, ref) => {
        const lines =
          minor > 0
            ? [{ account_id: gl, debit_minor: minor, credit_minor: 0 }, { account_id: other, debit_minor: 0, credit_minor: minor }]
            : [{ account_id: other, debit_minor: -minor, credit_minor: 0 }, { account_id: gl, debit_minor: 0, credit_minor: -minor }];
        await one(`select acc_post_manual_journal($1, 'Verify open lines', $2, $3, $4::jsonb) as id`, [
          date, ref, base.code, JSON.stringify(lines),
        ]);
      };
      await post("2026-07-05", 50000, null);
      await post("2026-07-20", -10000, "1201");
      await post("2026-08-03", 5000, null);

      const open = async (through) => (await client.query(`select * from acc_bank_open_lines($1, $2)`, [bank, through])).rows;
      const july = await open("2026-07-31");
      check("to July 31: the two July lines, oldest first", july.length === 2 && july[0].entry_date < july[1].entry_date, String(july.length));
      check("each line's amount is signed for the bank", Number(july[0].signed_minor) === 50000 && Number(july[1].signed_minor) === -10000);
      check("a line carries its reference", july[1].reference === "1201", String(july[1].reference));
      check("to August 31: all three", (await open("2026-08-31")).length === 3);

      // ---- a completed reconciliation takes its lines out; one in progress does not
      const rec = (await one(`select acc_create_reconciliation($1, '2026-07-31', 50000) as id`, [bank])).id;
      await one(`select acc_set_cleared($1, $2, true)`, [rec, july[0].journal_line_id]);
      check("a line ticked in a reconciliation in progress is still open", (await open("2026-08-31")).length === 3);
      await one(`select acc_complete_reconciliation($1)`, [rec]);
      const after = await open("2026-08-31");
      check(
        "a line in a completed reconciliation is no longer open",
        after.length === 2 && !after.some((l) => l.journal_line_id === july[0].journal_line_id),
        String(after.length),
      );

      // ---- who can read
      const grants = await one(
        `select has_function_privilege('anon', 'acc_bank_open_lines(uuid, date)', 'execute') as anon,
                has_function_privilege('authenticated', 'acc_bank_open_lines(uuid, date)', 'execute') as signed_in`,
      );
      check("closed to anon, open to signed-in users", grants.anon === false && grants.signed_in === true, JSON.stringify(grants));
      await client.query("reset role");
      await client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]);
      await client.query("set local role authenticated");
      await as(admin.id);
      check("a viewer reads the open lines", (await open("2026-08-31")).length === 2);
      await client.query("reset role");
      await client.query(`update acc_app_user set role = 'admin' where id = $1`, [admin.id]);
      await client.query("set local role authenticated");
      await as(OUTSIDER);
      check("someone outside the company reads nothing", (await open("2026-08-31")).length === 0);
    } finally {
      await client.query("rollback");
    }
  }
} finally {
  clearTimeout(killer);
  await client.end();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);