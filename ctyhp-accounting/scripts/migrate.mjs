// Apply SQL migrations in supabase/migrations to the database in SUPABASE_DB_URL.
//
// Every company has its own schema, and every one of them has to receive every
// migration. A runner that only updated `public` would leave the other
// companies a little further behind with each release until something broke in
// a way nobody could explain — so this applies to all of them in one command,
// tracking each schema's history separately in its own acc_schema_migrations.
//
// Run: node --env-file=.env.local scripts/migrate.mjs
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "supabase", "migrations");

/**
 * The register builds the control plane; a company schema never contains it.
 *
 * Matched by full name, not by number: migrations are numbered by whoever
 * writes them next, two branches can land on the same number, and a prefix
 * match would silently exclude an unrelated migration from every company.
 */
const REGISTER_MIGRATION = "0081_company_register.sql";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set (use node --env-file=.env.local).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

const files = () => readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

/** Apply everything outstanding to the original books, unchanged. */
async function migratePublic() {
  await client.query(`create table if not exists acc_schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  );`);
  const applied = new Set(
    (await client.query("select filename from acc_schema_migrations")).rows.map((r) => r.filename),
  );

  let count = 0;
  for (const file of files()) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    process.stdout.write(`public         apply ${file} ... `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into acc_schema_migrations (filename) values ($1)", [file]);
      await client.query("commit");
      console.log("ok");
      count++;
    } catch (err) {
      await client.query("rollback");
      console.log("FAILED");
      throw err;
    }
  }
  return count;
}

/**
 * Apply everything outstanding to one company, retargeted to its schema.
 *
 * The same transformation the provisioner uses, from the same tested module —
 * a migration must not mean one thing when a company is created and something
 * else when it is updated.
 */
async function migrateCompany(schema) {
  const applied = new Set(
    (await client.query(`select filename from ${schema}.acc_schema_migrations`)).rows.map(
      (r) => r.filename,
    ),
  );

  let count = 0;
  for (const file of files()) {
    if (file === REGISTER_MIGRATION || applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const plan = planCompanySchema([{ file, sql }], schema);
    process.stdout.write(`${schema.padEnd(14)} apply ${file} ... `);
    try {
      await client.query("begin");
      await client.query(`set local search_path = ${schema}, extensions`);
      for (const statement of plan.statements) await client.query(statement);
      await client.query(`insert into ${schema}.acc_schema_migrations (filename) values ($1)`, [
        file,
      ]);
      await client.query("commit");
      console.log(plan.skipped.length ? `ok (${plan.skipped.length} global held back)` : "ok");
      count++;
    } catch (err) {
      await client.query("rollback");
      console.log("FAILED");
      throw err;
    }
  }
  return count;
}

async function main() {
  await client.connect();

  let total = await migratePublic();

  // The register does not exist on a database that has never been migrated.
  const hasRegister = await client.query(
    "select 1 from information_schema.tables where table_schema = 'onebook' and table_name = 'company'",
  );
  if (hasRegister.rowCount) {
    const { rows } = await client.query(
      "select schema_name from onebook.company where schema_name <> 'public' order by display_order",
    );
    for (const { schema_name } of rows) total += await migrateCompany(schema_name);
  }

  console.log(`\nDone. ${total} migration(s) applied across all companies.`);
}

main()
  .catch((err) => {
    console.error("\nMigration error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
