/**
 * Behavioural verification of the inactive tie-break (0110).
 *
 * Everything happens inside ONE transaction that is always rolled back: 0107,
 * 0110 and their fixtures are applied, and none of it survives.
 *
 * The case that matters is the one a reader actually hit: two accounts share a
 * name, the file is a customer's export that cannot be edited, and the only
 * remedy available is to switch one of the accounts off in the chart. Before
 * 0110 that did nothing — the resolver excluded `archived` and nothing else —
 * so they were doing the right thing and being told it had not worked.
 *
 * Run: node --env-file=.env.local scripts/verify-inactive-breaks-tie.mjs
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
  await client.query("savepoint before_call");
  try {
    await client.query(sql, params);
    return null;
  } catch (error) {
    await client.query("rollback to savepoint before_call");
    return error.message;
  }
}

const describe = async (ref) =>
  one(`select * from acc_account_ref_matches(array[$1::text])`, [ref]);

/** Two accounts of one name, each in the state the scenario needs. */
async function twins(first, second) {
  await client.query(
    `insert into acc_account (account_code, name, account_type, is_posting_account, status)
     values ('ZZ80', 'Verify Twin', 'expense', true, $1),
            ('ZZ81', 'Verify Twin', 'expense', true, $2)`,
    [first, second],
  );
}

await client.connect();
await client.query("begin");
try {
  for (const file of [
    "0107_one_account_resolver.sql",
    "0110_inactive_breaks_the_tie.sql",
  ]) {
    await client.query(await readFile(join(projectRoot, "supabase", "migrations", file), "utf8"));
  }
  console.log("Applied 0107 and 0110 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: admin.id, role: "authenticated" }),
  ]);

  await scenario("switching one off settles it", async () => {
    await twins("active", "inactive");

    const seen = await describe("Verify Twin");
    check("the live one is chosen", seen?.matched_by === "name", JSON.stringify(seen));
    const chosen = await one(`select account_code from acc_account where id = $1`, [
      seen.account_id,
    ]);
    check("and it is the right one", chosen?.account_code === "ZZ80", chosen?.account_code);
    check("only it is offered", JSON.stringify(seen.candidate_codes) === '["ZZ80"]',
      JSON.stringify(seen.candidate_codes));

    const resolved = await one(`select acc_resolve_account_ref('Verify Twin') as id`);
    check("the import agrees", resolved?.id === seen.account_id, JSON.stringify(resolved));
  });

  await scenario("it works whichever of the two is switched off", async () => {
    await twins("inactive", "active");
    const seen = await describe("Verify Twin");
    const chosen = await one(`select account_code from acc_account where id = $1`, [
      seen.account_id,
    ]);
    check("the live one is chosen", chosen?.account_code === "ZZ81", chosen?.account_code);
  });

  await scenario("two live accounts are still a question", async () => {
    await twins("active", "active");
    const seen = await describe("Verify Twin");
    check("nothing is chosen", seen?.account_id === null, JSON.stringify(seen));
    check("it is ambiguous", seen?.matched_by === "ambiguous", seen?.matched_by);
    check("both are named", JSON.stringify(seen.candidate_codes) === '["ZZ80","ZZ81"]',
      JSON.stringify(seen.candidate_codes));

    const refusal = await attempt(`select acc_resolve_account_ref('Verify Twin')`);
    check("the import refuses", /belongs to 2 active accounts/i.test(refusal ?? ""), refusal ?? "none");
    check("and offers the code", /"ZZ80" on its own/.test(refusal ?? ""), refusal ?? "none");
    check("and offers the other way out",
      /make the one you do not use inactive/i.test(refusal ?? ""), refusal ?? "none");
  });

  await scenario("two switched-off accounts are still a question", async () => {
    // Nothing has been decided here: narrowing to the live ones leaves none.
    await twins("inactive", "inactive");
    const seen = await describe("Verify Twin");
    check("still ambiguous", seen?.matched_by === "ambiguous", seen?.matched_by);
    check("both still named", JSON.stringify(seen.candidate_codes) === '["ZZ80","ZZ81"]',
      JSON.stringify(seen.candidate_codes));
  });

  await scenario("a single inactive account still resolves", async () => {
    // Deactivating an account must not silently break a file that names it
    // unambiguously; refusing to post to a closed account is a separate job.
    await client.query(
      `insert into acc_account (account_code, name, account_type, is_posting_account, status)
       values ('ZZ82', 'Verify Lonely', 'expense', true, 'inactive')`,
    );
    const seen = await describe("Verify Lonely");
    check("it is found", seen?.matched_by === "name", JSON.stringify(seen));
    check("and resolves", seen?.account_id != null, JSON.stringify(seen));
  });

  await scenario("an archived account is not a candidate at all", async () => {
    await client.query(
      `insert into acc_account (account_code, name, account_type, is_posting_account, status)
       values ('ZZ83', 'Verify Twin', 'expense', true, 'active'),
              ('ZZ84', 'Verify Twin', 'expense', true, 'archived')`,
    );
    const seen = await describe("Verify Twin");
    check("only the live one is seen", seen?.matched_by === "name", JSON.stringify(seen));
    check("the archived one is not offered",
      !JSON.stringify(seen.candidate_codes).includes("ZZ84"),
      JSON.stringify(seen.candidate_codes));
  });

  await scenario("the code still beats everything", async () => {
    await twins("active", "active");
    const seen = await describe("ZZ81");
    check("an ambiguous name is irrelevant when the code is given",
      seen?.matched_by === "code", JSON.stringify(seen));
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no account was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
