/**
 * Behavioural verification of the accounts the transaction list reports.
 *
 * The filter on the screen is only as good as this column. If a split entry
 * comes back without one of the accounts it touched, a reviewer filtering on
 * that account gets a list with the entry missing and no sign anything was left
 * out — the failure this whole change exists to prevent.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0105 is
 * applied, real entries are posted into a real company, and none of it survives.
 *
 * Run: node --env-file=.env.local scripts/verify-transaction-filters.mjs
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

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

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0105_transaction_list_accounts.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0105 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: admin.id, role: "authenticated" }),
  ]);

  const currency = (await one(`select code from acc_currency where is_base limit 1`)).code;
  const pick = async (type) =>
    one(
      `select id, name from acc_account
        where account_type = $1 and is_posting_account and status = 'active'
        order by account_code limit 1`,
      [type],
    );
  const bank = await pick("bank");
  const expense = await pick("expense");
  const other = await one(
    `select id, name from acc_account
      where account_type = 'expense' and is_posting_account and status = 'active'
      order by account_code offset 1 limit 1`,
  );
  const third = await one(
    `select id, name from acc_account
      where account_type in ('expense', 'other_expense') and is_posting_account
        and status = 'active' order by account_code offset 2 limit 1`,
  );
  if (!bank || !expense || !other || !third) {
    throw new Error("need a bank and three expense accounts to build a split");
  }

  const line = (id, debit, credit) =>
    JSON.stringify({
      account_id: id,
      debit_minor: debit,
      credit_minor: credit,
      amount_base_minor: debit || credit,
      memo: "Filter verification",
    });
  const post = (date, description, lines) =>
    one(`select acc_post_entry($1::date, $2, 'manual', null, $3, $4::jsonb) as id`, [
      date,
      description,
      currency,
      `[${lines.join(",")}]`,
    ]);

  const DATE = "2026-07-21";
  const listed = async (entryId) =>
    one(
      `select account_ids, category_label, money_label
         from acc_transaction_list($1::date, $1::date) where entry_id = $2`,
      [DATE, entryId],
    );

  await scenario("a two-account entry reports both accounts", async () => {
    const entry = await post(DATE, "Simple bank charge", [
      line(expense.id, 5000, 0),
      line(bank.id, 0, 5000),
    ]);
    const row = await listed(entry.id);
    check("the report returned it", Boolean(row));
    const ids = row.account_ids ?? [];
    check("it names the expense account", ids.includes(expense.id), JSON.stringify(ids));
    check("and the bank account", ids.includes(bank.id));
    check("exactly two, without duplicates", ids.length === 2, String(ids.length));
  });

  await scenario("a split entry reports every account it touched", async () => {
    const entry = await post(DATE, "Monthly overheads", [
      line(expense.id, 3000, 0),
      line(other.id, 2000, 0),
      line(third.id, 1000, 0),
      line(bank.id, 0, 6000),
    ]);
    const row = await listed(entry.id);
    const ids = row.account_ids ?? [];
    check(
      "the label really does read Split",
      row.category_label === "— Split —",
      String(row.category_label),
    );
    // This is the whole point: the label hides the accounts, the column does not.
    for (const account of [expense, other, third, bank]) {
      check(`it still names ${account.name.slice(0, 28)}`, ids.includes(account.id));
    }
    check("four accounts, no more", ids.length === 4, String(ids.length));
  });

  await scenario("an entry outside the range is not returned at all", async () => {
    const entry = await post("2026-07-02", "Out of range", [
      line(expense.id, 100, 0),
      line(bank.id, 0, 100),
    ]);
    const row = await listed(entry.id);
    check("nothing came back for it", !row);
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no entry was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
