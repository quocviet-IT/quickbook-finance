import { createClient } from "@supabase/supabase-js";
import pg from "pg";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const databaseUrl = required("SUPABASE_DB_URL");
const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");

const database = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

const forbiddenChecks = {
  anonOpenItems: false,
  anonSettlementLag: false,
  anonAddInventory: false,
  anonReverseInventory: false,
  anonRecomputePo: false,
  userAddInventory: false,
  userReverseInventory: false,
  userRecomputePo: false,
  anonMigrationDml: false,
  userMigrationDml: false,
};

const requiredChecks = {
  userHasPermission: false,
  userLedgerBalances: false,
  userIssueInvoice: false,
  userOpenItems: false,
};

const deploymentStats = {
  securityDefinerAccFunctions: 0,
  anonExecutableAccFunctions: 0,
  authenticatedExecutableAccFunctions: 0,
  authenticatedDirectAccGrants: 0,
  helperForbiddenGrants: 0,
  migrationRoleDmlGrants: 0,
};

async function inspectPrivileges() {
  await database.connect();
  await database.query("begin read only");
  try {
    const { rows } = await database.query(`
      select
        has_function_privilege(
          'anon', 'public.acc_open_items(date)', 'EXECUTE'
        ) as "anonOpenItems",
        has_function_privilege(
          'anon', 'public.acc_settlement_lag(date)', 'EXECUTE'
        ) as "anonSettlementLag",
        has_function_privilege(
          'anon',
          'public.acc_add_inventory_txn(uuid,date,public.acc_inventory_source,uuid,numeric,bigint,uuid,uuid,text)',
          'EXECUTE'
        ) as "anonAddInventory",
        has_function_privilege(
          'anon', 'public.acc_reverse_inventory_for_entry(uuid,date,text)', 'EXECUTE'
        ) as "anonReverseInventory",
        has_function_privilege(
          'anon', 'public.acc_recompute_po_status(uuid)', 'EXECUTE'
        ) as "anonRecomputePo",
        has_function_privilege(
          'authenticated',
          'public.acc_add_inventory_txn(uuid,date,public.acc_inventory_source,uuid,numeric,bigint,uuid,uuid,text)',
          'EXECUTE'
        ) as "userAddInventory",
        has_function_privilege(
          'authenticated', 'public.acc_reverse_inventory_for_entry(uuid,date,text)', 'EXECUTE'
        ) as "userReverseInventory",
        has_function_privilege(
          'authenticated', 'public.acc_recompute_po_status(uuid)', 'EXECUTE'
        ) as "userRecomputePo",
        (
          has_table_privilege('anon', 'public.acc_schema_migrations', 'SELECT') or
          has_table_privilege('anon', 'public.acc_schema_migrations', 'INSERT') or
          has_table_privilege('anon', 'public.acc_schema_migrations', 'UPDATE') or
          has_table_privilege('anon', 'public.acc_schema_migrations', 'DELETE')
        ) as "anonMigrationDml",
        (
          has_table_privilege('authenticated', 'public.acc_schema_migrations', 'SELECT') or
          has_table_privilege('authenticated', 'public.acc_schema_migrations', 'INSERT') or
          has_table_privilege('authenticated', 'public.acc_schema_migrations', 'UPDATE') or
          has_table_privilege('authenticated', 'public.acc_schema_migrations', 'DELETE')
        ) as "userMigrationDml",
        has_function_privilege(
          'authenticated', 'public.acc_has_permission(text)', 'EXECUTE'
        ) as "userHasPermission",
        has_function_privilege(
          'authenticated', 'public.acc_ledger_balances(date,date)', 'EXECUTE'
        ) as "userLedgerBalances",
        has_function_privilege(
          'authenticated', 'public.acc_issue_invoice(uuid,text)', 'EXECUTE'
        ) as "userIssueInvoice",
        has_function_privilege(
          'authenticated', 'public.acc_open_items(date)', 'EXECUTE'
        ) as "userOpenItems"
    `);
    for (const name of Object.keys(forbiddenChecks)) {
      forbiddenChecks[name] = Boolean(rows[0][name]);
    }
    for (const name of Object.keys(requiredChecks)) {
      requiredChecks[name] = Boolean(rows[0][name]);
    }

    const catalog = await database.query(`
      select
        count(*) filter (where p.prosecdef)::int as "securityDefinerAccFunctions",
        count(*) filter (
          where has_function_privilege('anon', p.oid, 'EXECUTE')
        )::int as "anonExecutableAccFunctions",
        count(*) filter (
          where has_function_privilege('authenticated', p.oid, 'EXECUTE')
        )::int as "authenticatedExecutableAccFunctions"
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like 'acc\_%' escape '\'
    `);
    Object.assign(deploymentStats, catalog.rows[0]);

    const directGrants = await database.query(`
      select count(distinct p.oid)::int as count
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) acl
      where n.nspname = 'public'
        and p.proname like 'acc\_%' escape '\'
        and acl.grantee = (select oid from pg_roles where rolname = 'authenticated')
        and acl.privilege_type = 'EXECUTE'
    `);
    deploymentStats.authenticatedDirectAccGrants = directGrants.rows[0].count;

    deploymentStats.helperForbiddenGrants = [
      forbiddenChecks.anonAddInventory,
      forbiddenChecks.anonReverseInventory,
      forbiddenChecks.anonRecomputePo,
      forbiddenChecks.userAddInventory,
      forbiddenChecks.userReverseInventory,
      forbiddenChecks.userRecomputePo,
    ].filter(Boolean).length;

    const migrationGrants = await database.query(`
      select count(*)::int as count
      from (values ('anon'), ('authenticated')) roles(role_name)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) privileges(privilege_name)
      where has_table_privilege(
        roles.role_name,
        'public.acc_schema_migrations',
        privileges.privilege_name
      )
    `);
    deploymentStats.migrationRoleDmlGrants = migrationGrants.rows[0].count;
  } finally {
    await database.query("rollback").catch(() => {});
    await database.end();
  }
}

async function verifyAnonymousRpcIsBlocked() {
  const anonymous = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anonymous.rpc("acc_open_items", {
    p_as_of: new Date().toISOString().slice(0, 10),
  });
  return Boolean(error) && data === null;
}

async function main() {
  await inspectPrivileges();
  const anonymousRpcBlocked = await verifyAnonymousRpcIsBlocked();

  const forbiddenFailures = Object.entries(forbiddenChecks)
    .filter(([, granted]) => granted)
    .map(([name]) => name);
  const requiredFailures = Object.entries(requiredChecks)
    .filter(([, granted]) => !granted)
    .map(([name]) => name);

  console.log(`forbidden_privileges=${forbiddenFailures.length}`);
  console.log(`missing_required_privileges=${requiredFailures.length}`);
  console.log(`anonymous_rpc_blocked=${anonymousRpcBlocked}`);
  for (const [name, count] of Object.entries(deploymentStats)) {
    console.log(`${name}=${count}`);
  }

  const failures = [
    ...forbiddenFailures.map((name) => `forbidden:${name}`),
    ...requiredFailures.map((name) => `missing:${name}`),
    ...(anonymousRpcBlocked ? [] : ["anonymous_rpc:acc_open_items"]),
  ];
  if (failures.length) {
    throw new Error(`Production security verification failed: ${failures.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Security verification failed");
  process.exitCode = 1;
});
