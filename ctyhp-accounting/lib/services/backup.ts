import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expiredBackups, shouldSkip, snapshotDescription, snapshotHash } from "@/lib/domain/backup";
import {
  buildExportArchive,
  collectExportDatasets,
  readControlTotals,
  readSchemaVersion,
} from "@/lib/services/company-export";

export class BackupError extends Error {}

/** Private, and shaped like `onebook-reports`, which already holds saved files. */
export const BACKUP_BUCKET = "onebook-backups";

/** How many snapshots a company keeps. Size is not the constraint; noise is. */
export const BACKUP_KEEP = 30;

/**
 * Takes tonight's snapshot, or decides there is nothing worth keeping.
 *
 * `sb` is expected to be a service-role client scoped to the one company's
 * schema, the same shape the other background jobs already use — a cron tick
 * has no signed-in session to carry a permission check for.
 */
export async function takeCompanyBackup(
  sb: SupabaseClient,
  companyId: string,
  today: string,
): Promise<{
  status: "stored" | "skipped";
  hash: string;
  path: string | null;
  sizeBytes: number | null;
}> {
  const datasets = await collectExportDatasets(sb);
  const controlTotals = await readControlTotals(sb, today);
  const schemaVersion = await readSchemaVersion(sb);
  const archive = await buildExportArchive({ datasets, controlTotals, schemaVersion, asOf: today });

  // `archive.manifest` still carries `generatedAt`/`generatedBy` — a ZIP built
  // from unchanged books embeds a new timestamp every night regardless.
  // `snapshotDescription` is the one place that strips them before the hash
  // is taken; building a `{path: sha256}` record here by hand would compile
  // just as well (it only has to be a plain `Record<string, string>`) and
  // would silently defeat every night's comparison — the hash would move
  // even when nothing changed, `shouldSkip` would never fire, and a snapshot
  // would be written every night without a single error to say so.
  const hash = await snapshotHash(snapshotDescription(archive.manifest));

  const previous = await sb
    .from("acc_backup")
    .select("content_hash")
    .eq("status", "stored")
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previous.error) throw new BackupError(previous.error.message);
  const previousHash = (previous.data?.content_hash as string | undefined) ?? null;

  if (shouldSkip(hash, previousHash)) {
    const { error } = await sb.from("acc_backup").insert({
      taken_at: today,
      content_hash: hash,
      storage_path: null,
      size_bytes: null,
      schema_version: schemaVersion,
      control_totals: controlTotals,
      status: "skipped",
      skip_reason: "The books have not changed since the last snapshot",
    });
    if (error) throw new BackupError(error.message);
    return { status: "skipped", hash, path: null, sizeBytes: null };
  }

  const path = `${companyId}/${today}-${hash.slice(0, 8)}.zip`;
  const upload = await sb.storage
    .from(BACKUP_BUCKET)
    .upload(path, archive.bytes, { contentType: "application/zip", upsert: true });
  if (upload.error) throw new BackupError(upload.error.message);

  // The snapshot carries acc_vendor_tax_profile, so it is taxpayer data
  // leaving the database. The manual export withholds the archive when this
  // write fails; the file here is already up by this point, so on failure it
  // comes back down instead — no audit row, no stored file, exactly as
  // US-FR-013 requires of the button this job reuses.
  //
  // Generated up front so the audit row and the acc_backup row below name the
  // same id, the way a trigger-written audit row names the row it is about.
  const backupId = crypto.randomUUID();
  const audit = await sb.from("acc_audit_log").insert({
    table_name: "acc_backup",
    record_id: backupId,
    action: "company.backup",
    after_json: { storage_path: path, content_hash: hash, included_sensitive: true },
  });
  if (audit.error) {
    await sb.storage.from(BACKUP_BUCKET).remove([path]);
    throw new BackupError(`The backup was not recorded, so it was not kept: ${audit.error.message}`);
  }

  const { error } = await sb.from("acc_backup").insert({
    id: backupId,
    taken_at: today,
    content_hash: hash,
    storage_path: path,
    size_bytes: archive.bytes.byteLength,
    schema_version: schemaVersion,
    control_totals: controlTotals,
    status: "stored",
    skip_reason: null,
  });
  if (error) throw new BackupError(error.message);

  await applyRetention(sb);
  return { status: "stored", hash, path, sizeBytes: archive.bytes.byteLength };
}

/** Delete oldest-first, so an interrupted run never eats the newest snapshot. */
async function applyRetention(sb: SupabaseClient): Promise<void> {
  const { data, error } = await sb
    .from("acc_backup")
    .select("id,taken_at,storage_path")
    .eq("status", "stored")
    .order("taken_at", { ascending: false });
  if (error) throw new BackupError(error.message);
  const rows = ((data ?? []) as Array<{ id: string; taken_at: string; storage_path: string }>).map(
    (row) => ({ id: row.id, takenAt: row.taken_at, storagePath: row.storage_path }),
  );
  for (const expired of expiredBackups(rows, BACKUP_KEEP)) {
    await sb.storage.from(BACKUP_BUCKET).remove([expired.storagePath]);
    const removal = await sb.from("acc_backup").delete().eq("id", expired.id);
    if (removal.error) throw new BackupError(removal.error.message);
  }
}
