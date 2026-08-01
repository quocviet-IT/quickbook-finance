/**
 * Give a company its own set of books.
 *
 * Creates a schema, builds the whole accounting system inside it from the
 * migration set, registers the company, and then *checks its own work* by
 * comparing what it built against the books that already exist. A provisioning
 * step that reports success without verifying is how a company ends up with
 * three quarters of a ledger and no sign that anything is wrong.
 *
 *   node --env-file=.env.local scripts/provision-company.ts \
 *     --slug=north_star --name="North Star Bridal LLC" --sample
 *
 * Re-running for an existing slug is refused rather than half-applied. To start
 * a sample company over, drop it first with --drop.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "supabase", "migrations");

/**
 * The migration that builds the register itself; a company never contains it.
 * Matched by full name — two branches can land on the same number.
 */
const REGISTER_MIGRATION = "0081_company_register.sql";

interface Args {
  slug: string;
  name: string;
  sample: boolean;
  drop: boolean;
  order: number;
  /** Who may open the new company, and as an administrator inside it. */
  admins: string[];
}

function parseArgs(): Args {
  const get = (key: string) =>
    process.argv.find((a) => a.startsWith(`--${key}=`))?.split("=").slice(1).join("=");
  const slug = get("slug");
  const name = get("name");
  if (!slug || !/^[a-z][a-z0-9_]{1,40}$/.test(slug)) {
    throw new Error("--slug is required, lower case letters, digits and underscores");
  }
  if (!name && !process.argv.includes("--drop")) throw new Error('--name="Legal Name" is required');
  return {
    slug,
    name: name ?? "",
    sample: process.argv.includes("--sample"),
    drop: process.argv.includes("--drop"),
    order: Number(get("order") ?? 100),
    admins: (get("admin") ?? "").split(",").map((e) => e.trim()).filter(Boolean),
  };
}

/**
 * Let someone in.
 *
 * Two grants, because they answer different questions: membership in the
 * register decides whether the company is even visible to them, and a row in
 * the company's own user table decides what they can do once inside. A person
 * can therefore run one company and merely read another.
 */
async function grantAccess(
  client: pg.Client,
  schema: string,
  slug: string,
  emails: readonly string[],
): Promise<void> {
  for (const email of emails) {
    const { rows } = await client.query(
      "select id, email from auth.users where lower(email) = lower($1)",
      [email],
    );
    if (rows.length === 0) {
      console.log(`  ! no account for ${email}; skipped`);
      continue;
    }
    const userId = rows[0].id as string;
    await client.query(
      `insert into onebook.company_member (company_id, user_id)
       select c.id, $2 from onebook.company c where c.slug = $1
       on conflict do nothing`,
      [slug, userId],
    );
    await client.query(
      `insert into ${schema}.acc_app_user (id, full_name, role, status)
       values ($1, $2, 'admin', 'active')
       on conflict (id) do update set role = 'admin', status = 'active'`,
      [userId, rows[0].email],
    );
    console.log(`  granted ${email} administrator access`);
  }
}

function migrationSources() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && f !== REGISTER_MIGRATION)
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(migrationsDir, file), "utf8") }));
}

/** Object names in a schema, so what was built can be compared with what exists. */
async function inventory(client: pg.Client, schema: string) {
  const tables = await client.query(
    `select table_name from information_schema.tables
      where table_schema = $1 and table_type = 'BASE TABLE' order by 1`,
    [schema],
  );
  const routines = await client.query(
    `select distinct p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $1 order by 1`,
    [schema],
  );
  const policies = await client.query(
    `select count(*)::int as n from pg_policies where schemaname = $1`,
    [schema],
  );
  return {
    tables: tables.rows.map((r) => r.table_name as string),
    routines: routines.rows.map((r) => r.proname as string),
    policyCount: policies.rows[0].n as number,
  };
}

