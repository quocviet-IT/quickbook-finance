/**
 * Behavioural verification of the statement-import undo (0109).
 *
 * Everything happens inside ONE transaction that is always rolled back: 0109 is
 * applied, real statement lines are imported into a real company and taken back
 * again, and none of it survives.
 *
 * The refusal is the part worth proving. A bank line that has been matched is
 * cited by a journal entry; deleting it would leave that entry pointing at a
 * transaction that no longer exists, and no count anywhere would look wrong.
 *
 * Run: node --env-file=.env.local scripts/verify-undo-bank-statement.mjs
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
      join(projectRoot, "supabase", "migrations", "0109_undo_bank_statement_import.sql"),
      "utf8",
    ),
  );
  console.log("Applied 0109 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  const asAdmin = () =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin.id, role: "authenticated" }),
    ]);
  await asAdmin();

  const feed = await one(`select id, account_id from acc_bank_account order by created_at limit 1`);
  if (!feed) throw new Error("this company has no bank account to import into");

  /** Import three lines the way the screen does, and return the batch. */
  const importThree = async (tag) => {
    const rows = [1, 2, 3].map((n) => ({
      txn_date: `2026-05-0${n}`,
      description: `Statement line ${n}`,
      reference: null,
      amount_minor: -100 * n,
      running_balance_minor: null,
      raw_line: `${tag}-${n}`,
      raw_hash: createHash("sha256").update(`${tag}-${n}`).digest("hex"),
      source: "file_upload",
    }));
    // It returns a row, not a scalar: (inserted, skipped, batch_id).
    const result = await one(
      `select * from acc_import_bank_statement($1, $2, $3::jsonb)`,
      [feed.id, `${tag}.csv`, JSON.stringify(rows)],
    );
    return { inserted: Number(result.inserted ?? 0), batchId: result.batch_id };
  };

  await scenario("undo removes every line of the import", async () => {
    const before = await one(`select count(*)::int n from acc_bank_transaction`);
    const { inserted, batchId } = await importThree("vfy-undo");
    check("three lines imported", inserted === 3, String(inserted));

    const removed = await one(
      `select acc_undo_bank_statement_import($1, 'Wrong bank account') as n`, [batchId]);
    check("three lines removed", removed.n === 3, String(removed.n));

    const after = await one(`select count(*)::int n from acc_bank_transaction`);
    check("the register is back where it was", after.n === before.n, `${before.n} vs ${after.n}`);

    const batch = await one(`select * from acc_bank_import_batch where id = $1`, [batchId]);
    check("the batch is kept, marked undone", batch?.status === "voided", batch?.status);
    check("with the reason", batch?.void_reason === "Wrong bank account", batch?.void_reason);
    check("and who did it", batch?.voided_by === admin.id, batch?.voided_by);

    const logged = await one(
      `select count(*)::int n from acc_audit_log
        where table_name = 'acc_bank_import_batch' and record_id = $1 and action = 'undo'`,
      [batchId]);
    check("it is in the audit log", logged.n === 1, String(logged.n));
  });

  await scenario("an import cannot be undone twice", async () => {
    const { batchId } = await importThree("vfy-twice");
    await client.query(`select acc_undo_bank_statement_import($1, 'First time')`, [batchId]);
    const refusal = await attempt(`select acc_undo_bank_statement_import($1, 'Again')`, [batchId]);
    check("the second attempt is refused", /already undone/i.test(refusal ?? ""), refusal ?? "none");
  });

  await scenario("a matched line stops the undo, and says how many", async () => {
    const { batchId } = await importThree("vfy-matched");
    const line = await one(
      `select id from acc_bank_transaction where import_batch_id = $1 order by txn_date limit 1`,
      [batchId]);
    await client.query(
      `update acc_bank_transaction set status = 'matched' where id = $1`, [line.id]);

    const locked = await one(`select acc_bank_import_batch_locked_lines($1) as n`, [batchId]);
    check("the screen can see it coming", locked.n === 1, String(locked.n));

    const refusal = await attempt(
      `select acc_undo_bank_statement_import($1, 'Wrong bank account')`, [batchId]);
    check("the undo is refused", /already been matched/i.test(refusal ?? ""), refusal ?? "none");
    check("and it counts them", /^1 line/.test(refusal ?? ""), refusal ?? "none");

    const still = await one(
      `select count(*)::int n from acc_bank_transaction where import_batch_id = $1`, [batchId]);
    check("nothing was removed", still.n === 3, String(still.n));
  });

  await scenario("one stray line can be deleted on its own", async () => {
    const { batchId } = await importThree("vfy-single");
    const line = await one(
      `select id from acc_bank_transaction where import_batch_id = $1 order by txn_date limit 1`,
      [batchId]);

    const short = await attempt(`select acc_delete_bank_transaction($1, 'oops')`, [line.id]);
    check("a one-word reason is refused", /in a sentence/i.test(short ?? ""), short ?? "none");

    await client.query(
      `select acc_delete_bank_transaction($1, 'Duplicated by the bank feed')`, [line.id]);
    const left = await one(
      `select count(*)::int n from acc_bank_transaction where import_batch_id = $1`, [batchId]);
    check("only that line went", left.n === 2, String(left.n));

    const logged = await one(
      `select count(*)::int n from acc_audit_log
        where table_name = 'acc_bank_transaction' and record_id = $1 and action = 'delete'`,
      [line.id]);
    check("the deletion is in the audit log", logged.n === 1, String(logged.n));
  });

  await scenario("a reconciled line cannot be deleted", async () => {
    const { batchId } = await importThree("vfy-recon");
    const line = await one(
      `select id from acc_bank_transaction where import_batch_id = $1 order by txn_date limit 1`,
      [batchId]);
    const glLine = await one(
      `select l.id from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
        where e.status = 'posted' limit 1`);
    if (!glLine) {
      console.log("  SKIP  no posted journal line to match against");
      return;
    }
    await client.query(
      `insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
       values ($1, $2, 'approved', 1.000)`, [line.id, glLine.id]);

    const refusal = await attempt(
      `select acc_delete_bank_transaction($1, 'Trying to remove a matched line')`, [line.id]);
    check("it is refused", /Reject the match first/i.test(refusal ?? ""), refusal ?? "none");

    const still = await one(`select count(*)::int n from acc_bank_transaction where id = $1`, [line.id]);
    check("the line is still there", still.n === 1, String(still.n));
  });

  await scenario("a viewer can do neither", async () => {
    const viewer = await one(
      `select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`);
    if (!viewer) {
      console.log("  SKIP  no active viewer to authenticate as");
      return;
    }
    const { batchId } = await importThree("vfy-viewer");
    const line = await one(
      `select id from acc_bank_transaction where import_batch_id = $1 limit 1`, [batchId]);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: viewer.id, role: "authenticated" }),
    ]);
    const undo = await attempt(`select acc_undo_bank_statement_import($1, 'Trying it on')`, [batchId]);
    check("undo is refused", /Not authorized/i.test(undo ?? ""), undo ?? "none");
    const del = await attempt(
      `select acc_delete_bank_transaction($1, 'Trying it on for size')`, [line.id]);
    check("delete is refused", /Not authorized/i.test(del ?? ""), del ?? "none");
    await asAdmin();
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no import and no bank line was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
