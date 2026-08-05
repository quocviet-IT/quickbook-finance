/**
 * Behavioural verification of the bank transaction label.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0098 is
 * applied, real labels are created, a real bank line is labelled and unlabelled,
 * and none of it survives. That is what makes this safe to run against a
 * database holding real books.
 *
 * The RPCs authorise through acc_is_staff(), so the transaction sets an admin's
 * id as the JWT subject the way PostgREST would.
 *
 * Run: node --env-file=.env.local scripts/verify-bank-categories.mjs
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
    // The failed statement poisons the transaction; step back to a clean point.
    await client.query("rollback to savepoint before_call");
    return error.message;
  }
}

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0098_bank_transaction_categories.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0098 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  const asAdmin = () =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin.id, role: "authenticated" }),
    ]);
  await asAdmin();

  const txn = await one(`select id, amount_minor, description from acc_bank_transaction limit 1`);
  if (!txn) throw new Error("no bank transaction to label");

  await scenario("a label is created once, however it is typed", async () => {
    const first = await one(`select acc_upsert_bank_category($1) as id`, ["  Inventory  "]);
    const again = await one(`select acc_upsert_bank_category($1) as id`, ["inventory"]);
    check("the same label came back", first.id === again.id, `${first.id} vs ${again.id}`);
    const row = await one(`select name from acc_bank_category where id = $1`, [first.id]);
    check("the name was trimmed", row.name === "Inventory", row.name);

    await client.query("savepoint before_call");
    const blank = await attempt(`select acc_upsert_bank_category($1)`, ["   "]);
    check("an empty name is refused", /name is required/i.test(blank ?? ""), blank ?? "none");
    await client.query("savepoint before_call");
    const long = await attempt(`select acc_upsert_bank_category($1)`, ["x".repeat(61)]);
    check("an over-long name is refused", /60 characters/i.test(long ?? ""), long ?? "none");
  });

  await scenario("a label attaches to a bank line and comes off again", async () => {
    const category = await one(`select acc_upsert_bank_category($1) as id`, ["Website Platform"]);
    await client.query(`select acc_set_bank_transaction_category($1, $2)`, [txn.id, category.id]);
    const after = await one(
      `select bank_category_id, amount_minor, description from acc_bank_transaction where id = $1`,
      [txn.id],
    );
    check("the label is on the line", after.bank_category_id === category.id);
    check("the amount did not move", String(after.amount_minor) === String(txn.amount_minor));
    check("the description did not move", after.description === txn.description);

    await client.query(`select acc_set_bank_transaction_category($1, null)`, [txn.id]);
    const cleared = await one(`select bank_category_id from acc_bank_transaction where id = $1`, [
      txn.id,
    ]);
    check("it comes off again", cleared.bank_category_id === null);

    await client.query("savepoint before_call");
    const unknown = await attempt(`select acc_set_bank_transaction_category($1, $2)`, [
      txn.id,
      "11111111-1111-4111-8111-111111111111",
    ]);
    check("an unknown label is refused", /does not exist/i.test(unknown ?? ""), unknown ?? "none");
  });

  await scenario("the bank line is still immutable", async () => {
    await client.query("savepoint before_call");
    const refusal = await attempt(
      `update acc_bank_transaction set amount_minor = amount_minor + 1 where id = $1`,
      [txn.id],
    );
    check(
      "changing the amount is still refused",
      /immutable/i.test(refusal ?? ""),
      refusal ?? "none",
    );
  });

  await scenario("a viewer cannot label anything", async () => {
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
    const create = await attempt(`select acc_upsert_bank_category($1)`, ["Sneaky"]);
    check("creating is refused", /Not authorized/i.test(create ?? ""), create ?? "none");
    await client.query("savepoint before_call");
    const assign = await attempt(`select acc_set_bank_transaction_category($1, null)`, [txn.id]);
    check("assigning is refused", /Not authorized/i.test(assign ?? ""), assign ?? "none");
    await asAdmin();
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no label and no assignment was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
