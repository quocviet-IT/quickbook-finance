/**
 * Behavioural verification of migration 0201 (a suggested match no longer
 * stops a statement import being undone) on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back;
 * when 0201 has not been applied it is applied first, inside that transaction.
 * Every company is read: how many of its active statement imports could not be
 * undone under the old rule and can be now, and that no import with a real
 * match becomes undoable. In the sample company PC-Test the undo itself is run
 * through the app's own function: an import held back only by suggestions is
 * undone, its suggestions go with its lines, and an import with an approved
 * match is still refused. A lock wanted for more than five seconds stops the
 * run rather than making anyone wait.
 *
 * Run: node --env-file=.env.local scripts/verify-undo-import-suggestions.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0201_undo_import_ignores_suggestions.sql";
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

/** Each active statement import, with its lines locked by the old rule (any match row) and by 0201's (real matches only). */
const IMPORTS = `
  select b.id,
         count(t.id)::int as lines,
         count(t.id) filter (where t.status <> 'unmatched'
                               or exists (select 1 from acc_reconciliation r where r.bank_transaction_id = t.id))::int as locked_old,
         count(t.id) filter (where t.status <> 'unmatched'
                               or exists (select 1 from acc_reconciliation r where r.bank_transaction_id = t.id and r.status = 'approved'))::int as locked_new,
         (select count(*)::int from acc_reconciliation r join acc_bank_transaction x on x.id = r.bank_transaction_id
           where x.import_batch_id = b.id and r.status = 'suggested') as suggested
    from acc_bank_import_batch b
    left join acc_bank_transaction t on t.import_batch_id = b.id
   where b.status = 'active'
   group by b.id`;

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
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
        for (const statement of statements) await client.query(statement);
        console.log("  (0201 applied inside the transaction, never committed)");
      }

      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      if (admin) await as(admin.id);
      const imports = (await client.query(IMPORTS)).rows;
      const freed = imports.filter((b) => b.locked_old > 0 && b.locked_new === 0).length;
      console.log(`  ${imports.length} active statement imports; ${freed} could not be undone before and can be now`);
      if (admin) {
        let agree = 0;
        for (const b of imports) {
          if ((await one(`select acc_bank_import_batch_locked_lines($1) as n`, [b.id])).n === b.locked_new) agree += 1;
        }
        check("the function counts exactly the matched, coded or ignored lines and those with an approved match", agree === imports.length, `${agree} of ${imports.length}`);
      }
      if (admin) {
        // An import the undo may now take has no line that is matched, coded or ignored, and none with an approved match.
        // (A suggestion may point at a journal line a reconciliation has ticked; the line itself is still pointed at by nothing.)
        const unsafe = await one(`
          select count(*)::int as n
            from acc_bank_import_batch b
            join acc_bank_transaction t on t.import_batch_id = b.id
           where b.status = 'active'
             and acc_bank_import_batch_locked_lines(b.id) = 0
             and (t.status <> 'unmatched'
                  or exists (select 1 from acc_reconciliation r where r.bank_transaction_id = t.id and r.status = 'approved'))`);
        check("no import the undo may take holds a line the ledger points at", unsafe.n === 0, `${unsafe.n} line(s)`);
      }

      if (schema !== SAMPLE) {
        console.log("  (not the sample company: read only)");
        continue;
      }
      if (!admin) {
        check("the sample company has an active administrator", false);
        continue;
      }

      // An import held back only by suggestions is undone, and its suggestions go with its lines.
      const held = imports.find((b) => b.locked_old > 0 && b.locked_new === 0 && b.suggested > 0);
      if (!held) {
        check("the sample company has an import held back only by suggested matches", false);
      } else {
        const LEDGER = `select (select count(*) from acc_journal_entry)::int as entries, (select count(*) from acc_journal_line)::int as lines,
                               (select count(*) from acc_reconciliation_line)::int as ticks,
                               (select count(*) from acc_reconciliation where status = 'approved')::int as approved`;
        const before = await one(LEDGER);
        const undo = await refusal(`select acc_undo_bank_statement_import($1, 'Verify: suggestions do not hold an import back')`, [held.id]);
        check("an import held back only by suggested matches is undone", undo === null, undo ?? "");
        await client.query(`select acc_undo_bank_statement_import($1, 'Verify: suggestions do not hold an import back')`, [held.id]);
        const left = await one(`select count(*)::int as n from acc_bank_transaction where import_batch_id = $1`, [held.id]);
        check("its lines are removed", left.n === 0, String(left.n));
        const orphans = await one(
          `select count(*)::int as n from acc_reconciliation r where not exists (select 1 from acc_bank_transaction t where t.id = r.bank_transaction_id)`,
        );
        check("its suggestions went with them", orphans.n === 0, String(orphans.n));
        const after = await one(LEDGER);
        check(
          "the journal, the reconciliations' ticks and every approved match are untouched",
          JSON.stringify(after) === JSON.stringify(before),
          `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
        );
        const batch = await one(`select status from acc_bank_import_batch where id = $1`, [held.id]);
        check("the import is marked undone", batch.status === "voided", batch.status);
        const audit = await one(
          `select before_json from acc_audit_log where table_name = 'acc_bank_import_batch' and record_id = $1 and action = 'undo' order by created_at desc limit 1`,
          [held.id],
        );
        check(
          "the audit row says how many suggestions went with the lines",
          Number(audit?.before_json?.suggestions_withdrawn) === held.suggested && Number(audit?.before_json?.lines_removed) === held.lines,
          JSON.stringify(audit?.before_json ?? null),
        );
      }

      // An import with an approved match is still refused, and keeps every line.
      const matched = imports.find((b) => b.locked_new > 0);
      if (!matched) {
        check("the sample company has an import with a real match", false);
      } else {
        const refused = await refusal(`select acc_undo_bank_statement_import($1, 'Verify: a real match still holds')`, [matched.id]);
        check("an import with a line the ledger points at is still refused", /already been matched/.test(refused ?? ""), refused ?? "not refused");
        check("and the refusal counts those lines", new RegExp(`^${matched.locked_new} line`).test(refused ?? ""), refused ?? "");
        const still = await one(`select count(*)::int as n from acc_bank_transaction where import_batch_id = $1`, [matched.id]);
        check("nothing was removed", still.n === matched.lines, `${still.n} of ${matched.lines}`);
      }
    } finally {
      await client.query("rollback");
    }
  }
} finally {
  clearTimeout(killer);
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed (every change rolled back)`);
process.exit(failed === 0 ? 0 : 1);
