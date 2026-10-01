/**
 * Behavioural verification of migration 0129 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0129 has not been applied it is applied first, inside that transaction,
 * and every account, bank account and bank line the checks need is made there
 * too — so nothing is left behind.
 *
 * Run: node --env-file=.env.local scripts/verify-card-loan.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0129_repayment_register.sql";
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
        console.log("  (0129 applied inside the transaction, never committed)");
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
      const cardGl = await account("ZZ-VERIFY-CC", "Verify Card 4321", "credit_card");
      const otherCard = await account("ZZ-VERIFY-CD", "Verify Card 8765", "credit_card");
      const loanGl = await account("ZZ-VERIFY-LN", "Verify Loan", "long_term_liability");
      const interest = await account("ZZ-VERIFY-IE", "Verify Interest Expense", "other_expense");
      const bank = (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`, [gl, base.code])).id;
      const line = (await one(
        `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, source)
         values ($1, current_date, 'VERIFY CARD EPAY 4321', -12345, md5(random()::text || clock_timestamp()::text), 'file_upload') returning id`,
        [bank],
      )).id;

      await client.query("set local role authenticated");
      await as(admin.id);

      const insert = `insert into acc_repayment_account
          (kind, account_id, match_words, match_digits, interest_account_id, interest_method, annual_rate, fixed_interest_minor)
        values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`;
      const card = await one(insert, ["card", cardGl, "verify card", "4321", null, null, null, null]);
      check("staff register a card", Boolean(card?.id));
      const loan = await one(insert, ["loan", loanGl, "verify loan", null, interest, "rate", 4.25, null]);
      check("staff register a loan with its interest", Boolean(loan?.id));

      const expectRefusal = async (label, params, pattern) => {
        const message = await refused(insert, params);
        check(label, pattern.test(message ?? ""), message ?? "accepted");
      };
      await expectRefusal("an entry with neither words nor digits is refused", ["card", otherCard, "  ", null, null, null, null, null], /says_how_ck/);
      await expectRefusal("digits that are not four are refused", ["card", otherCard, "x", "876", null, null, null, null], /match_digits_check/);
      await expectRefusal("a card with interest is refused", ["card", otherCard, "x", null, interest, "rate", 4, null], /card_ck/);
      await expectRefusal("a loan without an interest account is refused", ["loan", otherCard, "x", null, null, "entered", null, null], /loan_ck/);
      await expectRefusal("a rate loan without a rate is refused", ["loan", otherCard, "x", null, interest, "rate", null, null], /rate_ck/);
      await expectRefusal("a fixed loan without an amount is refused", ["loan", otherCard, "x", null, interest, "fixed", null, null], /fixed_ck/);
      await expectRefusal("the same account twice is refused", ["card", cardGl, "again", null, null, null, null, null], /duplicate key|unique/);

      await as(OUTSIDER);
      await expectRefusal("someone who is not staff cannot register", ["card", otherCard, "x", null, null, null, null, null], /row-level security/);
      const seen = await one(`select count(*)::int n from acc_repayment_account`);
      check("someone who is not staff reads nothing", seen.n === 0, String(seen.n));
      await as(admin.id);

      // A card payment posts through the existing categorise call to the card account.
      const posted = await one(`select acc_categorise_bank_transaction($1, $2) as r`, [line, cardGl]);
      const legs = (
        await client.query(
          `select l.account_id, l.debit_minor::int as dr, l.credit_minor::int as cr
             from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
            where e.entry_number = $1`,
          [posted.r.entry_number],
        )
      ).rows;
      const cardLeg = legs.find((l) => l.account_id === cardGl);
      const bankLeg = legs.find((l) => l.account_id === gl);
      check("a card payment debits the card and credits the bank", cardLeg?.dr === 12345 && bankLeg?.cr === 12345, JSON.stringify(legs));
      const lineStatus = await one(`select status from acc_bank_transaction where id = $1`, [line]);
      check("the line is matched", lineStatus.status === "matched", lineStatus.status);

      await client.query("reset role");
      const audited = (await one(`select count(*)::int n from acc_audit_log where table_name = 'acc_repayment_account'`)).n;
      check("register changes are in the audit log", audited >= 2, String(audited));
      const stamped = await one(`select created_by from acc_repayment_account where id = $1`, [card.id]);
      check("the creator is stamped by the trigger", stamped.created_by === admin.id, String(stamped.created_by));
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
