"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createBackupStorageClient } from "@/lib/db/storage-admin";
import { BACKUP_BUCKET } from "@/lib/services/backup";

/** Long enough to click, short enough that a copied link is a spare key for long. */
const LINK_SECONDS = 300;

/** The shape the settings actions in this repository already return. */
export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface BackupRow {
  id: string;
  takenAt: string;
  status: "stored" | "skipped" | "failed";
  skipReason: string | null;
  sizeBytes: number | null;
  journalLineCount: number | null;
}

/**
 * Reading a snapshot is gated on company.export (supabase/migrations/0114_
 * backups.sql: "the same data by the same means as company.export"), the same
 * permission the manual export button already checks in
 * app/(app)/settings/company/actions.ts. Restoring is a separate, larger
 * permission (company.restore) that only the page — not these two actions —
 * needs to know about, to decide whether to offer the restore button at all.
 */
async function mayReadBackups(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc("acc_has_permission", { p_key: "company.export" });
  // A permission lookup that failed is not a permission granted.
  return !error && data === true;
}

export async function listBackupsAction(): Promise<ActionResult<BackupRow[]>> {
  const sb = await createSupabaseServerClient();
  if (!(await mayReadBackups(sb))) {
    return { ok: false, error: "You do not have permission to read this company's backups" };
  }
  const { data, error } = await sb
    .from("acc_backup")
    .select("id,taken_at,status,skip_reason,size_bytes,control_totals")
    .order("taken_at", { ascending: false })
    .limit(60);
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id as string,
      takenAt: row.taken_at as string,
      status: row.status as BackupRow["status"],
      skipReason: (row.skip_reason as string | null) ?? null,
      // size_bytes is bigint; PostgREST hands bigint back as a string, the
      // same reason lib/services/feedback.ts casts its own size_bytes column
      // with Number() rather than trusting it as a number already.
      sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      journalLineCount:
        (row.control_totals as { journalLineCount?: number } | null)?.journalLineCount ?? null,
    })),
  };
}

export async function downloadBackupAction(
  id: string,
): Promise<ActionResult<{ url: string; fileName: string }>> {
  const sb = await createSupabaseServerClient();
  if (!(await mayReadBackups(sb))) {
    return { ok: false, error: "You do not have permission to download this company's backups" };
  }
  // Read the row through the caller's own client first. The admin client below
  // ignores row-level security, so the row must be proven readable by the
  // person asking before it is used to mint a link.
  const { data, error } = await sb
    .from("acc_backup")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data?.storage_path) return { ok: false, error: "That snapshot has no stored file." };
  const path = data.storage_path as string;
  const fileName = path.split("/").pop() ?? "backup.zip";
  const admin = createBackupStorageClient();
  const signed = await admin.storage
    .from(BACKUP_BUCKET)
    .createSignedUrl(path, LINK_SECONDS, { download: fileName });
  if (signed.error || !signed.data) {
    return { ok: false, error: signed.error?.message ?? "Could not prepare the download" };
  }
  return { ok: true, data: { url: signed.data.signedUrl, fileName } };
}
