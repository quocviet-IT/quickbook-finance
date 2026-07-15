// Apply SQL migrations in supabase/migrations to the database in SUPABASE_DB_URL.
// Tracks applied files in acc_schema_migrations. Idempotent.
// Run: node --env-file=.env.local scripts/migrate.mjs
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "supabase", "migrations");

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set (use node --env-file=.env.local).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  await client.query(`create table if not exists acc_schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  );`);

  const applied = new Set(
    (await client.query("select filename from acc_schema_migrations")).rows.map((r) => r.filename),
  );

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    process.stdout.write(`apply ${file} ... `);
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
  console.log(`\nDone. ${count} migration(s) applied.`);
}

main()
  .catch((err) => {
    console.error("\nMigration error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
