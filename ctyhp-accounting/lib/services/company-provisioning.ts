// Relative, with the extension: `scripts/provision-company.ts` imports this
// module under plain Node, where the `@/` alias does not exist. The type import
// below may keep the alias — type imports are erased before Node sees them.
import { planCompanySchema } from "../domain/schema-template.ts";
import type { MigrationSource } from "@/lib/db/migration-sources";

export type { MigrationSource };

/**
 * Building a company's books.
 *
 * This is the code `scripts/provision-company.ts` used to hold on its own. It
 * lives here so the CLI, the Server Action and the rollback-only verification
 * script all run the *same* provisioning — three copies of "replay the
 * migrations" is three chances for one of them to build a subtly different
 * company.
 *
 * It takes a client rather than opening one, which is what lets the verifier
 * hand it a transaction it intends to roll back.
 *
 * No `server-only` marker: the CLI imports this under plain Node.
 */
export interface PgLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface ProvisionCompanyInput {
  slug: string;
  legalName: string;
  isSample: boolean;
  displayOrder: number;
  /** Given membership in the register and administrator rights inside the books. */
  adminUserIds: readonly string[];
}

export interface ProvisionCompanyResult {
  companyId: string;
  schema: string;
  statementCount: number;
  tableCount: number;
  functionCount: number;
  policyCount: number;
}

/**
 * How many statements go in one round trip.
 *
 * 1053 separate queries is a minute of latency and nothing else; fifty at a
 * time is a fraction of that. The size is a balance: too large and a failure
 * report covers too much ground, which is why a failed batch is replayed singly
 * below.
 */
export const PROVISION_BATCH_SIZE = 50;

export async function companyInventory(client: PgLike, schema: string) {
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
    policyCount: Number(policies.rows[0]?.n ?? 0),
  };
}

/**
 * Tell PostgREST which schemas it may serve.
 *
 * Without this the application can authenticate perfectly and still get
 * "schema must be one of the following" on every request to a new company.
 * Two reloads, and both are needed: the first makes PostgREST re-read which
 * schemas it may serve, the second what is *in* them.
 */
export async function refreshExposedSchemas(client: PgLike): Promise<string> {
  const { rows } = await client.query(
    `select string_agg(schema_name, ', ' order by schema_name) as schemas
       from (select 'public' as schema_name
             union select 'onebook'
             union select schema_name from onebook.company) s`,
  );
  const schemas = rows[0].schemas as string;
  await client.query(`alter role authenticator set pgrst.db_schemas = '${schemas}'`);
  await client.query(`notify pgrst, 'reload config'`);
  await client.query(`notify pgrst, 'reload schema'`);
  return schemas;
}

/** Run a batch, and if it fails, find out which statement did it. */
async function runBatch(client: PgLike, batch: string[], from: number, total: number) {
  try {
    await client.query(batch.join(";\n"));
  } catch {
    for (let i = 0; i < batch.length; i += 1) {
      try {
        await client.query(batch[i]);
      } catch (error) {
        throw new Error(
          `statement ${from + i + 1}/${total} failed: ${(error as Error).message}\n` +
            `--- SQL ---\n${batch[i].slice(0, 600)}`,
        );
      }
    }
    throw new Error(`a batch of ${batch.length} statements failed but every statement passed alone`);
  }
}

/**
 * Let someone in.
 *
 * Two grants, because they answer different questions: membership in the
 * register decides whether the company is even visible to them, and a row in
 * the company's own user table decides what they can do once inside.
 */
async function grantAccess(
  client: PgLike,
  schema: string,
  slug: string,
  userIds: readonly string[],
): Promise<void> {
  for (const userId of userIds) {
    await client.query(
      `insert into onebook.company_member (company_id, user_id)
       select c.id, $2 from onebook.company c where c.slug = $1
       on conflict do nothing`,
      [slug, userId],
    );
    await client.query(
      `insert into ${schema}.acc_app_user (id, full_name, role, status)
       select $1, coalesce(u.email, 'Administrator'), 'admin', 'active'
         from auth.users u where u.id = $1
       on conflict (id) do update set role = 'admin', status = 'active'`,
      [userId],
    );
  }
}

/**
 * Build one company. The caller owns the transaction: everything below either
 * commits together or leaves no trace.
 */
export async function provisionCompany(
  client: PgLike,
  input: ProvisionCompanyInput,
  sources: readonly MigrationSource[],
): Promise<ProvisionCompanyResult> {
  const schema = `co_${input.slug}`;
  const plan = planCompanySchema(sources, schema);

  await client.query(`create schema ${schema}`);
  // The runner creates this table, not any migration file, so a fresh schema
  // has to be given one before the migrations that reference it arrive.
  await client.query(`create table ${schema}.acc_schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )`);
  // Deliberately narrow: the company's own schema and the extensions it needs.
  // If a statement cannot resolve a name it fails here and loudly, rather than
  // silently finding the object in public.
  await client.query(`set local search_path = ${schema}, extensions`);

  for (let i = 0; i < plan.statements.length; i += PROVISION_BATCH_SIZE) {
    const batch = plan.statements.slice(i, i + PROVISION_BATCH_SIZE);
    await runBatch(client, batch, i, plan.statements.length);
  }

  // The application connects as `authenticated`; row-level security decides
  // what it may see once it is in.
  await client.query(`grant usage on schema ${schema} to authenticated, service_role`);
  await client.query(
    `grant select, insert, update, delete on all tables in schema ${schema} to authenticated`,
  );
  await client.query(`grant all on all tables in schema ${schema} to service_role`);
  await client.query(
    `grant usage, select on all sequences in schema ${schema} to authenticated, service_role`,
  );
  await client.query(`revoke all on schema ${schema} from anon`);

  // Record what this schema already has, so the next migration run applies only
  // what is new here.
  for (const source of sources) {
    await client.query(
      `insert into ${schema}.acc_schema_migrations (filename) values ($1) on conflict do nothing`,
      [source.file],
    );
  }

  const registered = await client.query(
    `insert into onebook.company (slug, schema_name, legal_name, is_sample, display_order)
     values ($1, $2, $3, $4, $5) returning id`,
    [input.slug, schema, input.legalName, input.isSample, input.displayOrder],
  );
  const companyId = registered.rows[0].id as string;

  await grantAccess(client, schema, input.slug, input.adminUserIds);
  await refreshExposedSchemas(client);

  // --- Check the work -------------------------------------------------------
  // A provisioning step that reports success without verifying is how a company
  // ends up with three quarters of a ledger and no sign that anything is wrong.
  const built = await companyInventory(client, schema);
  const reference = await companyInventory(client, "public");
  const missingTables = reference.tables.filter((t) => !built.tables.includes(t));
  const missingRoutines = reference.routines.filter((r) => !built.routines.includes(r));
  if (missingTables.length || missingRoutines.length) {
    throw new Error(
      `${schema} is not complete — missing tables: ${missingTables.join(", ") || "none"}; ` +
        `missing functions: ${missingRoutines.join(", ") || "none"}`,
    );
  }

  return {
    companyId,
    schema,
    statementCount: plan.statements.length,
    tableCount: built.tables.length,
    functionCount: built.routines.length,
    policyCount: built.policyCount,
  };
}
