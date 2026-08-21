/**
 * Behavioural verification of the work policy.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0119 is
 * applied, real rows are written into a real company, and none of it survives.
 *
 * The point of the third scenario is the promise this whole phase rests on:
 * unset must stay unset. A policy that quietly became zero on its way through
 * would turn "nobody has decided" into the strictest rule the system can hold,
 * and every asleep rule would wake up judging by a number nobody chose.
 *
 * Run: node --env-file=.env.local scripts/verify-work-policy.mjs
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

const save = (materiality, approval, bank, note) =>
  client.query(`select acc_save_work_policy($1, $2, $3, $4) as id`, [
    materiality,
    approval,
    bank,
    note,
  ]);

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0119_work_policy.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0119 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  const asUser = (id) =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: id, role: "authenticated" }),
    ]);
  await asUser(admin.id);

  await scenario("a company that has never decided reads as undecided", async () => {
    const current = await one(`select * from acc_current_work_policy()`);
    check(
      "no policy at all reads as no policy",
      current === undefined ||
        (current.materiality_minor === null &&
          current.approval_sla_days === null &&
          current.unmatched_bank_age_days === null),
      JSON.stringify(current),
    );
  });

  await scenario("a saved policy is the one in force, and is audited", async () => {
    await save(100000, 3, 14, "Agreed with the auditors");
    const current = await one(`select * from acc_current_work_policy()`);
    check("materiality is what was saved", Number(current.materiality_minor) === 100000);
    check("the approval SLA is what was saved", Number(current.approval_sla_days) === 3);
    check("the author was recorded", current.created_by === admin.id);
    const audit = await one(
      `select after_json from acc_audit_log
        where table_name = 'acc_work_policy' order by created_at desc limit 1`,
    );
    check("the change is in the audit log", Number(audit?.after_json?.approval_sla_days) === 3);
  });

  await scenario("unset stays unset, and zero stays zero", async () => {
    // The distinction this phase turns on. Zero is the strictest policy a
    // company can hold; null is nobody having decided. Collapsing one into the
    // other would wake every sleeping rule with a number nobody chose.
    await save(null, 0, null, null);
    const current = await one(`select * from acc_current_work_policy()`);
    check("an unset threshold is still null", current.materiality_minor === null, String(current.materiality_minor));
    check("a policy of zero survives as zero", Number(current.approval_sla_days) === 0, String(current.approval_sla_days));
  });

  await scenario("the newest version is the one in force, and the old one is kept", async () => {
    await save(100000, 3, 14, "first");
    await save(200000, 5, 30, "second");
    const current = await one(`select * from acc_current_work_policy()`);
    check("the newest wins", Number(current.materiality_minor) === 200000, String(current.materiality_minor));
    const count = await one(`select count(*)::int as n from acc_work_policy`);
    check("the earlier version is still on file", count.n === 2, String(count.n));
  });

  await scenario("a non-admin cannot change what the company is told is urgent", async () => {
    const other = await one(
      `select id from acc_app_user where role <> 'admin' and status = 'active' limit 1`,
    );
    if (!other) {
      console.log("  SKIP  no active non-admin to authenticate as");
      return;
    }
    await asUser(other.id);

    const readable = await one(`select count(*)::int as n from acc_work_policy`);
    check("the policy is still readable", Number.isInteger(readable.n));

    await client.query("savepoint before_call");
    const refusal = await attempt(`select acc_save_work_policy(1, 1, 1, 'nope')`);
    check("saving is refused", /Only an admin/i.test(refusal ?? ""), refusal ?? "none");

    await asUser(admin.id);
  });

  await scenario("a negative policy is refused rather than stored", async () => {
    await client.query("savepoint before_call");
    const refusal = await attempt(`select acc_save_work_policy(-1, null, null, null)`);
    check("the check constraint holds", /violates check constraint/i.test(refusal ?? ""), refusal ?? "none");
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no policy was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
