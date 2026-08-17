"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createBackupStorageClient } from "@/lib/db/storage-admin";
import { BACKUP_BUCKET } from "@/lib/services/backup";

const BACKUP_COLUMNS = "id,taken_at,status,skip_reason,size_bytes,control_totals";

/** How many non-`stored` rows (Skipped, Failed) to bring along for context. */
const RECENT_NON_STORED_LIMIT = 60;

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

/**
 * A signed-out caller has to be told that, not sent through the permission
 * check below — that check runs `acc_has_permission` under RLS, which a
 * caller with no session simply fails, and it fails with the same "you do
 * not have permission" wording a signed-in person without the role gets.
 * Both close the door, but only one of them is true; the exported actions in
 * app/(app)/settings/company/actions.ts (exportCompanyDataAction) already
 * separate the two, and this matches that.
 */
async function currentUser(sb: SupabaseClient) {
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user;
}

const SESSION_EXPIRED = "Your session has expired. Sign in again.";

function rowFromRecord(row: Record<string, unknown>): BackupRow {
  return {
    id: row.id as string,
    takenAt: row.taken_at as string,
    status: row.status as BackupRow["status"],
    skipReason: (row.skip_reason as string | null) ?? null,
    // size_bytes is bigint; PostgREST hands bigint back as a string, the
    // same reason lib/services/feedback.ts casts its own size_bytes column
    // with Number() rather than trusting it as a number already.
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes as string | number),
    journalLineCount:
      (row.control_totals as { journalLineCount?: number } | null)?.journalLineCount ?? null,
  };
}

export async function listBackupsAction(): Promise<ActionResult<BackupRow[]>> {
  const sb = await createSupabaseServerClient();
  if (!(await currentUser(sb))) return { ok: false, error: SESSION_EXPIRED };
  if (!(await mayReadBackups(sb))) {
    return { ok: false, error: "You do not have permission to read this company's backups" };
  }
  // `stored` rows are the only ones this screen can act on (Download,
  // Restore), and retention (lib/services/backup.ts: BACKUP_KEEP) already
  // caps how many exist — deleting the oldest past that cap every time a new
  // one is stored. `skipped`/`failed` rows carry no such cap: one gets
  // written every night retention leaves alone, forever, for a company whose
  // books stop changing for a season. A single `order().limit(60)` over both
  // kinds together lets that unbounded pile crowd every downloadable
  // snapshot off the one screen that offers downloads. Fetching `stored`
  // rows on their own, without a limit, keeps them reachable regardless of
  // how long that pile grows; the non-`stored` rows still get a limit, since
  // they are only ever context — nothing on this screen acts on them, so an
  // old one falling off the list costs nothing the way an old `stored` row
  // falling off did.
  const [stored, recent] = await Promise.all([
    sb.from("acc_backup").select(BACKUP_COLUMNS).eq("status", "stored").order("taken_at", { ascending: false }),
    sb
      .from("acc_backup")
      .select(BACKUP_COLUMNS)
      .neq("status", "stored")
      .order("taken_at", { ascending: false })
      .limit(RECENT_NON_STORED_LIMIT),
  ]);
  if (stored.error) return { ok: false, error: stored.error.message };
  if (recent.error) return { ok: false, error: recent.error.message };
  const rows = [...(stored.data ?? []), ...(recent.data ?? [])].sort((a, b) =>
    (b.taken_at as string).localeCompare(a.taken_at as string),
  );
  return { ok: true, data: rows.map(rowFromRecord) };
}

export async function downloadBackupAction(
  id: string,
): Promise<ActionResult<{ url: string; fileName: string }>> {
  const sb = await createSupabaseServerClient();
  if (!(await currentUser(sb))) return { ok: false, error: SESSION_EXPIRED };
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
