/**
 * Behavioural verification of categorising a bank line (0111).
 *
 * Everything happens inside ONE transaction that is always rolled back: 0111 is
 * applied, real entries are posted into a real company and taken back again,
 * and none of it survives.
 *
 * What it has to prove is that the register and the ledger say the same thing
 * afterwards. A line marked matched against an entry that does not exist, or an
 * entry with no line pointing at it, is a discrepancy nobody would see until a
 * reconciliation months later — so every scenario checks both sides.
 *
 * Run: node --env-file=.env.local scripts/verify-categorise-bank.mjs
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
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

async function attempt(sql, params) {
  await client.query("savepoint before_call");
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
  await client.query(
    await readFile(
      join(projectRoot, "supabase", "migrations", "0111_categorise_bank_transaction.sql"),
      "utf8",
    ),
  );
  console.log("Applied 0111 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  const asAdmin = () =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin.id, role: "authenticated" }),
    ]);
  await asAdmin();

  const feed = await one(
    `select b.id, b.account_id from acc_bank_account b
       join acc_account a on a.id = b.account_id
      where a.status = 'active' order by b.created_at limit 1`,
  );
  const expense = await one(
    `select id, account_code, name from acc_account
      where account_type = 'expense' and is_posting_account and status = 'active'
      order by account_code limit 1`,
  );
  if (!feed || !expense) throw new Error("need a bank account and an expense account");

  /** One unmatched line, the way a statement import leaves it. */
  const newLine = async (tag, amount = -12345) => {
    const row = await one(
      `insert into acc_bank_transaction
         (bank_account_id, txn_date, description, amount_minor, raw_hash, status, source)
       values ($1, '2026-07-15', $2, $3, $4, 'unmatched', 'file_upload')
       returning id`,
      [feed.id, `Categorise probe ${tag}`, amount, createHash("sha256").update(tag).digest("hex")],
    );
    return row.id;
  };

  const ledger = async (accountId) =>
    (
      await one(
        `select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint as net
           from acc_journal_line l
           join acc_journal_entry e on e.id = l.journal_entry_id
          where l.account_id = $1 and e.status = 'posted'`,
        [accountId],
      )
    ).net;

  await scenario("categorising posts the entry and matches the line", async () => {
    const bankBefore = await ledger(feed.account_id);
    const expenseBefore = await ledger(expense.id);
    const id = await newLine("a");

    const out = await one(`select acc_categorise_bank_transaction($1, $2) as r`, [id, expense.id]);
    check("it returns the entry it posted", typeof out.r.entry_number === "string",
      JSON.stringify(out.r));
    check("and the account it used", out.r.account_code === expense.account_code, out.r.account_code);

    const line = await one(`select status from acc_bank_transaction where id = $1`, [id]);
    check("the line is matched", line.status === "matched", line.status);

    const rec = await one(
      `select count(*)::int n from acc_reconciliation where bank_transaction_id = $1`, [id]);
    check("and points at the entry", rec.n === 1, String(rec.n));

    // Money out of the bank, into the expense: −123.45 on one side, +123.45 on
    // the other, and the two sides are the whole of the entry.
    check("the bank fell by the amount",
      BigInt(await ledger(feed.account_id)) === BigInt(bankBefore) - 12345n,
      `${bankBefore} -> ${await ledger(feed.account_id)}`);
    check("the expense rose by the amount",
      BigInt(await ledger(expense.id)) === BigInt(expenseBefore) + 12345n,
      `${expenseBefore} -> ${await ledger(expense.id)}`);
  });

  await scenario("money coming in posts the other way round", async () => {
    const bankBefore = await ledger(feed.account_id);
    const id = await newLine("b", 50_000);

    await client.query(`select acc_categorise_bank_transaction($1, $2)`, [id, expense.id]);

    check("the bank rose by the amount",
      BigInt(await ledger(feed.account_id)) === BigInt(bankBefore) + 50000n,
      `${bankBefore} -> ${await ledger(feed.account_id)}`);
  });

  await scenario("the screen can read back what a line was posted to", async () => {
    const id = await newLine("c");
    await client.query(`select acc_categorise_bank_transaction($1, $2)`, [id, expense.id]);

    const seen = await one(
      `select * from acc_bank_transaction_postings($1) where bank_transaction_id = $2`,
      [feed.id, id]);
    check("it names the account, not the bank", seen?.account_id === expense.id, seen?.account_code);
    check("with the entry number", typeof seen?.entry_number === "string", seen?.entry_number);
    check("and says this screen may take it back", seen?.own_entry === true, String(seen?.own_entry));
  });

  await scenario("a suggested match is not a posting", async () => {
    // The matcher's opinion that a line might already be in the books is not
    // the books saying so. Counted as a posting, it hid the control on every
    // line that had one — ten of the eleven a reader could not categorise, and
    // this harness passed the whole time because it only ever made approved
    // ones.
    const id = await newLine("s");
    const anyLine = await one(
      `select l.id from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
        where e.status = 'posted' limit 1`);
    await client.query(
      `insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
       values ($1, $2, 'suggested', 0.800)`, [id, anyLine.id]);

    const seen = await one(
      `select count(*)::int n from acc_bank_transaction_postings(null)
        where bank_transaction_id = $1`, [id]);
    check("it is not reported as posted", seen.n === 0, String(seen.n));
  });

  await scenario("undo voids the entry and frees the line", async () => {
    const bankBefore = await ledger(feed.account_id);
    const expenseBefore = await ledger(expense.id);
    const id = await newLine("d");
    await client.query(`select acc_categorise_bank_transaction($1, $2)`, [id, expense.id]);

    const voided = await one(
      `select acc_uncategorise_bank_transaction($1, 'Wrong account') as n`, [id]);
    check("one entry voided", voided.n === 1, String(voided.n));

    const line = await one(`select status from acc_bank_transaction where id = $1`, [id]);
    check("the line is awaiting review again", line.status === "unmatched", line.status);
    const rec = await one(
      `select count(*)::int n from acc_reconciliation where bank_transaction_id = $1`, [id]);
    check("and points at nothing", rec.n === 0, String(rec.n));

    check("the bank is back where it was",
      BigInt(await ledger(feed.account_id)) === BigInt(bankBefore),
      `${bankBefore} -> ${await ledger(feed.account_id)}`);
    check("so is the expense",
      BigInt(await ledger(expense.id)) === BigInt(expenseBefore),
      `${expenseBefore} -> ${await ledger(expense.id)}`);

    const logged = await one(
      `select count(*)::int n from acc_audit_log
        where table_name = 'acc_bank_transaction' and record_id = $1 and action = 'uncategorise'`,
      [id]);
    check("the undo is in the audit log", logged.n === 1, String(logged.n));

    // And it can be categorised again, which is the point of undoing it.
    const again = await attempt(`select acc_categorise_bank_transaction($1, $2)`, [id, expense.id]);
    check("the line can be categorised again", again === null, again ?? "");
  });

  await scenario("a line already matched is refused", async () => {
    const id = await newLine("e");
    await client.query(`select acc_categorise_bank_transaction($1, $2)`, [id, expense.id]);

    const refusal = await attempt(`select acc_categorise_bank_transaction($1, $2)`, [id, expense.id]);
    check("it is refused", /already matched/i.test(refusal ?? ""), refusal ?? "none");
  });

  await scenario("the bank account itself is refused", async () => {
    const id = await newLine("f");
    const refusal = await attempt(`select acc_categorise_bank_transaction($1, $2)`,
      [id, feed.account_id]);
    check("it is refused", /already sits in/i.test(refusal ?? ""), refusal ?? "none");
  });

  await scenario("a heading, or an account nobody may post to, is refused", async () => {
    const heading = await one(
      `select id from acc_account where not is_posting_account limit 1`);
    if (!heading) {
      console.log("  SKIP  this chart has no non-posting account");
      return;
    }
    const id = await newLine("g");
    const refusal = await attempt(`select acc_categorise_bank_transaction($1, $2)`,
      [id, heading.id]);
    check("it is refused", /cannot be posted/i.test(refusal ?? ""), refusal ?? "none");
  });

  await scenario("an entry something else owns is not undone from here", async () => {
    const id = await newLine("h");
    await client.query(`select acc_categorise_bank_transaction($1, $2)`, [id, expense.id]);
    // Pretend a payment owns it, the way settling an invoice would.
    await client.query(
      `update acc_journal_entry set source_type = 'payment'
        where id = (select l.journal_entry_id from acc_reconciliation r
                      join acc_journal_line l on l.id = r.journal_line_id
                     where r.bank_transaction_id = $1)`, [id]);

    const refusal = await attempt(`select acc_uncategorise_bank_transaction($1)`, [id]);
    check("it is refused", /owns its entry/i.test(refusal ?? ""), refusal ?? "none");
    const line = await one(`select status from acc_bank_transaction where id = $1`, [id]);
    check("and the line is untouched", line.status === "matched", line.status);
  });

  await scenario("a viewer can do neither", async () => {
    const viewer = await one(
      `select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`);
    if (!viewer) {
      console.log("  SKIP  no active viewer to authenticate as");
      return;
    }
    const id = await newLine("i");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: viewer.id, role: "authenticated" }),
    ]);
    const refusal = await attempt(`select acc_categorise_bank_transaction($1, $2)`, [id, expense.id]);
    check("categorising is refused", /Not authorized/i.test(refusal ?? ""), refusal ?? "none");
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
