/**
 * Behavioural verification of the transactions import register (0108).
 *
 * Everything happens inside ONE transaction that is always rolled back: 0107
 * and 0108 are applied, real transactions are imported into a real company and
 * undone again, and none of it survives.
 *
 * What it has to prove is that Undo is complete. Voiding the entries is only
 * half: the bank lines carry the dedupe hash, so an undo that leaves them
 * behind would make the corrected file — the whole reason for undoing — skip
 * every row it recognises. So each scenario checks the ledger AND the bank.
 *
 * Run: node --env-file=.env.local scripts/verify-transaction-import-batches.mjs
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

const sha = (text) => createHash("sha256").update(text).digest("hex");
const counts = async () =>
  one(`select
        (select count(*)::int from acc_bank_transaction) as bank_lines,
        (select count(*)::int from acc_journal_entry where status = 'posted') as posted,
        (select count(*)::int from acc_reconciliation) as recs,
        (select count(*)::int from acc_import_batch where status = 'active') as batches`);

await client.connect();
await client.query("begin");
try {
  for (const file of ["0107_one_account_resolver.sql", "0108_transaction_import_batches.sql"]) {
    await client.query(await readFile(join(projectRoot, "supabase", "migrations", file), "utf8"));
  }
  console.log("Applied 0107 and 0108 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: admin.id, role: "authenticated" }),
  ]);

  const bank = await one(
    `select a.id, a.account_code, a.name from acc_account a
       join acc_bank_account b on b.account_id = a.id
      where a.is_posting_account and a.status = 'active'
      order by a.account_code limit 1`,
  );
  const expense = await one(
    `select id, account_code from acc_account
      where account_type = 'expense' and is_posting_account and status = 'active'
      order by account_code limit 1`,
  );
  if (!bank || !expense) throw new Error("need a bank and an expense account to post between");

  const rows = (hashes) =>
    JSON.stringify(
      hashes.map((raw_hash, index) => ({
        txn_date: "2026-04-0" + (index + 1),
        description: "Register verification",
        bank_account: bank.account_code,
        category_account: expense.account_code,
        signed_minor: -1000 - index,
        raw_hash,
      })),
    );
  const call = (hashes, name, checksum, lines) =>
    one(`select acc_import_transactions($1::jsonb, $2, $3, $4, $5) as out`, [
      rows(hashes),
      bank.id,
      name,
      checksum,
      lines,
    ]);

  await scenario("an import records what it did", async () => {
    const before = await counts();
    const result = await call(["vfy-a1", "vfy-a2"], "verify.csv", sha("verify-a"), 7);
    check("both rows imported", result.out.imported === 2, JSON.stringify(result.out));
    check("and it returns the batch", typeof result.out.batch_id === "string", JSON.stringify(result.out));

    const batch = await one(`select * from acc_import_batch where id = $1`, [result.out.batch_id]);
    check("recorded as a transactions import", batch?.source === "transactions", batch?.source);
    check("under the file's name", batch?.file_name === "verify.csv", batch?.file_name);
    check("with the rows it posted", batch?.entry_count === 2, String(batch?.entry_count));
    check("and the lines the file had", batch?.line_count === 7, String(batch?.line_count));
    check("over the dates it covers", batch?.from_date != null && batch?.to_date != null,
      `${batch?.from_date} → ${batch?.to_date}`);
    check("stamped with who imported it", batch?.imported_by === admin.id, batch?.imported_by);

    const after = await counts();
    check("two bank lines", after.bank_lines === before.bank_lines + 2, JSON.stringify(after));
    check("two entries posted", after.posted === before.posted + 2, JSON.stringify(after));

    const owned = await one(
      `select count(*)::int n from acc_bank_transaction where transaction_batch_id = $1`,
      [result.out.batch_id],
    );
    check("both bank lines know their import", owned.n === 2, String(owned.n));
  });

  await scenario("undo puts the books back, ledger and bank", async () => {
    const before = await counts();
    const result = await call(["vfy-b1", "vfy-b2"], "verify.csv", sha("verify-b"), 2);
    const batchId = result.out.batch_id;

    const voided = await one(`select acc_void_import_batch($1, 'Verification') as n`, [batchId]);
    check("both entries voided", voided.n === 2, String(voided.n));

    const after = await counts();
    check("every figure is back where it started",
      JSON.stringify(after) === JSON.stringify(before),
      `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);

    // The bank lines must be gone, not merely marked: the dedupe index is what
    // would otherwise refuse the corrected file this undo makes room for.
    const left = await one(
      `select count(*)::int n from acc_bank_transaction where transaction_batch_id = $1`, [batchId]);
    check("no bank line survives the undo", left.n === 0, String(left.n));

    const again = await call(["vfy-b1", "vfy-b2"], "verify.csv", sha("verify-b2"), 2);
    check("and the same rows import again", again.out.imported === 2, JSON.stringify(again.out));
  });

  await scenario("the same file, still live, is refused rather than silently skipped", async () => {
    const checksum = sha("verify-c");
    await call(["vfy-c1"], "verify.csv", checksum, 1);
    const refusal = await attempt(`select acc_import_transactions($1::jsonb, $2, $3, $4, $5)`, [
      rows(["vfy-c9"]),
      bank.id,
      "verify.csv",
      checksum,
      1,
    ]);
    check("it is refused", /already been imported/i.test(refusal ?? ""), refusal ?? "none");
    check("and it says what to do", /Undo that import first/i.test(refusal ?? ""), refusal ?? "none");
  });

  await scenario("an import that posts nothing leaves no batch", async () => {
    const before = await counts();
    // The same row twice: the second collides on the dedupe index and is skipped.
    await call(["vfy-d1"], "verify.csv", sha("verify-d"), 1);
    const mid = await counts();
    const second = await one(`select acc_import_transactions($1::jsonb, $2, $3, $4, $5) as out`, [
      rows(["vfy-d1"]),
      bank.id,
      "verify.csv",
      sha("verify-d-again"),
      1,
    ]);
    check("nothing imported the second time", second.out.imported === 0, JSON.stringify(second.out));
    check("and it was counted as skipped", second.out.skipped === 1, JSON.stringify(second.out));
    check("no batch was left behind", second.out.batch_id === null, JSON.stringify(second.out));
    const after = await counts();
    check("the register did not grow", after.batches === mid.batches, `${mid.batches} vs ${after.batches}`);
    check("nor did the books", after.posted === before.posted + 1, JSON.stringify(after));
  });

  await scenario("a batch needs a file name and a checksum", async () => {
    const noName = await attempt(`select acc_import_transactions($1::jsonb, $2, $3, $4, $5)`, [
      rows(["vfy-e1"]), bank.id, "   ", sha("verify-e"), 1,
    ]);
    check("a blank name is refused", /which file it came from/i.test(noName ?? ""), noName ?? "none");
    const noSum = await attempt(`select acc_import_transactions($1::jsonb, $2, $3, $4, $5)`, [
      rows(["vfy-e2"]), bank.id, "verify.csv", "not-a-checksum", 1,
    ]);
    check("a bad checksum is refused", /checksum of its file/i.test(noSum ?? ""), noSum ?? "none");
  });

  await scenario("a ledger batch keeps the bank lines it never created", async () => {
    // Undo deletes bank lines only for a transactions batch. A ledger batch
    // sharing the register must not take unrelated bank lines down with it.
    const imported = await call(["vfy-f1"], "verify.csv", sha("verify-f"), 1);
    const before = await counts();
    const ledger = await one(
      `insert into acc_import_batch
         (source, mode, file_name, sha256, entry_count, line_count, total_minor, imported_by)
       values ('wave_ledger', 'history', 'ledger.csv', $1, 0, 0, 0, $2)
       returning id`,
      [sha("verify-f-ledger"), admin.id],
    );
    await client.query(`select acc_void_import_batch($1, 'Verification')`, [ledger.id]);
    const after = await counts();
    check("the transactions batch is untouched",
      after.bank_lines === before.bank_lines, `${before.bank_lines} vs ${after.bank_lines}`);
    const still = await one(
      `select count(*)::int n from acc_bank_transaction where transaction_batch_id = $1`,
      [imported.out.batch_id]);
    check("its bank line is still there", still.n === 1, String(still.n));
  });

  await scenario("a viewer cannot undo an import", async () => {
    const viewer = await one(
      `select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`,
    );
    if (!viewer) {
      console.log("  SKIP  no active viewer to authenticate as");
      return;
    }
    const result = await call(["vfy-g1"], "verify.csv", sha("verify-g"), 1);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: viewer.id, role: "authenticated" }),
    ]);
    const refusal = await attempt(`select acc_void_import_batch($1, 'Trying it on')`, [
      result.out.batch_id,
    ]);
    check("it is refused", /Not authorized/i.test(refusal ?? ""), refusal ?? "none");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin.id, role: "authenticated" }),
    ]);
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no import, entry or bank line was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
