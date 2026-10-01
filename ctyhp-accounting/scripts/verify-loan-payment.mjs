/**
 * Behavioural verification of migration 0130 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0130 has not been applied it is applied first, inside that transaction,
 * and every account, bank account, register entry and bank line the checks
 * need is made there too — so nothing is left behind.
 *
 * Run: node --env-file=.env.local scripts/verify-loan-payment.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0130_loan_payment.sql";
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
const legsOf = async (entryNumber) =>
  (
    await client.query(
      `select l.account_id, l.debit_minor::int as dr, l.credit_minor::int as cr, l.memo
         from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
        where e.entry_number = $1`,
      [entryNumber],
    )
  ).rows;

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
        console.log("  (0130 applied inside the transaction, never committed)");
      }
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      const account = async (code, name, type, currency = base.code) =>
        (await one(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ($1, $2, $3, $4, true) returning id`,
          [code, name, type, currency],
        )).id;
      const gl = await account("ZZ-VERIFY-LK", "Verify checking", "bank");
      const loanGl = await account("ZZ-VERIFY-LL", "Verify Loan", "long_term_liability");
      const interestGl = await account("ZZ-VERIFY-LI", "Verify Interest Expense", "other_expense");
      const cardGl = await account("ZZ-VERIFY-LC", "Verify Card", "credit_card");
      const bank = (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`, [gl, base.code])).id;
      const lineOf = async (amountMinor, description, pending = false) =>
        (await one(
          `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, source, pending)
           values ($1, current_date, $2, $3, md5(random()::text || clock_timestamp()::text), 'file_upload', $4) returning id`,
          [bank, description, amountMinor, pending],
        )).id;
      const l1 = await lineOf(-200000, "VERIFY LOAN PMT 1");
      const l2 = await lineOf(-200000, "VERIFY LOAN PMT 2");
      const l3 = await lineOf(-200000, "VERIFY LOAN PMT 3");
      const lIn = await lineOf(200000, "VERIFY LOAN PROCEEDS");
      const lPending = await lineOf(-200000, "VERIFY LOAN PENDING", true);

      await client.query("set local role authenticated");
      await as(admin.id);
      const reg = (
        await one(
          `insert into acc_repayment_account (kind, account_id, match_words, interest_account_id, interest_method, annual_rate)
           values ('loan', $1, 'verify loan', $2, 'rate', 4) returning id`,
          [loanGl, interestGl],
        )
      ).id;
      const cardReg = (await one(`insert into acc_repayment_account (kind, account_id, match_words) values ('card', $1, 'verify card') returning id`, [cardGl])).id;

      // A payment of 2,000.00 with 400.00 interest: three legs that balance.
      const posted = await one(`select acc_post_bank_loan_payment($1, $2, 40000) as r`, [l1, reg]);
      check("it returns the principal it worked out", posted.r.principal_minor === 160000 && posted.r.interest_minor === 40000, JSON.stringify(posted.r));
      const legs = await legsOf(posted.r.entry_number);
      const leg = (id) => legs.find((l) => l.account_id === id);
      check("principal debits the loan", leg(loanGl)?.dr === 160000 && leg(loanGl)?.memo === "Principal", JSON.stringify(legs));
      check("interest debits the interest account", leg(interestGl)?.dr === 40000 && leg(interestGl)?.memo === "Interest", JSON.stringify(legs));
      check("the payment credits the bank", leg(gl)?.cr === 200000, JSON.stringify(legs));
      check("three legs and no more", legs.length === 3, String(legs.length));
      const entry = await one(`select description, source_type::text, source_id from acc_journal_entry where entry_number = $1`, [posted.r.entry_number]);
      check("the entry says it is a loan payment, posted from the bank", entry.description === "VERIFY LOAN PMT 1 — loan payment" && entry.source_type === "bank" && entry.source_id === null, JSON.stringify(entry));
      const status1 = await one(`select status from acc_bank_transaction where id = $1`, [l1]);
      check("the line is matched", status1.status === "matched", status1.status);

      // Zero interest, and interest equal to the payment, each leave out a leg.
      const zero = await one(`select acc_post_bank_loan_payment($1, $2, 0) as r`, [l2, reg]);
      const zeroLegs = await legsOf(zero.r.entry_number);
      check("no interest posts two legs: loan and bank", zeroLegs.length === 2 && !zeroLegs.some((l) => l.account_id === interestGl), JSON.stringify(zeroLegs));
      const all = await one(`select acc_post_bank_loan_payment($1, $2, 200000) as r`, [l3, reg]);
      const allLegs = await legsOf(all.r.entry_number);
      check("all interest posts two legs: interest and bank", allLegs.length === 2 && !allLegs.some((l) => l.account_id === loanGl), JSON.stringify(allLegs));

      // Change takes a loan payment back and the line waits again.
      await one(`select acc_uncategorise_bank_transaction($1, 'verify') as n`, [l1]);
      const back = await one(`select status from acc_bank_transaction where id = $1`, [l1]);
      const voided = await one(`select status::text from acc_journal_entry where entry_number = $1`, [posted.r.entry_number]);
      check("Change takes a loan payment back", back.status === "unmatched" && voided.status === "void", `${back.status} / ${voided.status}`);

      const expectRefusal = async (label, sql, params, pattern) => {
        const message = await refused(sql, params);
        check(label, pattern.test(message ?? ""), message ?? "accepted");
      };
      const post = `select acc_post_bank_loan_payment($1, $2, $3)`;
      await expectRefusal("interest above the payment is refused", post, [l1, reg, 200001], /between 0 and the payment/);
      await expectRefusal("interest below zero is refused", post, [l1, reg, -1], /between 0 and the payment/);
      await expectRefusal("money in is refused", post, [lIn, reg, 0], /money out/);
      await expectRefusal("a card entry is refused", post, [l1, cardReg, 0], /switched on in Cards and loans/);
      await expectRefusal("a pending line is refused", post, [lPending, reg, 0], /still be waiting/);
      await expectRefusal("a line already posted is refused", post, [l2, reg, 0], /still be waiting/);
      await client.query(`update acc_repayment_account set interest_account_id = $1 where id = $2`, [loanGl, reg]);
      await expectRefusal("an interest account that is not an expense is refused", post, [l1, reg, 0], /interest account must be/);
      await client.query(`update acc_repayment_account set interest_account_id = $1, is_active = false where id = $2`, [interestGl, reg]);
      await expectRefusal("a switched-off loan is refused", post, [l1, reg, 0], /switched on in Cards and loans/);
      await client.query(`update acc_repayment_account set is_active = true where id = $1`, [reg]);
      const other = await one(`select code from acc_currency where not is_base order by code limit 1`);
      if (other) {
        await client.query("reset role");
        await client.query("savepoint fxtest");
        try {
          const fxGl = await account("ZZ-VERIFY-LF", "Verify foreign bank", "bank", other.code);
          const fxBank = (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify FX', $2) returning id`, [fxGl, other.code])).id;
          const fxLine = (await one(
            `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, source)
             values ($1, current_date, 'VERIFY LOAN FX', -200000, md5(random()::text || clock_timestamp()::text), 'file_upload') returning id`,
            [fxBank],
          )).id;
          await client.query("release savepoint fxtest");
          await client.query("set local role authenticated");
          await as(admin.id);
          await expectRefusal("a foreign-currency bank is refused", post, [fxLine, reg, 0], /only from a bank account in/);
        } catch (error) {
          await client.query("rollback to savepoint fxtest");
          if (error.constraint === "acc_usd_currency_check") {
            console.log("  (bank accounts must be in base currency; the foreign-bank refusal is not exercised)");
          } else {
            throw error;
          }
        }
      } else {
        console.log("  (only the base currency exists; the foreign-bank refusal is not exercised)");
      }
      await as(OUTSIDER);
      await expectRefusal("someone who is not staff is refused", post, [l1, reg, 0], /Not authorized/);
      await as(admin.id);
      await client.query("reset role");
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
