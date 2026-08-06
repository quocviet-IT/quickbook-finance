/**
 * Behavioural verification of the saved report functions.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0101 is
 * applied, real rows are written into a real company, and none of it survives.
 * That is what makes this safe to run against a database holding real books.
 *
 * The point of the second scenario is the promise the feature makes: saving a
 * report must not move the ledger by so much as one entry.
 *
 * Run: node --env-file=.env.local scripts/verify-saved-reports.mjs
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

const register = (sha, title = "Wave Profit and Loss 2025") =>
  client.query(
    `select acc_register_saved_report($1, 'wave', '2025-01-01', '2025-12-31', null,
                                      'pnl.csv', $2, 'text/csv', 4096, $3) as id`,
    [title, `company/${sha}.csv`, sha],
  );

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0101_saved_reports.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0101 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  const asUser = (id) =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: id, role: "authenticated" }),
    ]);
  await asUser(admin.id);

  await scenario("a report is saved and can be read back", async () => {
    const sha = hash("aaaa1111");
    const created = (await register(sha)).rows[0];
    check("it returned an id", Boolean(created.id));
    const row = await one(`select * from acc_saved_report where id = $1`, [created.id]);
    check("the row is active", row?.status === "active", row?.status);
    check("the uploader was recorded", row?.uploaded_by === admin.id);
    check("the title was trimmed and kept", row?.title === "Wave Profit and Loss 2025");
  });

  await scenario("saving a report moves nothing in the ledger", async () => {
    const before = await one(
      `select (select count(*)::int from acc_journal_entry) as entries,
              (select count(*)::int from acc_journal_line)  as lines,
              (select count(*)::int from acc_bank_transaction) as bank`,
    );
    await register(hash("bbbb2222"));
    const after = await one(
      `select (select count(*)::int from acc_journal_entry) as entries,
              (select count(*)::int from acc_journal_line)  as lines,
              (select count(*)::int from acc_bank_transaction) as bank`,
    );
    check(
      "no journal entry appeared",
      before.entries === after.entries,
      `${before.entries} -> ${after.entries}`,
    );
    check(
      "no journal line appeared",
      before.lines === after.lines,
      `${before.lines} -> ${after.lines}`,
    );
    check(
      "no bank transaction appeared",
      before.bank === after.bank,
      `${before.bank} -> ${after.bank}`,
    );
  });

  await scenario("the same file cannot be saved twice", async () => {
    const sha = hash("cccc3333");
    await register(sha);
    await client.query("savepoint before_call");
    const refusal = await attempt(
      `select acc_register_saved_report('Second copy', 'wave', null, null, null,
                                        'pnl.csv', $1, 'text/csv', 4096, $2)`,
      [`company/second-${sha}.csv`, sha],
    );
    check("it is refused", /already saved/i.test(refusal ?? ""), refusal ?? "none");
  });

  await scenario("archiving frees the hash and keeps the record", async () => {
    const sha = hash("dddd4444");
    const created = (await register(sha)).rows[0];
    await client.query(`select acc_archive_saved_report($1, 'Replaced by a corrected export')`, [
      created.id,
    ]);
    const row = await one(`select * from acc_saved_report where id = $1`, [created.id]);
    check("the row is archived, not deleted", row?.status === "archived", row?.status);
    check("the reason was kept", row?.archive_reason === "Replaced by a corrected export");
    check("the actor was recorded", row?.archived_by === admin.id);
    await client.query("savepoint before_call");
    const again = await attempt(
      `select acc_register_saved_report('Corrected export', 'wave', null, null, null,
                                        'pnl.csv', $1, 'text/csv', 4096, $2)`,
      [`company/again-${sha}.csv`, sha],
    );
    check(
      "the same file may be saved again once the old copy is retired",
      again === null,
      again ?? "",
    );
  });

  await scenario("an archive with no reason is refused", async () => {
    const created = (await register(hash("eeee5555"))).rows[0];
    await client.query("savepoint before_call");
    const refusal = await attempt(`select acc_archive_saved_report($1, '   ')`, [created.id]);
    check(
      "it is refused",
      /why this report is being archived/i.test(refusal ?? ""),
      refusal ?? "none",
    );
  });

  await scenario("a viewer can read but cannot save or archive", async () => {
    const created = (await register(hash("ffff6666"))).rows[0];
    const viewer = await one(
      `select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`,
    );
    if (!viewer) {
      console.log("  SKIP  no active viewer to authenticate as");
      return;
    }
    await asUser(viewer.id);

    const visible = await one(`select count(*)::int as n from acc_saved_report where id = $1`, [
      created.id,
    ]);
    check("the report is still readable", visible.n === 1, String(visible.n));

    await client.query("savepoint before_call");
    const saving = await attempt(
      `select acc_register_saved_report('Viewer upload', 'other', null, null, null,
                                        'x.csv', 'company/viewer.csv', 'text/csv', 10, $1)`,
      [hash("9999")],
    );
    check("saving is refused", /Not authorized/i.test(saving ?? ""), saving ?? "none");

    await client.query("savepoint before_call");
    const archiving = await attempt(`select acc_archive_saved_report($1, 'no reason to')`, [
      created.id,
    ]);
    check("archiving is refused", /Not authorized/i.test(archiving ?? ""), archiving ?? "none");

    await asUser(admin.id);
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no saved report row was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