async function main() {
  const args = parseArgs();
  const schema = `co_${args.slug}`;
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set (use node --env-file=.env.local)");

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    if (args.drop) {
      const { rows } = await client.query(
        "select is_sample from onebook.company where slug = $1",
        [args.slug],
      );
      if (rows.length === 0) throw new Error(`No company registered with slug ${args.slug}`);
      // Only a sample company can be dropped this way. Real books are not
      // something a command-line flag should be able to delete.
      if (!rows[0].is_sample) {
        throw new Error(`${args.slug} is not a sample company; refusing to drop real books`);
      }
      await client.query("begin");
      await client.query(`drop schema if exists ${schema} cascade`);
      await client.query("delete from onebook.company where slug = $1", [args.slug]);
      await client.query("commit");
      await refreshExposedSchemas(client);
      console.log(`Dropped ${schema} and removed ${args.slug} from the register.`);
      return;
    }

    const existing = await client.query("select 1 from onebook.company where slug = $1", [args.slug]);
    if (existing.rowCount) throw new Error(`${args.slug} is already registered`);

    const plan = planCompanySchema(migrationSources(), schema);
    console.log(
      `Building ${schema}: ${plan.statements.length} statements, ` +
        `${plan.skipped.length} held back as global.`,
    );

    await client.query("begin");
    await client.query(`create schema ${schema}`);
    // The runner creates this table, not any migration file, so a fresh schema
    // has to be given one before the migrations that reference it arrive. It is
    // also what lets a future migration be applied to this company.
    await client.query(`create table ${schema}.acc_schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )`);
    // Deliberately narrow: the company's own schema and the extensions it
    // needs, and nothing else. If a statement cannot resolve a name, it fails
    // here and loudly, rather than silently finding the object in public.
    await client.query(`set local search_path = ${schema}, extensions`);

    let index = 0;
    for (const statement of plan.statements) {
      index += 1;
      try {
        await client.query(statement);
      } catch (err) {
        throw new Error(
          `statement ${index}/${plan.statements.length} failed: ${(err as Error).message}\n` +
            `--- SQL ---\n${statement.slice(0, 600)}`,
        );
      }
    }

    // The application connects as `authenticated`; row-level security decides
    // what it may see once it is in.
    await client.query(`grant usage on schema ${schema} to authenticated, service_role`);
    await client.query(
      `grant select, insert, update, delete on all tables in schema ${schema} to authenticated`,
    );
    await client.query(`grant all on all tables in schema ${schema} to service_role`);
    await client.query(`grant usage, select on all sequences in schema ${schema} to authenticated, service_role`);
    await client.query(`revoke all on schema ${schema} from anon`);

    // Record what this schema already has, so the next migration run applies
    // only what is new here.
    for (const source of migrationSources()) {
      await client.query(
        `insert into ${schema}.acc_schema_migrations (filename) values ($1) on conflict do nothing`,
        [source.file],
      );
    }

    await client.query(
      `insert into onebook.company
         (slug, schema_name, legal_name, is_sample, display_order)
       values ($1, $2, $3, $4, $5)`,
      [args.slug, schema, args.name, args.sample, args.order],
    );
    await client.query("commit");

    if (args.admins.length) await grantAccess(client, schema, args.slug, args.admins);
    await refreshExposedSchemas(client);

    // --- Check the work -----------------------------------------------------
    const built = await inventory(client, schema);
    const reference = await inventory(client, "public");

    const missing = reference.tables.filter((t) => !built.tables.includes(t));
    const extra = built.tables.filter((t) => !reference.tables.includes(t));
    const missingRoutines = reference.routines.filter((r) => !built.routines.includes(r));

    console.log(`\n${schema} built:`);
    console.log(`  tables    ${built.tables.length}  (public has ${reference.tables.length})`);
    console.log(`  functions ${built.routines.length}  (public has ${reference.routines.length})`);
    console.log(`  policies  ${built.policyCount}  (public has ${reference.policyCount})`);

    if (missing.length) console.log(`  MISSING tables:    ${missing.join(", ")}`);
    if (extra.length) console.log(`  unexpected tables: ${extra.join(", ")}`);
    if (missingRoutines.length) console.log(`  MISSING functions: ${missingRoutines.join(", ")}`);

    if (plan.skipped.length) {
      console.log(`\nHeld back as global (correct — these belong to the database, not a company):`);
      const reasons = new Map<string, number>();
      for (const s of plan.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
      for (const [reason, count] of reasons) console.log(`  ${String(count).padStart(3)} × ${reason}`);
    }

    if (missing.length || missingRoutines.length) {
      throw new Error("the new schema is not complete — see MISSING above");
    }
    console.log(`\nRegistered ${args.name} as ${args.slug}${args.sample ? " (sample)" : ""}.`);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Tell PostgREST which schemas it may serve.
 *
 * Without this the application can authenticate perfectly and still get
 * "schema must be one of the following" on every request to a new company.
 */
async function refreshExposedSchemas(client: pg.Client) {
  const { rows } = await client.query(
    `select string_agg(schema_name, ', ' order by schema_name) as schemas
       from (select 'public' as schema_name
             union select 'onebook'
             union select schema_name from onebook.company) s`,
  );
  const schemas = rows[0].schemas as string;
  await client.query(`alter role authenticator set pgrst.db_schemas = '${schemas}'`);
  // Two reloads, and both are needed. The first makes PostgREST re-read which
  // schemas it may serve; the second makes it re-read what is *in* them. Without
  // the schema reload a brand new company answers every request with "could not
  // find the function … in the schema cache", which reads like a broken
  // deployment and is only a stale cache.
  await client.query(`notify pgrst, 'reload config'`);
  await client.query(`notify pgrst, 'reload schema'`);
  console.log(`PostgREST now serves: ${schemas}`);
}

main().catch((err) => {
  console.error(`\nProvisioning failed: ${err.message}`);
  process.exitCode = 1;
});
