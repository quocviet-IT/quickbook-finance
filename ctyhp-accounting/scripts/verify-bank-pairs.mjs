/**
 * Behavioural verification of migration 0127 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0127 has not been applied it is applied first, inside that transaction,
 * and every account, bank account and bank line the checks need is made there
 * too — so nothing is left behind, and the real books are the ground it runs on.
 *
 * Run: node --env-file=.env.local scripts/verify-bank-pairs.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0127_bank_pairs.sql";
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
const status = async (id) => (await one(`select status from acc_bank_transaction where id = $1`, [id]))?.status;

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
        console.log("  (0127 applied inside the transaction, never committed)");
      }
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      // Made here, rolled back with everything else.
      const account = async (code, name, type) =>
        (await one(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ($1, $2, $3, $4, true) returning id`,
          [code, name, type, base.code],
        )).id;
      const glA = await account("ZZ-VERIFY-BA", "Verify checking", "bank");
      const glB = await account("ZZ-VERIFY-BB", "Verify savings", "bank");
      const loan = await account("ZZ-VERIFY-SL", "Verify shareholder loan", "current_liability");
      const bank = async (gl, name) =>
        (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, $2, $3) returning id`, [gl, name, base.code])).id;
      const A = await bank(glA, "Verify Bank A");
      const B = await bank(glB, "Verify Bank B");
      const lineOn = async (bankId, amountMinor, description, daysAgo = 0) =>
        (await one(
          `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, source)
           values ($1, current_date - $2::int, $3, $4, md5(random()::text || clock_timestamp()::text), 'file_upload') returning id`,
          [bankId, daysAgo, description, amountMinor],
        )).id;
      const t1 = await lineOn(A, -100000, "ONLINE TRANSFER TO SAVINGS");
      const t2 = await lineOn(B, 100000, "ONLINE TRANSFER FROM CHECKING");
      const t3 = await lineOn(A, 500000, "WIRE TYPE:BOOK IN");
      const t4 = await lineOn(A, -500000, "CHECK 1303");
      const t5 = await lineOn(A, -100, "VERIFY ODD");
      const t6 = await lineOn(A, 700, "VERIFY IN");
      const t7 = await lineOn(A, -700, "VERIFY OUT");
      const t8 = await lineOn(A, 900, "VERIFY OLD IN", 30);
      const t9 = await lineOn(B, -900, "VERIFY NEW OUT");
      await client.query(
        `insert into acc_banking_preference (singleton, funding_account_id, pair_window_days) values (true, $1, 7)
         on conflict (singleton) do update set funding_account_id = excluded.funding_account_id, pair_window_days = 7`,
        [loan],
      );

      await client.query("set local role authenticated");
      await as(admin.id);

      // A transfer: one entry, two bank legs, both lines matched to their own leg.
      const transfer = await one(`select acc_post_bank_pair($1, $2, 'transfer') as r`, [t1, t2]);
      const transferEntries = transfer.r.entries ?? [];
      check("a transfer makes one entry", transferEntries.length === 1, JSON.stringify(transfer.r));
      const legs = (
        await client.query(
          `select l.account_id from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
            where e.entry_number = $1 order by l.account_id`,
          [transferEntries[0]],
        )
      ).rows.map((r) => r.account_id);
      check("its two legs are the two bank accounts", legs.length === 2 && legs.includes(glA) && legs.includes(glB), legs.join(","));
      const recs = (await one(`select count(*)::int n from acc_reconciliation where bank_transaction_id in ($1, $2) and status = 'approved'`, [t1, t2])).n;
      check("both lines are matched to it", recs === 2 && (await status(t1)) === "matched" && (await status(t2)) === "matched", String(recs));

      // Change on one side takes the whole transfer back.
      await client.query(`select acc_uncategorise_bank_transaction($1, 'verify')`, [t2]);
      const left = (await one(`select count(*)::int n from acc_reconciliation where bank_transaction_id in ($1, $2)`, [t1, t2])).n;
      check("Change on one side releases both lines", left === 0 && (await status(t1)) === "unmatched" && (await status(t2)) === "unmatched", String(left));
      const voided = (await one(`select status from acc_journal_entry where entry_number = $1`, [transferEntries[0]])).status;
      check("and voids the transfer entry", voided === "void", voided);

      // Funding: two entries on the preference's account, each naming the other line.
      const funding = await one(`select acc_post_bank_pair($1, $2, 'funding') as r`, [t4, t3]);
      const fundingEntries = funding.r.entries ?? [];
      check("a funding pair makes two entries", fundingEntries.length === 2, JSON.stringify(funding.r));
      const described = (
        await client.query(`select description from acc_journal_entry where entry_number = any($1::text[])`, [fundingEntries])
      ).rows.map((r) => r.description);
      check(
        "each says what answered it",
        described.some((d) => d.startsWith("CHECK 1303, answered by WIRE TYPE:BOOK IN on")) &&
          described.some((d) => d.startsWith("WIRE TYPE:BOOK IN, answered by CHECK 1303 on")),
        described.join(" | "),
      );
      const onLoan = (
        await one(
          `select count(*)::int n from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
            where e.entry_number = any($1::text[]) and l.account_id = $2`,
          [fundingEntries, loan],
        )
      ).n;
      check("both post to the funding account", onLoan === 2, String(onLoan));

      // Refusals.
      const expectRefusal = async (label, sql, params, pattern) => {
        const message = await refused(sql, params);
        check(label, pattern.test(message ?? ""), message ?? "accepted");
      };
      await expectRefusal("one line twice is refused", `select acc_post_bank_pair($1, $1, 'transfer')`, [t5], /two different lines/);
      await expectRefusal("a transfer within one bank account is refused", `select acc_post_bank_pair($1, $2, 'transfer')`, [t6, t7], /two different bank accounts/);
      await expectRefusal("unequal amounts are refused", `select acc_post_bank_pair($1, $2, 'funding')`, [t5, t6], /same amount/);
      await expectRefusal("lines further apart than the window are refused", `select acc_post_bank_pair($1, $2, 'transfer')`, [t8, t9], /days apart/);
      await client.query(`update acc_banking_preference set funding_account_id = null where singleton`);
      await expectRefusal("funding with no account chosen is refused", `select acc_post_bank_pair($1, $2, 'funding')`, [t6, t7], /Choose the account/);
      await as(OUTSIDER);
      await expectRefusal("someone who is not staff is refused", `select acc_post_bank_pair($1, $2, 'funding')`, [t6, t7], /Not authorized/);
      await as(admin.id);
      await client.query("reset role");

      const audited = (await one(`select count(*)::int n from acc_audit_log where table_name = 'acc_banking_preference'`)).n;
      check("changes to the preference are in the audit log", audited >= 2, String(audited));
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
