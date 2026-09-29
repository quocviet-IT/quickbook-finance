/**
 * How often history would suggest, and how often it would be wrong, on each
 * company's own books — the measurement the prototype reports ("wrong guesses
 * from 9 to 2 across 470 entries").
 *
 * Read-only: every company is read inside a transaction that is rolled back
 * (0126 is applied inside it first when it is not live yet). A fixed fifth of
 * the entries that teach is hidden; suggestions for them are worked out from
 * the rest and compared with how they were really coded.
 *
 * Run: node --env-file=.env.local scripts/evaluate-coding-history.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";
import { buildHistoryIndex, HISTORY_MIN, HISTORY_SHARE, suggestFromHistory } from "../lib/domain/coding-history.ts";
import { codableAccount, codingAccountOf } from "../lib/domain/coding.ts";

const FILE = "0126_bank_rules.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const THRESHOLDS = [
  { min: HISTORY_MIN, share: HISTORY_SHARE },
  { min: 2, share: 0.6 },
  { min: 3, share: 0.75 },
  { min: 2, share: 0.9 },
];

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 5 * 60 * 1000);
await client.connect();
const pct = (a, b) => (b === 0 ? "—" : `${((100 * a) / b).toFixed(1)}%`);

try {
  const { rows: companies } = await client.query(`select slug, schema_name from onebook.company where status = 'active' order by display_order, schema_name`);
  for (const { slug, schema_name: schema } of companies) {
    let accounts;
    let rows;
    await client.query("begin");
    try {
      // Applying 0126 here locks acc_account for the foreign key: give up fast
      // rather than queue the app's writes behind this read.
      await client.query("set local lock_timeout = '5s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
        for (const statement of statements) await client.query(statement);
      }
      accounts = (
        await client.query(`select id, account_code, name, account_type::text as account_type, status::text as status, is_posting_account from acc_account`)
      ).rows;
      rows = (await client.query(`select * from acc_coding_history()`)).rows;
    } finally {
      await client.query("rollback");
    }

    const byId = new Map(accounts.map((row) => [row.id, codingAccountOf(row)]));
    const teaching = rows
      .map((row) => ({
        entryId: row.entry_id,
        date: String(row.entry_date instanceof Date ? row.entry_date.toISOString().slice(0, 10) : row.entry_date),
        direction: row.direction,
        accountId: row.account_id,
        texts: [row.bank_description, row.entry_description, row.other_memo].filter((t) => typeof t === "string" && t.trim() !== ""),
      }))
      .filter((source) => codableAccount(byId.get(source.accountId)))
      .sort((a, b) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
    const hidden = teaching.filter((_, i) => i % 5 === 0);
    const index = buildHistoryIndex(teaching.filter((_, i) => i % 5 !== 0), () => true);

    console.log(`\n${slug}: ${teaching.length} entries teach, ${hidden.length} hidden`);
    for (const t of THRESHOLDS) {
      let suggested = 0;
      let wrong = 0;
      for (const h of hidden) {
        const s = suggestFromHistory(index, h.texts, h.direction, t);
        if (!s) continue;
        suggested += 1;
        if (s.accountId !== h.accountId) wrong += 1;
      }
      const label = t.min === HISTORY_MIN && t.share === HISTORY_SHARE ? " (chosen)" : "";
      console.log(
        `  at least ${t.min}, share ${t.share}${label}: suggested ${suggested} of ${hidden.length} (${pct(suggested, hidden.length)}), wrong ${wrong} (${pct(wrong, suggested)} of those suggested)`,
      );
    }
  }
} finally {
  await client.end();
  clearTimeout(killer);
}
