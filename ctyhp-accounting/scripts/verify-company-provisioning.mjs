/**
 * Behavioural verification of company provisioning.
 *
 * A real company is built — schema, every migration, grants, register row, the
 * PostgREST exposure — inside ONE transaction that is always rolled back. That
 * is the only honest way to test this: a provisioning that "looks right" and has
 * never run is exactly the failure the self-check exists to catch.
 *
 * Run: node --env-file=.env.local scripts/verify-company-provisioning.mjs
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadMigrationSources } from "../lib/db/migration-sources.ts";
import { provisionCompany } from "../lib/services/company-provisioning.ts";

/** The project root, resolved the way that works on Windows too. */
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SLUG = "verify_probe";
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

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0097_company_provisioning_requests.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0097 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  const sources = loadMigrationSources(projectRoot);
  console.log(`Replaying ${sources.length} migrations into co_${SLUG}…`);

  const started = Date.now();
  const result = await provisionCompany(
    client,
    {
      slug: SLUG,
      legalName: "Verify Probe Inc.",
      isSample: true,
      displayOrder: 999,
      adminUserIds: admin ? [admin.id] : [],
    },
    sources,
  );
  console.log(
    `Built in ${Math.round((Date.now() - started) / 1000)}s ` +
      `(${result.statementCount} statements).`,
  );

  // Compared with public rather than with a number somebody typed: the point is
  // that the new company is as complete as the books that already exist.
  const reference = await one(
    `select
       (select count(*)::int from information_schema.tables
         where table_schema = 'public' and table_type = 'BASE TABLE') as tables,
       (select count(distinct p.proname)::int from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public') as functions,
       (select count(*)::int from pg_policies where schemaname = 'public') as policies`,
  );
  check(
    "every table public has was built",
    result.tableCount >= reference.tables,
    `${result.tableCount} vs ${reference.tables}`,
  );
  check(
    "every function public has was built",
    result.functionCount >= reference.functions,
    `${result.functionCount} vs ${reference.functions}`,
  );
  check(
    "row-level security came with them",
    result.policyCount >= reference.policies,
    `${result.policyCount} vs ${reference.policies}`,
  );

  const registered = await one(
    `select slug, schema_name, status from onebook.company where slug = $1`,
    [SLUG],
  );
  check("the company is in the register", registered?.schema_name === `co_${SLUG}`);
  check("it is active", registered?.status === "active");

  const migrations = await one(`select count(*)::int as n from co_${SLUG}.acc_schema_migrations`);
  check(
    "its migration history is complete",
    migrations.n === sources.length,
    `${migrations.n}/${sources.length}`,
  );

  const exposed = await one(
    `select setconfig::text as config from pg_db_role_setting s
       join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator'`,
  );
  check(
    "PostgREST was told about it",
    /co_verify_probe/.test(exposed?.config ?? ""),
    exposed?.config ?? "none",
  );

  if (admin) {
    const member = await one(
      `select 1 as ok from onebook.company_member m
         join onebook.company c on c.id = m.company_id
        where c.slug = $1 and m.user_id = $2`,
      [SLUG, admin.id],
    );
    check("the requester is a member", Boolean(member));
    const inside = await one(`select role, status from co_${SLUG}.acc_app_user where id = $1`, [
      admin.id,
    ]);
    check(
      "and an administrator inside it",
      inside?.role === "admin" && inside?.status === "active",
      `${inside?.role}/${inside?.status}`,
    );
  }

  const anonGrants = await one(
    `select count(*)::int as n from information_schema.role_table_grants
      where table_schema = $1 and grantee = 'anon'`,
    [`co_${SLUG}`],
  );
  check("anon was given nothing", anonGrants.n === 0, String(anonGrants.n));
} catch (error) {
  failed += 1;
  console.log(`  FAIL  provisioning threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — the probe company never existed.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
