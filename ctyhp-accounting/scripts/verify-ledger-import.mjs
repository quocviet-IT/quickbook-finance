/**
 * Behavioural verification of the general ledger import.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0102 is
 * applied, real entries are posted into a real company, and none of it
 * survives. That is what makes this safe to run against a database holding real
 * books.
 *
 * Run: node --env-file=.env.local scripts/verify-ledger-import.mjs
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

const hash = (seed) => seed.padEnd(64, "0").slice(0, 64);

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0102_import_ledger_batches.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0102 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  const asUser = (id) =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: id, role: "authenticated" }),
    ]);
  await asUser(admin.id);

  const bank = await one(
    `select account_code, name from acc_account
      where account_type = 'bank' and is_posting_account and status = 'active'
      order by account_code limit 1`,
  );
  const expense = await one(
    `select account_code, name from acc_account
      where account_type = 'expense' and is_posting_account and status = 'active'
      order by account_code limit 1`,
  );
  if (!bank || !expense) throw new Error("need a bank and an expense account to post between");

  const entries = (day) =>
    JSON.stringify([
      {
        date: `2026-07-0${day}`,
        lines: [
          { account: expense.name, signed_minor: 25000, description: "Ledger import check" },
          { account: bank.account_code, signed_minor: -25000, description: "Ledger import check" },
        ],
      },
      {
        date: `2026-07-1${day}`,
        lines: [
          { account: expense.name, signed_minor: 1000, description: "Second day" },
          { account: bank.account_code, signed_minor: -1000, description: "Second day" },
        ],
      },
    ]);

  const importIt = (sha, mode = "history") =>
    client.query(
      `select acc_import_ledger_entries('wave_ledger', $1, 'ledger.csv', $2, $3::jsonb) as out`,
      [mode, sha, entries(1)],
    );

  await scenario("a two-entry file posts, and every entry balances", async () => {
    const result = (await importIt(hash("aaaa1111"))).rows[0].out;
    check("two entries were posted", result.entries === 2, JSON.stringify(result));
    check("four lines were written", result.lines === 4, JSON.stringify(result));

    const unbalanced = await one(
      `select be.journal_entry_id
         from acc_import_batch_entry be
         join acc_journal_line l on l.journal_entry_id = be.journal_entry_id
        where be.batch_id = $1
        group by be.journal_entry_id
       having sum(l.debit_minor) <> sum(l.credit_minor)`,
      [result.batch_id],
    );
    check("no entry is out of balance", !unbalanced);

    const posted = await one(
      `select count(*)::int as n from acc_journal_entry e
        join acc_import_batch_entry be on be.journal_entry_id = e.id
       where be.batch_id = $1 and e.status = 'posted' and e.source_type = 'manual'`,
      [result.batch_id],
    );
    check("both entries are posted as manual journals", posted.n === 2, String(posted.n));
  });

  await scenario("the same file cannot be imported twice", async () => {
    await importIt(hash("bbbb2222"));
    const before = await one(`select count(*)::int as n from acc_journal_entry`);
    await client.query("savepoint before_call");
    const refusal = await attempt(
      `select acc_import_ledger_entries('wave_ledger', 'balances', 'ledger.csv', $1, $2::jsonb)`,
      [hash("bbbb2222"), entries(2)],
    );
    const after = await one(`select count(*)::int as n from acc_journal_entry`);
    check("it is refused even in the other mode", /already imported/i.test(refusal ?? ""),
      refusal ?? "none");
    check("and nothing new was posted", before.n === after.n, `${before.n} -> ${after.n}`);
  });

  await scenario("an account the chart does not have refuses the whole file", async () => {
    const before = await one(`select count(*)::int as n from acc_journal_entry`);
    await client.query("savepoint before_call");
    const refusal = await attempt(
      `select acc_import_ledger_entries('wave_ledger', 'history', 'ledger.csv', $1, $2::jsonb)`,
      [
        hash("cccc3333"),
        JSON.stringify([
          {
            date: "2026-07-02",
            lines: [
              { account: "No Such Account Anywhere", signed_minor: 100, description: "x" },
              { account: bank.account_code, signed_minor: -100, description: "x" },
            ],
          },
        ]),
      ],
    );
    const after = await one(`select count(*)::int as n from acc_journal_entry`);
    check("it is refused", /Account not found/i.test(refusal ?? ""), refusal ?? "none");
    check("and no entry survived", before.n === after.n, `${before.n} -> ${after.n}`);
    const batches = await one(`select count(*)::int as n from acc_import_batch where sha256 = $1`, [
      hash("cccc3333"),
    ]);
    check("and no batch was left behind", batches.n === 0, String(batches.n));
  });

  await scenario("an unbalanced history entry is refused", async () => {
    await client.query("savepoint before_call");
    const refusal = await attempt(
      `select acc_import_ledger_entries('wave_ledger', 'history', 'ledger.csv', $1, $2::jsonb)`,
      [
        hash("dddd4444"),
        JSON.stringify([
          {
            date: "2026-07-03",
            lines: [
              { account: expense.name, signed_minor: 100, description: "x" },
              { account: bank.account_code, signed_minor: -60, description: "x" },
            ],
          },
        ]),
      ],
    );
    check("it is refused", /do not balance/i.test(refusal ?? ""), refusal ?? "none");
  });

  await scenario("balances mode plugs the difference to Opening Balance Equity", async () => {
    const result = (
      await client.query(
        `select acc_import_ledger_entries('wave_ledger', 'balances', 'ledger.csv', $1, $2::jsonb) as out`,
        [
          hash("eeee5555"),
          JSON.stringify([
            {
              date: "2026-07-04",
              lines: [
                { account: expense.name, signed_minor: 7000, description: "Closing balance" },
              ],
            },
          ]),
        ],
      )
    ).rows[0].out;
    const equity = await one(
      `select l.credit_minor from acc_journal_line l
         join acc_account a on a.id = l.account_id
         join acc_import_batch_entry be on be.journal_entry_id = l.journal_entry_id
        where be.batch_id = $1 and a.account_code = '3900'`,
      [result.batch_id],
    );
    check("the plug was posted", Number(equity?.credit_minor) === 7000, JSON.stringify(equity));
  });

  await scenario("undo voids every entry the import created", async () => {
    const result = (await importIt(hash("ffff6666"))).rows[0].out;
    const voided = await one(`select acc_void_import_batch($1, 'Wrong chart of accounts') as n`, [
      result.batch_id,
    ]);
    check("both entries were voided", voided.n === 2, String(voided.n));
    const stillPosted = await one(
      `select count(*)::int as n from acc_journal_entry e
        join acc_import_batch_entry be on be.journal_entry_id = e.id
       where be.batch_id = $1 and e.status = 'posted'`,
      [result.batch_id],
    );
    check("none is still posted", stillPosted.n === 0, String(stillPosted.n));
    const batch = await one(`select status, void_reason from acc_import_batch where id = $1`, [
      result.batch_id,
    ]);
    check("the batch records that it was undone", batch?.status === "voided", batch?.status);
    check("and keeps the reason", batch?.void_reason === "Wrong chart of accounts");

    await client.query("savepoint before_call");
    const again = await attempt(
      `select acc_import_ledger_entries('wave_ledger', 'history', 'ledger.csv', $1, $2::jsonb)`,
      [hash("ffff6666"), entries(1)],
    );
    check("the file can be imported again once undone", again === null, again ?? "");
  });

  await scenario("a viewer can do neither", async () => {
    const result = (await importIt(hash("77778888"))).rows[0].out;
    const viewer = await one(
      `select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`,
    );
    if (!viewer) {
      console.log("  SKIP  no active viewer to authenticate as");
      return;
    }
    await asUser(viewer.id);
    await client.query("savepoint before_call");
    const importing = await attempt(
      `select acc_import_ledger_entries('wave_ledger', 'history', 'ledger.csv', $1, $2::jsonb)`,
      [hash("99990000"), entries(1)],
    );
    check("importing is refused", /Not authorized/i.test(importing ?? ""), importing ?? "none");
    await client.query("savepoint before_call");
    const undoing = await attempt(`select acc_void_import_batch($1, 'no')`, [result.batch_id]);
    check("undoing is refused", /Not authorized/i.test(undoing ?? ""), undoing ?? "none");
    await asUser(admin.id);
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no entry and no batch was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
