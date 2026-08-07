/**
 * Behavioural verification of the one account resolver (0107).
 *
 * Everything happens inside ONE transaction that is always rolled back: 0107 is
 * applied, two accounts sharing a name are created in a real company, real
 * imports are attempted, and none of it survives. Safe against real books.
 *
 * What it is really proving is that the screen and the import agree. The bug it
 * replaces was not that either one was wrong on its own — each was defensible —
 * but that they answered the same question differently, so a preview could pass
 * and the import could then refuse. Every scenario below asks both.
 *
 * Run: node --env-file=.env.local scripts/verify-account-resolver.mjs
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
const all = async (sql, params = []) => (await client.query(sql, params)).rows;

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
  await client.query("savepoint before_call");
  try {
    await client.query(sql, params);
    return null;
  } catch (error) {
    await client.query("rollback to savepoint before_call");
    return error.message;
  }
}

/** What the preview screen sees: one row per reference, straight from the RPC. */
const describe = async (ref) =>
  one(`select * from acc_account_ref_matches(array[$1::text])`, [ref]);

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0107_one_account_resolver.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0107 inside the transaction (never committed).");

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
  if (!bank) throw new Error("need a bank account with a bank record");

  await scenario("an unmistakable reference still resolves, three ways", async () => {
    const byCode = await describe(bank.account_code);
    check("the code alone", byCode?.account_id === bank.id, JSON.stringify(byCode));
    check("and says how it matched", byCode?.matched_by === "code", byCode?.matched_by);

    const byPair = await describe(`${bank.account_code} - ${bank.name}`);
    check("the code and name, spaced hyphen", byPair?.account_id === bank.id, JSON.stringify(byPair));

    const casual = await describe(`  ${bank.account_code.toUpperCase()}  `);
    check("case and padding do not matter", casual?.account_id === bank.id, JSON.stringify(casual));
  });

  await scenario("an en dash in the file still finds a hyphen in the chart", async () => {
    // Wave writes "Payroll – Salary & Wages"; the chart holds a hyphen. This is
    // the one piece of normalisation the old TypeScript copy got right, and
    // deleting that copy must not have lost it.
    await client.query(
      `insert into acc_account (account_code, name, account_type, is_posting_account, status)
       values ('ZZ90', 'Verify - Dash Account', 'expense', true, 'active')`,
    );
    const found = await describe("Verify – Dash Account");
    check("en dash matches the hyphen", found?.account_id != null, JSON.stringify(found));
  });

  await scenario("a name two accounts answer to resolves to nothing", async () => {
    await client.query(
      `insert into acc_account (account_code, name, account_type, is_posting_account, status)
       values ('ZZ91', 'Verify Twin', 'expense', true, 'active'),
              ('ZZ92', 'Verify Twin', 'current_asset', true, 'active')`,
    );

    const seen = await describe("Verify Twin");
    check("nothing is chosen", seen?.account_id === null, JSON.stringify(seen));
    check("and it says why", seen?.matched_by === "ambiguous", seen?.matched_by);
    check(
      "both candidates are named, in a stable order",
      JSON.stringify(seen?.candidate_codes) === JSON.stringify(["ZZ91", "ZZ92"]),
      JSON.stringify(seen?.candidate_codes),
    );

    const byCode = await describe("ZZ92");
    check("the code is still the way out", byCode?.matched_by === "code", JSON.stringify(byCode));

    const refusal = await attempt(`select acc_resolve_account_ref('Verify Twin')`);
    check("the single-reference form refuses", /belongs to 2 accounts/i.test(refusal ?? ""), refusal ?? "none");
    check("and the refusal names both codes", /ZZ91, ZZ92/.test(refusal ?? ""), refusal ?? "none");

    const unresolved = await one(
      `select acc_unresolved_account_refs(array['Verify Twin']) as refs`,
    );
    check(
      "the ledger screen lists it rather than throwing",
      Array.isArray(unresolved?.refs) && unresolved.refs.includes("Verify Twin"),
      JSON.stringify(unresolved?.refs),
    );
  });

  await scenario("the screen and the import reach the same verdict", async () => {
    // This is the whole point. Two accounts called the same thing, one of them
    // a bank with a bank record — exactly the shape that let a green preview
    // turn into "No bank record for the account used here".
    await client.query(
      `insert into acc_account (account_code, name, account_type, is_posting_account, status)
       values ('ZZ93', $1, 'current_asset', true, 'active')`,
      [bank.name],
    );

    const seen = await describe(bank.name);
    check("the screen refuses the bare name", seen?.matched_by === "ambiguous", JSON.stringify(seen));

    const rows = JSON.stringify([
      {
        txn_date: "2026-03-15",
        description: "Resolver verification",
        bank_account: bank.name,
        category_account: bank.account_code,
        signed_minor: -12345,
        raw_hash: "verify-resolver-hash-1",
      },
    ]);
    const refusal = await attempt(`select acc_import_transactions($1::jsonb, null)`, [rows]);
    check("the import refuses it too", refusal != null, "it imported");
    check(
      "for the reason the screen gave, not a different one",
      /belongs to 2 accounts/i.test(refusal ?? ""),
      refusal ?? "none",
    );

    // And with the code written in, both let it through.
    const byCode = await describe(bank.account_code);
    check("the screen accepts the code", byCode?.account_id === bank.id, JSON.stringify(byCode));
    const fixed = JSON.stringify([
      {
        txn_date: "2026-03-15",
        description: "Resolver verification",
        bank_account: bank.account_code,
        category_account: bank.account_code,
        signed_minor: -12345,
        raw_hash: "verify-resolver-hash-2",
      },
    ]);
    const outcome = await attempt(`select acc_import_transactions($1::jsonb, null)`, [fixed]);
    check("the import accepts the code", outcome === null, outcome ?? "");
  });

  await scenario("nothing is invented from nothing", async () => {
    const empties = await all(`select * from acc_account_ref_matches(array['', '   ', null])`);
    check("blank references produce no rows", empties.length === 0, JSON.stringify(empties));
    const nothing = await one(`select acc_resolve_account_ref('Verify Nobody') as id`);
    check("an unknown name is null, not an error", nothing?.id === null, JSON.stringify(nothing));
    const missing = await one(
      `select acc_unresolved_account_refs(array['Verify Nobody']) as refs`,
    );
    check(
      "and it is listed as unresolved",
      Array.isArray(missing?.refs) && missing.refs.includes("Verify Nobody"),
      JSON.stringify(missing?.refs),
    );
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no account and no transaction was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
