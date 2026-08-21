/**
 * Behavioural verification of the work item lifecycle.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0118 is
 * applied, real rows are written into a real company, and none of it survives.
 * That is what makes this safe to run against a database holding real books.
 *
 * The acceptance criteria this exists to prove are the ones a screen cannot:
 * that a viewer is refused, that a stale write is refused rather than winning,
 * that a blocking control cannot be dismissed, and that the state table holds
 * no accounting figure — the last asserted from the column list, so a later
 * edit that adds one fails here rather than in production.
 *
 * Run: node --env-file=.env.local scripts/verify-work-item-state.mjs
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

async function attempt(sql, params) {
  try {
    await client.query(sql, params);
    return null;
  } catch (error) {
    await client.query("rollback to savepoint before_call");
    return error.message;
  }
}

const set = (key, lifecycle, expected, opts = {}) =>
  client.query(
    `select acc_set_work_item_state($1, $2, $3, $4, $5, $6, $7) as at`,
    [
      key,
      lifecycle,
      opts.owner ?? null,
      opts.due ?? null,
      opts.reason ?? null,
      expected,
      opts.blocksClose ?? false,
    ],
  );

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0118_work_item_state.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0118 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  const asUser = (id) =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: id, role: "authenticated" }),
    ]);
  await asUser(admin.id);

  await scenario("the table holds decisions, never figures", async () => {
    const cols = await client.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'acc_work_item_state'`,
    );
    const names = cols.rows.map((r) => r.column_name);
    const accounting = names.filter((n) =>
      /minor|amount|balance|debit|credit|total|account_id|journal/.test(n),
    );
    check(
      "no column carries an accounting figure",
      accounting.length === 0,
      accounting.join(", "),
    );
    check("it does carry the decisions", ["lifecycle", "owner_id", "due_date"].every((n) => names.includes(n)));
  });

  await scenario("a decision is recorded, with who made it", async () => {
    const first = await one(`select acc_set_work_item_state('bill:1', 'acknowledged', $1, null, null, null, false) as at`, [admin.id]);
    check("it returned version 1", Number(first.at) === 1, String(first.at));
    const row = await one(`select * from acc_work_item_state where work_key = 'bill:1'`);
    check("the lifecycle is what was asked for", row?.lifecycle === "acknowledged", row?.lifecycle);
    check("the actor was recorded", row?.updated_by === admin.id);
    const audit = await one(
      `select after_json from acc_audit_log
        where table_name = 'acc_work_item_state' order by created_at desc limit 1`,
    );
    check("the change is in the audit log", audit?.after_json?.work_key === "bill:1");
  });

  await scenario("a stale write is refused rather than winning", async () => {
    // The criterion in the design document: concurrent updates must not
    // silently overwrite another user's state.
    const first = await one(`select acc_set_work_item_state('bill:2', 'acknowledged', null, null, null, null, false) as at`);
    await set("bill:2", "in_progress", first.at);
    await client.query("savepoint before_call");
    const stale = await attempt(
      `select acc_set_work_item_state('bill:2', 'dismissed', null, null, 'mine', $1, false)`,
      [first.at],
    );
    check("the second writer is told to look again", /changed by someone else/i.test(stale ?? ""), stale ?? "none");
    const row = await one(`select lifecycle from acc_work_item_state where work_key = 'bill:2'`);
    check("the first writer's change stands", row?.lifecycle === "in_progress", row?.lifecycle);
  });

  await scenario("the three refusals hold in the database, not only the screen", async () => {
    await client.query("savepoint before_call");
    const resolved = await attempt(`select acc_set_work_item_state('x:1', 'resolved', null, null, null, null, false)`);
    check("nobody may declare an item resolved", /by the books/i.test(resolved ?? ""), resolved ?? "none");

    await client.query("savepoint before_call");
    const blank = await attempt(`select acc_set_work_item_state('x:2', 'dismissed', null, null, '  ', null, false)`);
    check("a dismissal needs a reason", /say why/i.test(blank ?? ""), blank ?? "none");

    await client.query("savepoint before_call");
    const blocker = await attempt(
      `select acc_set_work_item_state('control:trial-balance', 'dismissed', null, null, 'later', null, true)`,
    );
    check("a close blocker cannot be dismissed", /blocks the period close/i.test(blocker ?? ""), blocker ?? "none");
  });

  await scenario("work that has gone is retired, and live work is left alone", async () => {
    await set("gone:1", "acknowledged", null);
    await set("live:1", "acknowledged", null);
    const count = await one(`select acc_retire_work_items(array['live:1']) as n`);
    check("one row was retired", Number(count.n) === 1, String(count.n));
    const gone = await one(`select lifecycle from acc_work_item_state where work_key = 'gone:1'`);
    const live = await one(`select lifecycle from acc_work_item_state where work_key = 'live:1'`);
    check("the finished item is resolved", gone?.lifecycle === "resolved", gone?.lifecycle);
    check("the live item is untouched", live?.lifecycle === "acknowledged", live?.lifecycle);
  });

  await scenario("a viewer may read the queue and change nothing", async () => {
    await set("viewer:1", "acknowledged", null);
    const viewer = await one(
      `select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`,
    );
    if (!viewer) {
      console.log("  SKIP  no active viewer to authenticate as");
      return;
    }
    await asUser(viewer.id);

    const visible = await one(`select count(*)::int as n from acc_work_item_state where work_key = 'viewer:1'`);
    check("the state is still readable", visible.n === 1, String(visible.n));

    await client.query("savepoint before_call");
    const refusal = await attempt(`select acc_set_work_item_state('viewer:2', 'acknowledged', null, null, null, null, false)`);
    check("changing work is refused", /Not authorized/i.test(refusal ?? ""), refusal ?? "none");

    await asUser(admin.id);
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no work item state was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
