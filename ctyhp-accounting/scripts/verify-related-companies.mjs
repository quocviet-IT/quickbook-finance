/**
 * Behavioural verification of migration 0131 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0131 has not been applied it is applied first, inside that transaction,
 * and every account, bank account and bank line the checks need is made there
 * too — so nothing is left behind.
 *
 * Run: node --env-file=.env.local scripts/verify-related-companies.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0131_related_company.sql";
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
const as = (userId) => client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);

const { rows: companies } = await client.query(`select schema_name from onebook.company where status = 'active' order by display_order, schema_name`);

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
        console.log("  (0131 applied inside the transaction, never committed)");
      }
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      const account = async (code, name, type) =>
        (await one(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ($1, $2, $3, $4, true) returning id`,
          [code, name, type, base.code],
        )).id;
      const gl = await account("ZZ-VERIFY-CK", "Verify checking", "bank");
      const due = await account("ZZ-VERIFY-RC", "Verify Due from/to Affiliate", "current_asset");
      const due2 = await account("ZZ-VERIFY-RD", "Verify Due to Other Affiliate", "current_liability");
      const bank = (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`, [gl, base.code])).id;
      const bankLine = async (description, amount) =>
        (await one(
          `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, source)
           values ($1, current_date, $2, $3, md5(random()::text || clock_timestamp()::text), 'file_upload') returning id`,
          [bank, description, amount],
        )).id;
      const lineOut = await bankLine("WIRE TO VERIFY AFFILIATE", -12345);
      const lineIn = await bankLine("WIRE FROM VERIFY AFFILIATE", 6789);

      await client.query("set local role authenticated");
      await as(admin.id);

      const insert = `insert into acc_related_company (name, account_id, match_words) values ($1, $2, $3) returning id`;
      const company = await one(insert, ["Verify Affiliate, LLC", due, "verify affiliate"]);
      check("staff register a related company", Boolean(company?.id));

      const expectRefusal = async (label, params, pattern) => {
        const message = await refused(insert, params);
        check(label, pattern.test(message ?? ""), message ?? "accepted");
      };
      await expectRefusal("a blank name is refused", ["   ", due2, "other"], /name_ck/);
      await expectRefusal("a name over 120 characters is refused", ["x".repeat(121), due2, "other"], /name_ck/);
      await expectRefusal("blank words are refused", ["Verify Other", due2, "  "], /words_ck/);
      await expectRefusal("words over 200 characters are refused", ["Verify Other", due2, "x".repeat(201)], /words_ck/);
      await expectRefusal("the same name in another case is refused", ["VERIFY AFFILIATE, LLC ", due2, "other"], /acc_related_company_name_key/);
      await expectRefusal("the same account twice is refused", ["Verify Other", due, "other"], /acc_related_company_account_id_key/);

      await as(OUTSIDER);
      await expectRefusal("someone who is not staff cannot register", ["Verify Other", due2, "other"], /row-level security/);
      const seen = await one(`select count(*)::int n from acc_related_company`);
      check("someone who is not staff reads nothing", seen.n === 0, String(seen.n));

      const viewer = await one(`select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`);
      if (viewer) {
        await as(viewer.id);
        const read = await one(`select count(*)::int n from acc_related_company`);
        check("a viewer reads the register", read.n === 1, String(read.n));
        await expectRefusal("a viewer cannot register", ["Verify Other", due2, "other"], /row-level security/);
      } else {
        console.log("  SKIP  no active viewer to authenticate as");
      }
      await as(admin.id);

      const legsOf = async (entryNumber) =>
        (
          await client.query(
            `select l.account_id, l.debit_minor::int as dr, l.credit_minor::int as cr
               from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
              where e.entry_number = $1`,
            [entryNumber],
          )
        ).rows;

      // Money out debits the related company's account; money in credits it.
      const postedOut = await one(`select acc_categorise_bank_transaction($1, $2) as r`, [lineOut, due]);
      const outLegs = await legsOf(postedOut.r.entry_number);
      check(
        "money out debits the related account and credits the bank",
        outLegs.find((l) => l.account_id === due)?.dr === 12345 && outLegs.find((l) => l.account_id === gl)?.cr === 12345,
        JSON.stringify(outLegs),
      );
      const postedIn = await one(`select acc_categorise_bank_transaction($1, $2) as r`, [lineIn, due]);
      const inLegs = await legsOf(postedIn.r.entry_number);
      check(
        "money in credits the related account and debits the bank",
        inLegs.find((l) => l.account_id === due)?.cr === 6789 && inLegs.find((l) => l.account_id === gl)?.dr === 6789,
        JSON.stringify(inLegs),
      );
      const balance = await one(
        `select (debit_base - credit_base)::int as net from acc_ledger_balances(null, current_date) where account_id = $1`,
        [due],
      );
      check("the balance nets the two: the affiliate owes 55.56", balance?.net === 5556, String(balance?.net));

      await one(`select acc_uncategorise_bank_transaction($1, 'verify') as n`, [lineIn]);
      const back = await one(`select status from acc_bank_transaction where id = $1`, [lineIn]);
      check("Change takes a line back", back.status === "unmatched", back.status);

      await client.query(`update acc_related_company set match_words = 'verify affiliate, vfa' where id = $1`, [company.id]);
      await client.query(`delete from acc_related_company where id = $1`, [company.id]);

      await client.query("reset role");
      const audited = (await one(`select count(*)::int n from acc_audit_log where table_name = 'acc_related_company'`)).n;
      check("insert, update and delete are in the audit log", audited >= 3, String(audited));
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
