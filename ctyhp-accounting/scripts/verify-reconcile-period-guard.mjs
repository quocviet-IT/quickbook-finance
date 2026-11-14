/**
 * Behavioural verification of migration 0197 (a period already reconciled is
 * not reconciled again) on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back;
 * when 0197 has not been applied it is applied first, inside that transaction.
 * In the sample company PC-Test the checks start, complete, reopen and refuse
 * reconciliations through the app's own functions. Every other company is only
 * read: its reconciliations in progress that end on or before a completed one
 * are listed, because from 0197 they can no longer be completed. A lock wanted
 * for more than five seconds stops the run rather than making anyone wait.
 *
 * Run: node --env-file=.env.local scripts/verify-reconcile-period-guard.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0197_reconcile_after_last_completed.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 4 * 60 * 1000);
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
  `select schema_name, is_sample from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '20s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
        for (const statement of statements) await client.query(statement);
        console.log("  (0197 applied inside the transaction, never committed)");
      }
      const stuck = await client.query(`
        select r.statement_ending_date::text as ending, a.account_code,
               (select max(c.statement_ending_date)::text from acc_statement_reconciliation c
                 where c.bank_account_id = r.bank_account_id and c.status = 'completed') as reconciled_to
          from acc_statement_reconciliation r
          join acc_bank_account b on b.id = r.bank_account_id
          join acc_account a on a.id = b.account_id
         where r.status = 'in_progress'
           and r.statement_ending_date <= (select max(c.statement_ending_date) from acc_statement_reconciliation c
                                            where c.bank_account_id = r.bank_account_id and c.status = 'completed')`);
      for (const s of stuck.rows) console.log(`  note: ${s.account_code} has a reconciliation to ${s.ending} in progress behind one completed to ${s.reconciled_to}; it can no longer be completed, only discarded`);
      if (schema !== SAMPLE) {
        console.log("  (not the sample company: read only)");
        continue;
      }

      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const bank = await one(`
        select b.id, max(r.statement_ending_date)::text as last, (array_agg(r.statement_ending_balance_minor order by r.statement_ending_date desc))[1] as closing
          from acc_bank_account b join acc_statement_reconciliation r on r.bank_account_id = b.id and r.status = 'completed'
         where not exists (select 1 from acc_statement_reconciliation p where p.bank_account_id = b.id and p.status = 'in_progress')
         group by b.id order by max(r.statement_ending_date) desc limit 1`);
      if (!bank) {
        check("the sample company has a reconciled bank account with nothing in progress", false);
        continue;
      }
      await as(admin.id);
      const CREATE = `select acc_create_reconciliation($1, $2::date, $3)`;
      const same = await refusal(CREATE, [bank.id, bank.last, bank.closing]);
      check("a reconciliation to the date already reconciled is refused", /already reconciled to/.test(same ?? ""), same ?? "not refused");
      const earlier = await refusal(CREATE, [bank.id, "2000-01-31", 0]);
      check("so is one to an earlier date", /already reconciled to/.test(earlier ?? ""), earlier ?? "not refused");
      const later = await refusal(CREATE, [bank.id, "2099-12-31", bank.closing]);
      check("one to a later date is started", later === null, later ?? "");

      // A second reconciliation of the same month written before 0197: it can no longer be completed.
      const dup = await one(
        `insert into acc_statement_reconciliation (bank_account_id, statement_ending_date, beginning_balance_minor, statement_ending_balance_minor, status, prepared_by)
         values ($1, $2::date, $3, $3, 'in_progress', $4) returning id`,
        [bank.id, bank.last, bank.closing, admin.id],
      );
      const completeDup = await refusal(`select acc_complete_reconciliation($1)`, [dup.id]);
      check("a second reconciliation of a reconciled month is not completed, even at a difference of zero", /is not completed/.test(completeDup ?? ""), completeDup ?? "completed");
      await client.query(`delete from acc_statement_reconciliation where id = $1`, [dup.id]);

      // Reopening the latest month and completing it again still works.
      const latest = await one(
        `select id from acc_statement_reconciliation where bank_account_id = $1 and status = 'completed' order by statement_ending_date desc limit 1`,
        [bank.id],
      );
      const reopen = await refusal(`select acc_reopen_reconciliation($1, $2)`, [latest.id, "verify 0197: reopen and complete again"]);
      if (reopen && /approval/i.test(reopen)) {
        console.log(`  (reopen needs approval in this company: reopen-and-complete not tried) ${reopen}`);
      } else {
        await client.query(`select acc_reopen_reconciliation($1, $2)`, [latest.id, "verify 0197: reopen and complete again"]);
        const again = await refusal(`select acc_complete_reconciliation($1)`, [latest.id]);
        check("the latest month, reopened, completes again", again === null, again ?? "");
      }
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
