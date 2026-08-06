/**
 * Behavioural verification of acc_import_transactions.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0100 is
 * applied, real entries are posted into a real company, and none of it survives.
 * That is what makes this safe to run against a database holding real books.
 *
 * The RPC authorises through acc_is_staff(), so the transaction sets an admin's
 * id as the JWT subject the way PostgREST would.
 *
 * Run: node --env-file=.env.local scripts/verify-import-transactions.mjs
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** The project root, resolved the way that works on Windows too. */
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
});

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

/** Run a case inside a savepoint that is always rolled back to its start. */
async function scenario(name, body) {
  console.log(`\n== ${name}`);
  await client.query("savepoint case_start");
  try {
    await body();
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  scenario threw — ${error.message}`);
  } finally {
    await client.query("rollback to savepoint case_start");
  }
}

/** Attempt a call and return the refusal message, or null when it succeeded. */
async function attempt(sql, params) {
  try {
    await client.query(sql, params);
    return null;
  } catch (error) {
    await client.query("rollback to savepoint before_call");
    return error.message;
  }
}

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0100_import_transactions.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0100 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  const asAdmin = () =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin.id, role: "authenticated" }),
    ]);
  await asAdmin();

  // A bank account that actually has a bank record: the import refuses any
  // other, because the bank line's unique hash is the only dedupe there is.
  const bank = await one(
    `select a.id, a.account_code, a.name from acc_account a
       join acc_bank_account b on b.account_id = a.id
      where a.is_posting_account and a.status = 'active'
      order by a.account_code limit 1`,
  );
  const expense = await one(
    `select id, account_code, name from acc_account
      where account_type = 'expense' and is_posting_account and status = 'active'
      order by account_code limit 1`,
  );
  if (!bank || !expense) throw new Error("need a bank and an expense account to post between");

  const rows = (hash) =>
    JSON.stringify([
      {
        txn_date: "2026-03-15",
        description: "Imported verification",
        bank_account: bank.account_code,
        category_account: expense.name,
        signed_minor: -12345,
        raw_hash: hash,
      },
    ]);

  await scenario("a row posts an entry and a matched bank line", async () => {
    const result = await one(`select acc_import_transactions($1::jsonb, $2) as out`, [
      rows("verify-hash-1"),
      bank.id,
    ]);
    check("one row imported", result.out.imported === 1, JSON.stringify(result.out));

    const entry = await one(
      `select e.id, e.status,
              (select sum(debit_minor) from acc_journal_line where journal_entry_id = e.id) as debit,
              (select sum(credit_minor) from acc_journal_line where journal_entry_id = e.id) as credit
         from acc_journal_entry e
        where e.source_type = 'bank' and e.entry_date = '2026-03-15'
        order by e.posted_at desc limit 1`,
    );
    check("the entry posted", entry?.status === "posted");
    check(
      "and it balances",
      String(entry.debit) === String(entry.credit),
      `${entry.debit}/${entry.credit}`,
    );
    check("money out debits the category", String(entry.debit) === "12345", String(entry.debit));

    const txn = await one(
      `select id, status, amount_minor from acc_bank_transaction where raw_hash = $1`,
      ["verify-hash-1"],
    );
    check("a bank line was written", Boolean(txn));
    check("the bank line is matched", txn?.status === "matched", txn?.status);
    check("it carries the signed amount", Number(txn.amount_minor) === -12345);
    const link = await one(
      `select 1 as ok from acc_reconciliation
        where bank_transaction_id = $1 and status = 'approved'`,
      [txn.id],
    );
    check("the bank line points at the entry", Boolean(link));
  });

  await scenario("importing the same file twice changes nothing", async () => {
    await client.query(`select acc_import_transactions($1::jsonb, $2)`, [
      rows("verify-hash-2"),
      bank.id,
    ]);
    const before = await one(`select count(*)::int as n from acc_journal_entry`);
    const again = await one(`select acc_import_transactions($1::jsonb, $2) as out`, [
      rows("verify-hash-2"),
      bank.id,
    ]);
    const after = await one(`select count(*)::int as n from acc_journal_entry`);
    check("the second run skipped it", again.out.skipped === 1, JSON.stringify(again.out));
    check("no new entry was posted", before.n === after.n, `${before.n} -> ${after.n}`);
  });

  await scenario("an account the chart does not have refuses the call", async () => {
    await client.query("savepoint before_call");
    const refusal = await attempt(`select acc_import_transactions($1::jsonb, $2)`, [
      JSON.stringify([
        {
          txn_date: "2026-03-16",
          description: "Unknown category",
          bank_account: bank.account_code,
          category_account: "No Such Account Anywhere",
          signed_minor: -100,
          raw_hash: "verify-hash-3",
        },
      ]),
      bank.id,
    ]);
    check("it is refused", /Account not found/i.test(refusal ?? ""), refusal ?? "none");
    const leftover = await one(
      `select count(*)::int as n from acc_bank_transaction where raw_hash = $1`,
      ["verify-hash-3"],
    );
    check("and nothing was written", leftover.n === 0);
  });

  await scenario("an account with no bank record refuses the call", async () => {
    const unbanked = await one(
      `select a.id, a.account_code from acc_account a
        where a.account_type = 'bank' and a.is_posting_account and a.status = 'active'
          and not exists (select 1 from acc_bank_account b where b.account_id = a.id)
        limit 1`,
    );
    if (!unbanked) {
      console.log("  SKIP  every bank account here already has a bank record");
      return;
    }
    await client.query("savepoint before_call");
    const refusal = await attempt(`select acc_import_transactions($1::jsonb, $2)`, [
      JSON.stringify([
        {
          txn_date: "2026-03-17",
          description: "No bank record",
          bank_account: unbanked.account_code,
          category_account: expense.name,
          signed_minor: -100,
          raw_hash: "verify-hash-5",
        },
      ]),
      unbanked.id,
    ]);
    check("it is refused", /No bank record/i.test(refusal ?? ""), refusal ?? "none");
  });

  await scenario("a viewer cannot import", async () => {
    const viewer = await one(
      `select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`,
    );
    if (!viewer) {
      console.log("  SKIP  no active viewer to authenticate as");
      return;
    }
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: viewer.id, role: "authenticated" }),
    ]);
    await client.query("savepoint before_call");
    const refusal = await attempt(`select acc_import_transactions($1::jsonb, $2)`, [
      rows("verify-hash-4"),
      bank.id,
    ]);
    check("it is refused", /Not authorized/i.test(refusal ?? ""), refusal ?? "none");
    await asAdmin();
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no entry and no bank line was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
