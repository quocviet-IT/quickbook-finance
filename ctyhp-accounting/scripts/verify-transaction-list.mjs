/**
 * Proves migration 0128 changes nothing but the time it takes.
 *
 * On every company's books, inside a transaction that is ALWAYS rolled back:
 * 0105's acc_transaction_list is recreated under another name, 0128 is applied
 * if it is not live yet, and the two are compared row by row — every column and
 * the order — over the whole book. Nothing is left behind.
 *
 * Run: node --env-file=.env.local scripts/verify-transaction-list.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0128_transaction_list_linear.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OLD = readFileSync(new URL("../supabase/migrations/0105_transaction_list_accounts.sql", import.meta.url), "utf8");

// 0105's function, renamed. Only its `create` statement: the drop and the
// grants belong to the real function.
const start = OLD.indexOf("create or replace function acc_transaction_list(");
const end = OLD.indexOf("$$;", start) + 3;
if (start < 0 || end < 3) throw new Error("Could not find 0105's function body");
const OLD_FUNCTION = `set search_path = public;\n${OLD.slice(start, end).replace(
  "create or replace function acc_transaction_list(",
  "create or replace function acc_transaction_list_0105(",
)}\n`;

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 15 * 60 * 1000);
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
const statementsFor = (schema, file, sql) =>
  schema === "public" ? [sql] : planCompanySchema([{ file, sql }], schema).statements;

const { rows: companies } = await client.query(
  `select schema_name from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '300s'");
      await client.query(`set local search_path = ${schema}, extensions`);

      for (const statement of statementsFor(schema, "0105_copy.sql", OLD_FUNCTION)) await client.query(statement);
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        for (const statement of statementsFor(schema, FILE, MIGRATION)) await client.query(statement);
        console.log("  (0128 applied inside the transaction, never committed)");
      }

      const time = async (fn) => {
        const t = Date.now();
        const { rows } = await client.query(
          `select count(*)::int as n from ${fn}('0001-01-01', '9999-12-31')`,
        );
        return { n: rows[0].n, ms: Date.now() - t };
      };
      const before = await time("acc_transaction_list_0105");
      const after = await time("acc_transaction_list");
      console.log(`  rows ${after.n}; 0105 ${before.ms} ms, 0128 ${after.ms} ms`);
      check("the same number of rows", before.n === after.n, `${before.n} vs ${after.n}`);

      // Row by row, position included: every column and the order must agree.
      const { rows: diff } = await client.query(`
        with o as (select * from acc_transaction_list_0105('0001-01-01', '9999-12-31') with ordinality),
             n as (select * from acc_transaction_list('0001-01-01', '9999-12-31') with ordinality)
        select (select count(*) from (select * from o except all select * from n) x)::int as only_old,
               (select count(*) from (select * from n except all select * from o) y)::int as only_new`);
      check("every row, column and position agrees", diff[0].only_old === 0 && diff[0].only_new === 0,
        `only in 0105: ${diff[0].only_old}, only in 0128: ${diff[0].only_new}`);

      // A short window as well: the date filter must bound both the same way.
      const { rows: window } = await client.query(`
        with last as (select max(entry_date) as d from acc_journal_entry where status = 'posted'),
             o as (select * from acc_transaction_list_0105((select d - 30 from last), (select d from last)) with ordinality),
             n as (select * from acc_transaction_list((select d - 30 from last), (select d from last)) with ordinality)
        select (select count(*) from o)::int as rows,
               (select count(*) from (select * from o except all select * from n) x)::int
             + (select count(*) from (select * from n except all select * from o) y)::int as differing`);
      check(`the last 30 days agree (${window[0].rows} rows)`, window[0].differing === 0, `${window[0].differing} rows differ`);
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
