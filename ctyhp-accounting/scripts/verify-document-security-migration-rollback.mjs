// Validate document-security hardening against the linked database.
// The migration and all verification writes are rolled back when not installed.
// Run: node --env-file=.env.local scripts/verify-document-security-migration-rollback.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is not set");

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, "..", "supabase", "migrations", "0056_document_security_hardening.sql"),
  "utf8",
);
const failClosedMigration = readFileSync(
  join(here, "..", "supabase", "migrations", "0057_document_scan_fail_closed.sql"),
  "utf8",
);
const db = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await db.connect();
  await db.query("begin");
  const existing = await db.query(`
    select exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'acc_document_attachment'
         and column_name = 'scan_attempts'
    ) as installed
  `);
  const installed = existing.rows[0].installed;
  if (!installed) await db.query(migration);
  const currentInsertPolicy = await db.query(`
    select coalesce(with_check, '') not like '%not_configured%' as fail_closed
      from pg_policies
     where schemaname = 'public'
       and tablename = 'acc_document_attachment'
       and policyname = 'acc_document_attachment_insert'
  `);
  const failClosed = currentInsertPolicy.rows[0]?.fail_closed === true;
  if (!failClosed) await db.query(failClosedMigration);

  const result = await db.query(`
    select
      (
        select count(*)::int
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'acc_document_attachment'
           and column_name in (
             'scan_attempts', 'scan_started_at', 'scan_completed_at',
             'scan_engine', 'threat_name', 'scan_error'
           )
      ) as scan_columns,
      (
        select count(*)::int
          from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in (
             'acc_update_document_governance',
             'acc_queue_document_scan',
             'acc_begin_document_scan',
             'acc_complete_document_scan'
           )
      ) as security_functions,
      (
        select count(*)::int
          from acc_role_permission
         where permission_key = 'documents.govern'
           and allowed
           and role = 'admin'
      ) as governor_roles,
      (
        select count(*)::int
          from acc_role_permission
         where permission_key = 'documents.govern'
           and allowed
           and role <> 'admin'
      ) as excessive_governors,
      (
        select qual like '%scan_status%'
          from pg_policies
         where schemaname = 'storage'
           and tablename = 'objects'
           and policyname = 'acc_document_object_read'
      ) as scan_gated_storage,
      (
        select with_check like '%scan_status%'
          from pg_policies
         where schemaname = 'public'
           and tablename = 'acc_document_attachment'
           and policyname = 'acc_document_attachment_insert'
      ) as scan_gated_metadata,
      (
        select with_check not like '%not_configured%'
          from pg_policies
         where schemaname = 'public'
           and tablename = 'acc_document_attachment'
           and policyname = 'acc_document_attachment_insert'
      ) as new_uploads_fail_closed
  `);
  const check = result.rows[0];

  assert(check.scan_columns === 6, "Document scan columns are incomplete");
  assert(check.security_functions === 4, "Document security functions are incomplete");
  assert(check.governor_roles === 1, "Admin governance permission is missing");
  assert(check.excessive_governors === 0, "Governance permission is too broad");
  assert(check.scan_gated_storage, "Storage reads are not gated by scan status");
  assert(check.scan_gated_metadata, "Metadata inserts can bypass scan status");
  assert(check.new_uploads_fail_closed, "New uploads can bypass malware scanning");

  console.log(
    JSON.stringify(
      {
        verified: true,
        scanColumns: check.scan_columns,
        securityFunctions: check.security_functions,
        storageFailsClosed: true,
        metadataCannotClaimClean: true,
        governanceRole: "admin",
        persisted: installed && failClosed,
      },
      null,
      2,
    ),
  );
  await db.query("rollback");
} catch (error) {
  try {
    await db.query("rollback");
  } catch {
    // Preserve the original verification failure.
  }
  throw error;
} finally {
  await db.end();
}
