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
  // `today` is the one clock reading this whole snapshot is built from — not
  // a fresh one taken here. Stamping the manifest at midnight UTC on `today`
  // keeps `generatedAt`'s date portion equal to `today` by construction, the
  // same day `readControlTotals` above was just asked for.
  const archive = await buildExportArchive({
    datasets,
    controlTotals,
    schemaVersion,
    generatedAt: `${today}T00:00:00.000Z`,
  });

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
    const cleanup = await sb.storage.from(BACKUP_BUCKET).remove([path]);
    if (cleanup.error) {
      // The upload already happened; the row that would have proven it did
      // not. If cleanup also fails, the file is now sitting in the bucket
      // with no audit row and no acc_backup row pointing at it — the only
      // way anyone finds it is if this message says so, in exact terms,
      // rather than asserting the removal that just failed.
      throw new BackupError(
        `The backup was not recorded (${audit.error.message}), and the file could not be removed from storage (${cleanup.error.message}). A copy of taxpayer data was left behind at ${BACKUP_BUCKET}/${path} — it must be deleted by hand.`,
      );
    }
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
  // A path whose blob removal fails keeps its acc_backup row on purpose: that
  // row is the only record of the path, and dropping it here — the way an
  // unchecked remove() used to let happen — makes the leak permanent, since
  // no later retention pass reads a path that has no row.
  //
  // One failure does not stop the pass, though. The expired snapshots are
  // independent of each other, and refusing every other deletion because one
  // path could not be removed would leave a company re-accumulating the
  // noise BACKUP_KEEP exists to prevent, night after night, until a human
  // clears that one path by hand. So the loop keeps going and reports every
  // stuck path at the end — never silently, per the same rule the cleanup
  // failure above follows.
  const stuck: string[] = [];
  for (const expired of expiredBackups(rows, BACKUP_KEEP)) {
    const removal = await sb.storage.from(BACKUP_BUCKET).remove([expired.storagePath]);
    if (removal.error) {
      stuck.push(expired.storagePath);
      continue;
    }
    const deletion = await sb.from("acc_backup").delete().eq("id", expired.id);
    if (deletion.error) throw new BackupError(deletion.error.message);
  }
  if (stuck.length > 0) {
    throw new BackupError(
      `${stuck.length} expired backup file(s) could not be removed from ${BACKUP_BUCKET} and were left in place; their acc_backup rows were kept so a later run can retry: ${stuck.join(", ")}`,
    );
  }
}
