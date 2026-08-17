import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SAVED_REPORT_BUCKET } from "@/lib/domain/saved-reports";
import { BACKUP_BUCKET } from "@/lib/services/backup";

/**
 * A service-role client for one job: moving bytes in and out of the
 * `onebook-reports` bucket.
 *
 * That bucket has no storage policy for an application session, because a
 * policy on `storage.objects` is a single global object and cannot tell which
 * company is asking. Authorisation therefore happens in the service, against
 * the company schema the request already resolved, and this client only carries
 * what the session client has already agreed to.
 *
 * It must never read or write a table. Accounting data stays under RLS and the
 * role guards, without exception.
 */
export function createSavedReportStorageClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || key.length < 20 || /^REPLACE/i.test(key)) {
    throw new Error(
      `Saving a report needs SUPABASE_SERVICE_ROLE_KEY in the environment; ` +
        `the ${SAVED_REPORT_BUCKET} bucket is private and has no session policy.`,
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A service-role client for one job: minting a signed download link against
 * the `onebook-backups` bucket.
 *
 * Same reasoning as createSavedReportStorageClient above — a policy on
 * storage.objects is one global object and cannot tell which company is
 * asking, so authorisation happens before this client is ever reached: the
 * caller proves the acc_backup row is theirs, under RLS, and only then turns
 * its storage_path into a link. This client must never read or write a table.
 */
export function createBackupStorageClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || key.length < 20 || /^REPLACE/i.test(key)) {
    throw new Error(
      `Downloading a backup needs SUPABASE_SERVICE_ROLE_KEY in the environment; ` +
        `the ${BACKUP_BUCKET} bucket is private and has no session policy.`,
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
