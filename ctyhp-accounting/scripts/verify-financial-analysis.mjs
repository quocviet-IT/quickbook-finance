/**
 * Behavioural verification of the frozen what-if analysis functions.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0115
 * is applied, real rows are written into a real company, and none of it
 * survives. That is what makes this safe to run against a database holding
 * real books.
 *
 * The point of the second scenario is the promise the feature makes — the
 * requester's own words: the analysis "does not save to the data". Freezing
 * must not move the ledger by so much as one entry.
 *
 * Run: node --env-file=.env.local scripts/verify-financial-analysis.mjs
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

const ADJUSTMENTS = JSON.stringify([
  {
    key: "a1",
    label: "Recognize December revenue",
    lines: [
      { accountId: "00000000-0000-4000-8000-000000000001", deltaMinor: 100000 },
      { accountId: "00000000-0000-4000-8000-000000000002", deltaMinor: -100000 },
    ],
  },
]);

const freeze = (title = "FY2026 margin scenario") =>
  client.query(
    `select acc_freeze_financial_analysis($1, null, '2026-01-01', '2026-12-31',
                                           $2::jsonb, '{"pnl":{},"balanceSheet":{}}'::jsonb) as id`,
    [title, ADJUSTMENTS],
  );

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0115_financial_analysis.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0115 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  const asUser = (id) =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: id, role: "authenticated" }),
    ]);
  await asUser(admin.id);

  await scenario("an analysis freezes and can be read back", async () => {
    const created = (await freeze()).rows[0];
    check("it returned an id", Boolean(created.id));
    const row = await one(`select * from acc_financial_analysis where id = $1`, [created.id]);
    check("the row is active", row?.status === "active", row?.status);
    check("the author was recorded", row?.created_by === admin.id);
    check("the assumptions were kept", row?.adjustments?.[0]?.label === "Recognize December revenue");
  });

  await scenario("freezing an analysis moves nothing in the ledger", async () => {
    const before = await one(
      `select (select count(*)::int from acc_journal_entry) as entries,
              (select count(*)::int from acc_journal_line)  as lines,
              (select count(*)::int from acc_bank_transaction) as bank`,
    );
    await freeze("Ledger must not move");
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

  await scenario("a session cannot smuggle a row in around the RPC", async () => {
    await client.query("savepoint before_call");
    await client.query("set local role authenticated");
    const refusal = await attempt(
      `insert into acc_financial_analysis (title, period_start, period_end, adjustments, snapshot)
       values ('smuggled', '2026-01-01', '2026-01-31', '[]'::jsonb, '{}'::jsonb)`,
    );
    check(
      "a direct insert is refused",
      /permission denied|row-level security/i.test(refusal ?? ""),
      refusal ?? "none",
    );
  });

  await scenario("an empty adjustment list is refused — a frozen actual is just a report", async () => {
    await client.query("savepoint before_call");
    const refusal = await attempt(
      `select acc_freeze_financial_analysis('No assumptions', null, '2026-01-01', '2026-01-31',
                                            '[]'::jsonb, '{}'::jsonb)`,
    );
    check("it is refused", /at least one adjustment/i.test(refusal ?? ""), refusal ?? "none");
  });

  await scenario("archiving works once and only once", async () => {
    const created = (await freeze("To be archived")).rows[0];
    await client.query(`select acc_archive_financial_analysis($1, 'Superseded by a newer scenario')`, [
      created.id,
    ]);
    const row = await one(`select * from acc_financial_analysis where id = $1`, [created.id]);
    check("the row is archived, not deleted", row?.status === "archived", row?.status);
    check("the reason was kept", row?.archive_reason === "Superseded by a newer scenario");
    check("the actor was recorded", row?.archived_by === admin.id);
    await client.query("savepoint before_call");
    const again = await attempt(`select acc_archive_financial_analysis($1, 'again')`, [created.id]);
    check("a second archive is refused", /already archived/i.test(again ?? ""), again ?? "none");
  });

  await scenario("a viewer can read but cannot freeze or archive", async () => {
    const created = (await freeze("Viewer visibility")).rows[0];
    const viewer = await one(
      `select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`,
    );
    if (!viewer) {
      console.log("  SKIP  no active viewer to authenticate as");
      return;
    }
    await asUser(viewer.id);

    const visible = await one(
      `select count(*)::int as n from acc_financial_analysis where id = $1`,
      [created.id],
    );
    check("the analysis is still readable", visible.n === 1, String(visible.n));

    await client.query("savepoint before_call");
    const freezing = await attempt(
      `select acc_freeze_financial_analysis('Viewer freeze', null, '2026-01-01', '2026-01-31',
                                            $1::jsonb, '{}'::jsonb)`,
      [ADJUSTMENTS],
    );
    check("freezing is refused", /Not authorized/i.test(freezing ?? ""), freezing ?? "none");

    await client.query("savepoint before_call");
    const archiving = await attempt(`select acc_archive_financial_analysis($1, 'no')`, [created.id]);
    check("archiving is refused", /Not authorized/i.test(archiving ?? ""), archiving ?? "none");

    await asUser(admin.id);
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no frozen analysis was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
