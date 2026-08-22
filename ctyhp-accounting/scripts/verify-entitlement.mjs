/**
 * Behavioural verification that one company's books cannot be reached without
 * being entitled to them.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0123 is
 * applied, real roles are written into real companies, and none of it survives.
 *
 * The scenario worth the reader's attention is the first. It reproduces the
 * defect on the live database *before* applying the migration — an account with
 * a role in `public` and no membership row read that company's invoices while
 * `my_companies()` returned nothing — and then shows the same account resolving
 * correctly afterwards. Without that before-figure the rest is a set of
 * assertions about code that was never shown to be wrong.
 *
 * Run: node --env-file=.env.local scripts/verify-entitlement.mjs
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
    console.log(`  FAIL  scenario threw — ${error.message.split("\n")[0]}`);
  } finally {
    await client.query("rollback to savepoint case_start");
  }
}

/** Speak as one signed-in user, the way PostgREST does. */
async function asUser(id) {
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
}

/** What the application would resolve for this caller: the first entitled company. */
async function myCompanies() {
  await client.query("savepoint as_authenticated");
  await client.query("set local role authenticated");
  const rows = await all(`select slug, schema_name from onebook.my_companies()`);
  await client.query("rollback to savepoint as_authenticated");
  return rows;
}

await client.connect();
await client.query("begin");
try {
  // ---------------------------------------------------------------- before ---
  const drifted = await one(`
    select u.id, u.email from auth.users u
      join public.acc_app_user a on a.id = u.id and a.status = 'active'
     where not exists (select 1 from onebook.company_member m where m.user_id = u.id)
     order by u.email limit 1`);

  console.log("== the defect, on the live database, before the migration");
  if (!drifted) {
    console.log("  SKIP  no account currently holds a role without a membership row");
  } else {
    await asUser(drifted.id);
    const before = await myCompanies();
    const role = await one(`select public.acc_current_role()::text as role`);
    console.log(`  ${drifted.email}`);
    console.log(`    my_companies()            -> ${before.length ? JSON.stringify(before) : "(nothing)"}`);
    console.log(`    acc_current_role() public -> ${role.role}`);
    check(
      "the register offered this account no company at all",
      before.length === 0,
      JSON.stringify(before),
    );
    check(
      "yet its role in public was live — which the `?? \"public\"` fallback then bound it to",
      role.role !== null,
      String(role.role),
    );
  }

  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0123_entitlement_single_source.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("\nApplied 0123 inside the transaction (never committed).");

  const companies = await all(
    `select id, slug, schema_name from onebook.company where status = 'active' order by display_order`,
  );
  console.log(`Companies on the register: ${companies.map((c) => c.schema_name).join(", ")}`);

  // ----------------------------------------------------------------- after ---
  await scenario("entitlement now follows the role, in both directions", async () => {
    if (!drifted) {
      console.log("  SKIP  no drifted account to re-test");
      return;
    }
    await asUser(drifted.id);
    const after = await myCompanies();
    check(
      "the account with a live role in public is now offered public",
      after.some((row) => row.schema_name === "public"),
      JSON.stringify(after),
    );
  });

  await scenario("suspending somebody withdraws the company immediately", async () => {
    const target = await one(`
      select a.id, u.email from public.acc_app_user a
        join auth.users u on u.id = a.id
       where a.status = 'active' and a.role <> 'admin' order by u.email limit 1`);
    if (!target) {
      console.log("  SKIP  no active non-admin in public");
      return;
    }
    await asUser(target.id);
    const before = await myCompanies();
    check("they can see public while active", before.some((r) => r.schema_name === "public"));

    await client.query(
      `update public.acc_app_user set status = 'suspended' where id = $1`,
      [target.id],
    );
    const after = await myCompanies();
    check(
      "and cannot the moment they are suspended — no second row to remember",
      !after.some((r) => r.schema_name === "public"),
      JSON.stringify(after),
    );
  });

  await scenario("a membership row alone entitles nobody", async () => {
    const outsider = await one(`
      select u.id, u.email from auth.users u
       where not exists (select 1 from public.acc_app_user a where a.id = u.id)
       order by u.created_at limit 1`);
    const publicCompany = companies.find((c) => c.schema_name === "public");
    if (!outsider || !publicCompany) {
      console.log("  SKIP  every user already has a role in public");
      return;
    }
    // The old gate, handed to somebody with no role: it must buy them nothing.
    await client.query(
      `insert into onebook.company_member (company_id, user_id) values ($1, $2)
         on conflict do nothing`,
      [publicCompany.id, outsider.id],
    );
    await asUser(outsider.id);
    const seen = await myCompanies();
    check(
      "a register grant with no role in the books opens nothing",
      !seen.some((r) => r.schema_name === "public"),
      JSON.stringify(seen),
    );
  });

  await scenario("one company's role does not open another's books", async () => {
    const other = companies.find((c) => c.schema_name !== "public");
    if (!other) {
      console.log("  SKIP  only one company on the register");
      return;
    }
    const member = await one(
      `select id from ${other.schema_name}.acc_app_user where status = 'active' limit 1`,
    );
    if (!member) {
      console.log(`  SKIP  ${other.schema_name} has no active user`);
      return;
    }
    await asUser(member.id);
    const seen = await myCompanies();
    const names = seen.map((r) => r.schema_name);
    check(`they are offered ${other.schema_name}`, names.includes(other.schema_name), JSON.stringify(names));

    const hasPublicRole = await one(
      `select count(*)::int as n from public.acc_app_user
        where id = $1 and status in ('invited','active')`,
      [member.id],
    );
    check(
      "and public exactly when they hold a live role there, never otherwise",
      names.includes("public") === (hasPublicRole.n > 0),
      `offered=${names.includes("public")} role=${hasPublicRole.n > 0}`,
    );
  });

  await scenario("the drift report finds what it is for, and is admin-only", async () => {
    const admin = await one(
      `select user_id from onebook.platform_admin order by added_at limit 1`,
    );
    const plain = await one(`
      select u.id from auth.users u
       where not exists (select 1 from onebook.platform_admin p where p.user_id = u.id)
       order by u.created_at limit 1`);

    if (plain) {
      await asUser(plain.id);
      await client.query("savepoint before_call");
      let refusal = null;
      try {
        await client.query(`set local role authenticated`);
        await client.query(`select * from onebook.entitlement_drift()`);
      } catch (error) {
        refusal = error.message;
      }
      await client.query("rollback to savepoint before_call");
      check(
        "an ordinary user cannot read who belongs to which company",
        /platform administrator/i.test(refusal ?? ""),
        refusal ?? "none",
      );
    } else {
      console.log("  SKIP  every user is a platform admin");
    }

    if (!admin) {
      console.log("  SKIP  no platform admin registered");
      return;
    }
    await asUser(admin.user_id);
    const rows = await all(`select * from onebook.entitlement_drift()`);
    check("a platform admin gets an answer", Array.isArray(rows), typeof rows);
    console.log(`  ${rows.length} row(s) of drift on the live register:`);
    for (const row of rows.slice(0, 10)) {
      console.log(
        `    ${row.schema_name.padEnd(10)} role=${row.has_role} membership=${row.has_membership} status=${row.app_user_status ?? "-"}`,
      );
    }
  });

  await scenario("the entitlement rule is one policy, not a copy per company", async () => {
    const fns = await all(
      `select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname = 'company_role_in' order by 1`,
    );
    check(
      "company_role_in exists only in onebook",
      fns.length === 1 && fns[0].nspname === "onebook",
      JSON.stringify(fns.map((f) => f.nspname)),
    );
    const policy = await one(`
      select pg_get_expr(p.polqual, p.polrelid) as expr
        from pg_policy p join pg_class c on c.oid = p.polrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'onebook' and c.relname = 'company' and p.polname = 'onebook_company_sel'`);
    check(
      "and the register's read policy asks it, not company_member",
      /company_role_in/.test(policy?.expr ?? "") && !/company_member/.test(policy?.expr ?? ""),
      policy?.expr ?? "missing",
    );
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no role and no grant was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
