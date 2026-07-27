// Validate the Documents & Attachments migration against the linked database.
// The migration and all verification writes are rolled back.
// Run: node --env-file=.env.local scripts/verify-documents-migration-rollback.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  throw new Error("SUPABASE_DB_URL is not set");
}

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, "..", "supabase", "migrations", "0055_documents_attachments.sql"),
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
  const existing = await db.query(
    `select to_regclass('public.acc_document_attachment') is not null as installed`,
  );
  const installed = existing.rows[0].installed;
  if (!installed) {
    await db.query(migration);
  }

  const result = await db.query(`
    select
      to_regclass('public.acc_document_attachment') is not null as attachment_table,
      to_regclass('public.acc_document_access_log') is not null as access_log_table,
      (
        select relrowsecurity
          from pg_class
         where oid = 'public.acc_document_attachment'::regclass
      ) as attachment_rls,
      (
        select count(*)::int
          from pg_policies
         where schemaname = 'public'
           and tablename = 'acc_document_attachment'
      ) as attachment_policies,
      (
        select count(*)::int
          from pg_policies
         where schemaname = 'storage'
           and tablename = 'objects'
           and policyname in (
             'acc_document_object_read',
             'acc_document_object_insert',
             'acc_document_orphan_delete'
           )
      ) as storage_policies,
      (
        select not public
           and file_size_limit = 10485760
           and array_length(allowed_mime_types, 1) = 7
          from storage.buckets
         where id = 'accounting-documents'
      ) as private_bucket,
      (
        select count(*)::int
          from acc_permission
         where key in ('documents.read', 'documents.manage')
           and is_enforced
      ) as permissions,
      (
        select count(*)::int
          from acc_role_permission
         where permission_key = 'documents.manage'
           and allowed
           and role in ('admin', 'accountant')
      ) as manager_roles
  `);
  const check = result.rows[0];

  assert(check.attachment_table, "Attachment table was not created");
  assert(check.access_log_table, "Access-log table was not created");
  assert(check.attachment_rls, "RLS is not enabled");
  assert(check.attachment_policies === 2, "Attachment RLS policies are incomplete");
  assert(check.storage_policies === 3, "Private storage policies are incomplete");
  assert(check.private_bucket, "Storage bucket is not private or is misconfigured");
  assert(check.permissions === 2, "Document permissions are incomplete");
  assert(check.manager_roles === 2, "Document manager roles are incomplete");

  console.log(
    JSON.stringify(
      {
        verified: true,
        rls: true,
        privateBucket: true,
        storagePolicies: check.storage_policies,
        permissions: check.permissions,
        managerRoles: check.manager_roles,
        persisted: installed,
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
