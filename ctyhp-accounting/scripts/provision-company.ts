/**
 * Give a company its own set of books, from the command line.
 *
 * The building itself lives in `lib/services/company-provisioning.ts`, shared
 * with the Create company button and with the rollback-only verification
 * script. Three copies of "replay the migrations" would be three chances for
 * one of them to build a subtly different company; this file is only the
 * command-line face of the one copy.
 *
 *   node --env-file=.env.local scripts/provision-company.ts \
 *     --slug=north_star --name="North Star Bridal LLC" --sample
 *
 * Re-running for an existing slug is refused rather than half-applied. To start
 * a sample company over, drop it first with --drop.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadMigrationSources } from "../lib/db/migration-sources.ts";
import {
  provisionCompany,
  refreshExposedSchemas,
} from "../lib/services/company-provisioning.ts";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..");

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

/** Resolve the email addresses given on the command line to accounts. */
async function resolveAdmins(client: pg.Client, emails: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const email of emails) {
    const { rows } = await client.query(
      "select id from auth.users where lower(email) = lower($1)",
      [email],
    );
    if (rows.length === 0) {
      console.log(`  ! no account for ${email}; skipped`);
      continue;
    }
    ids.push(rows[0].id as string);
    console.log(`  granting ${email} administrator access`);
  }
  return ids;
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
      const schemas = await refreshExposedSchemas(client);
      console.log(`Dropped ${schema} and removed ${args.slug} from the register.`);
      console.log(`PostgREST now serves: ${schemas}`);
      return;
    }

    const existing = await client.query("select 1 from onebook.company where slug = $1", [args.slug]);
    if (existing.rowCount) throw new Error(`${args.slug} is already registered`);

    const adminIds = await resolveAdmins(client, args.admins);
    const sources = loadMigrationSources(projectRoot);
    console.log(`Building ${schema} from ${sources.length} migrations…`);

    await client.query("begin");
    const result = await provisionCompany(
      client,
      {
        slug: args.slug,
        legalName: args.name,
        isSample: args.sample,
        displayOrder: args.order,
        adminUserIds: adminIds,
      },
      sources,
    );
    await client.query("commit");

    console.log(`\n${result.schema} built:`);
    console.log(`  statements ${result.statementCount}`);
    console.log(`  tables     ${result.tableCount}`);
    console.log(`  functions  ${result.functionCount}`);
    console.log(`  policies   ${result.policyCount}`);
    console.log(`\nRegistered ${args.name} as ${args.slug}${args.sample ? " (sample)" : ""}.`);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\nProvisioning failed: ${err.message}`);
  process.exitCode = 1;
});
