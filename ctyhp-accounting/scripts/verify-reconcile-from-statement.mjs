/**
 * Behavioural verification of migration 0132 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0132 has not been applied it is applied first, inside that transaction,
 * and every account, bank account and entry the checks need is made there too —
 * so nothing is left behind. A viewer is checked by turning the administrator
 * into one inside the same transaction.
 *
 * Run: node --env-file=.env.local scripts/verify-reconcile-from-statement.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0132_reconcile_from_statement.sql";
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
        console.log("  (0132 applied inside the transaction, never committed)");
      }
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      // ---- the books: a bank account with two August entries and two September ones
      const account = async (code, name, type) =>
        (await one(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ($1, $2, $3, $4, true) returning id`,
          [code, name, type, base.code],
        )).id;
      const gl = await account("ZZ-VERIFY-RB", "Verify reconcile bank", "bank");
      const other = await account("ZZ-VERIFY-RX", "Verify reconcile other", "expense");
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
        return (await one(`select acc_post_manual_journal($1, 'Verify reconcile', $2, $3, $4::jsonb) as id`, [
          date, ref, base.code, JSON.stringify(lines),
        ])).id;
      };
      await post("2026-08-15", 100000, null);
      await post("2026-08-20", -25000, null);
      await post("2026-09-05", 50000, null);
      await post("2026-09-12", -12000, "1201");

      // ---- bringing the account forward
      const preview = await one(`select * from acc_brought_forward_preview($1, '2026-08-31')`, [bank]);
      check("preview: no reconciliation yet", preview.has_reconciliations === false);
      check("preview: the book balance through Aug 31 is 750.00", Number(preview.book_balance_minor) === 75000, String(preview.book_balance_minor));
      check("preview: two lines would be signed off", preview.open_lines === 2, String(preview.open_lines));

      const bringForward = `select acc_bring_forward_reconciliation($1, '2026-08-31', $2, 'Brought forward, proved by the opening balance on the statement for Sep 1 – Sep 30, 2026') as id`;
      const wrong = await refused(bringForward, [bank, 80000]);
      check("bringing forward on a different opening balance is refused", /The books hold 750\.00 on 2026-08-31, and the statement opens at 800\.00/.test(wrong ?? ""), wrong ?? "accepted");
      const future = await refused(`select acc_bring_forward_reconciliation($1, current_date + 1, 0, 'x')`, [bank]);
      check("bringing forward past today is refused", /past today/.test(future ?? ""), future ?? "accepted");
      const forward =(await one(bringForward, [bank, 75000])).id;
      const forwarded = await one(`select * from acc_statement_reconciliation where id = $1`, [forward]);
      check("brought forward: completed through Aug 31 at 750.00", forwarded.status === "completed" && Number(forwarded.statement_ending_balance_minor) === 75000 && String(forwarded.statement_ending_date).length > 0);
      check("brought forward: the note is kept and it is marked brought forward", /^Brought forward/.test(forwarded.note ?? "") && forwarded.brought_forward === true);
      const forwardLines = await one(`select count(*)::int as n from acc_reconciliation_line where reconciliation_id = $1`, [forward]);
      check("brought forward: the two August lines are cleared", forwardLines.n === 2, String(forwardLines.n));
      const again = await refused(bringForward, [bank, 75000]);
      check("bringing forward twice is refused", /already has a reconciliation/.test(again ?? ""), again ?? "accepted");
      check("preview now sees a reconciliation", (await one(`select * from acc_brought_forward_preview($1, '2026-08-31')`, [bank])).has_reconciliations === true);

      // ---- a reconciliation started from a statement
      const lines = [
        { txn_date: "2026-09-05", description: "DEPOSIT", reference: null, amount_minor: 50000, balance_minor: 125000 },
        { txn_date: "2026-09-12", description: "Check 1201", reference: "1201", amount_minor: -12000, balance_minor: 113000 },
        { txn_date: "2026-09-25", description: "SERVICE FEE", reference: null, amount_minor: -500, balance_minor: 112500 },
      ];
      const start = `select acc_create_reconciliation_from_statement($1, '2026-09-30', $2, $3, $4, $5::jsonb) as id`;
      const rec = (await one(start, [bank, 112500, "sample-statement.pdf", 75000, JSON.stringify(lines)])).id;
      const session = await one(`select * from acc_statement_reconciliation where id = $1`, [rec]);
      check("from a statement: begins where the brought-forward one ended", Number(session.beginning_balance_minor) === 75000, String(session.beginning_balance_minor));
      check("from a statement: the file, opening and closing are kept, and it is not brought forward",
        session.statement_ref === "sample-statement.pdf" && Number(session.statement_opening_minor) === 75000 && Number(session.statement_closing_minor) === 112500 && session.brought_forward === false);
      const stored = (await client.query(`select * from acc_reconciliation_statement_line where reconciliation_id = $1 order by line_no`, [rec])).rows;
      check("from a statement: its three lines are stored in order", stored.length === 3 && stored.map((l) => l.line_no).join(",") === "0,1,2");
      check("from a statement: a line keeps its cheque number and balance", stored[1].reference === "1201" && Number(stored[1].balance_minor) === 113000);

      const book = (await client.query(`select * from acc_reconciliation_lines($1)`, [rec])).rows;
      check("the reconciliation offers the two September lines", book.length === 2, String(book.length));
      check("a book line carries its reference", book.find((l) => Number(l.signed_minor) === -12000)?.reference === "1201");

      const many = `select acc_set_cleared_many($1, $2::uuid[], true) as n`;
      const augustLine = (await one(`select journal_line_id from acc_reconciliation_line where reconciliation_id = $1 limit 1`, [forward])).journal_line_id;
      const twice = await refused(many, [rec, [book[0].journal_line_id, augustLine]]);
      const tickedAfterRefusal = (await one(`select count(*)::int as n from acc_reconciliation_line where reconciliation_id = $1`, [rec])).n;
      check("a batch holding a line already reconciled is refused, and ticks nothing", /already reconciled|after the statement ending date|does not belong/.test(twice ?? "") && tickedAfterRefusal === 0, `${twice ?? "accepted"}; ticked ${tickedAfterRefusal}`);
      const ticked = (await one(many, [rec, book.map((l) => l.journal_line_id)])).n;
      check("both lines ticked in one call", ticked === 2, String(ticked));
      const detail = await one(`select * from acc_reconciliation_detail($1)`, [rec]);
      check("out by the fee the books do not have (5.00)", Number(detail.difference_minor) === -500, String(detail.difference_minor));
      const otherLine = (await one(`select l.id from acc_journal_line l where l.account_id = $1 limit 1`, [other])).id;
      const foreign = await refused(many, [rec, [otherLine]]);
      check("a line of another account is refused", /does not belong to this bank account/.test(foreign ?? ""), foreign ?? "accepted");
      const tooMany = await refused(many, [rec, Array.from({ length: 5001 }, () => book[0].journal_line_id)]);
      check("more than 5,000 lines at once is refused", /At most 5,000/.test(tooMany ?? ""), tooMany ?? "accepted");

      const replace = `select acc_set_reconciliation_statement($1, $2, $3, $4, $5::jsonb) as n`;
      const replaced = (await one(replace, [rec, "other.pdf", 75000, 113000, JSON.stringify(lines.slice(0, 2))])).n;
      const afterReplace = await one(`select statement_ref, statement_closing_minor, (select count(*)::int from acc_reconciliation_statement_line where reconciliation_id = $1) as n from acc_statement_reconciliation where id = $1`, [rec]);
      check("replacing the statement keeps only its lines", replaced === 2 && afterReplace.n === 2 && afterReplace.statement_ref === "other.pdf" && Number(afterReplace.statement_closing_minor) === 113000);
      const zero = await refused(replace, [rec, "x.pdf", 0, 0, JSON.stringify([{ txn_date: "2026-09-01", description: "x", amount_minor: 0 }])]);
      check("a line of no amount is refused", /amount_minor/.test(zero ?? ""), zero ?? "accepted");
      const notList = await refused(replace, [rec, "x.pdf", 0, 0, JSON.stringify({ txn_date: "2026-09-01" })]);
      check("lines that are not a list are refused", /must be a list/.test(notList ?? ""), notList ?? "accepted");
      await one(`select acc_set_statement_ending($1, 113000)`, [rec]);
      check("the ending balance can be taken from the statement", Number((await one(`select * from acc_reconciliation_detail($1)`, [rec])).difference_minor) === 0);
      const completedReplace = await refused(replace, [forward, "x.pdf", 0, 0, "[]"]);
      check("a completed reconciliation's statement cannot be replaced", /not in progress/.test(completedReplace ?? ""), completedReplace ?? "accepted");
      const direct = await refused(`insert into acc_reconciliation_statement_line (reconciliation_id, line_no, txn_date, amount_minor) values ($1, 9, '2026-09-01', 1)`, [rec]);
      check("statement lines cannot be written directly", direct !== null, direct ?? "accepted");
      const internal = await refused(`select acc_recon_write_statement($1, '[]'::jsonb)`, [rec]);
      check("the internal writer cannot be called directly", /permission denied/.test(internal ?? ""), internal ?? "accepted");

      for (const fn of ["acc_reconciliation_lines(uuid)", "acc_brought_forward_preview(uuid, date)"]) {
        const grants = await one(
          `select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as signed_in`,
          [fn],
        );
        check(`${fn.split("(")[0]} is closed to anon and open to signed-in users`, grants.anon === false && grants.signed_in === true, JSON.stringify(grants));
      }

      const tableWrites = await one(
        `select has_table_privilege('authenticated', 'acc_reconciliation_statement_line', 'INSERT, UPDATE, DELETE, TRUNCATE') as writes`,
      );
      check("signed-in users hold no write privilege on the statement lines", tableWrites.writes === false, JSON.stringify(tableWrites));

      // ---- a viewer reads but cannot write; an outsider can do nothing
      await client.query("reset role");
      await client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]);
      await client.query("set local role authenticated");
      await as(admin.id);
      const seen = (await client.query(`select count(*)::int as n from acc_reconciliation_statement_line where reconciliation_id = $1`, [rec])).rows[0].n;
      check("a viewer reads the statement lines", seen === 2, String(seen));
      for (const [label, sql, params] of [
        ["a viewer cannot replace the statement", replace, [rec, "v.pdf", 0, 0, "[]"]],
        ["a viewer cannot tick lines", many, [rec, [book[0].journal_line_id]]],
        ["a viewer cannot take the ending balance", `select acc_set_statement_ending($1, 1)`, [rec]],
      ]) {
        const message = await refused(sql, params);
        check(label, /Not authorized/.test(message ?? ""), message ?? "accepted");
      }
      await client.query("reset role");
      await client.query(`update acc_app_user set role = 'admin' where id = $1`, [admin.id]);
      await client.query("set local role authenticated");
      await as(OUTSIDER);
      const outsider = await refused(start, [bank, 1, "x.pdf", 0, "[]"]);
      check("someone outside the company cannot start one", /Not authorized|not authorized/.test(outsider ?? ""), outsider ?? "accepted");
      const outsiderForward = await refused(bringForward, [bank, 0]);
      check("someone outside the company cannot bring an account forward", /Not authorized/.test(outsiderForward ?? ""), outsiderForward ?? "accepted");
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
