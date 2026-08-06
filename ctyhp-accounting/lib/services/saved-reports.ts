import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSavedReportStorageClient } from "@/lib/db/storage-admin";
import {
  isTabularSavedReport,
  SAVED_REPORT_BUCKET,
  savedReportStoragePath,
  type SavedReportRegisterInput,
  type SavedReportSource,
} from "@/lib/domain/saved-reports";

export class SavedReportError extends Error {}

export interface SavedReportRow {
  id: string;
  title: string;
  source: SavedReportSource;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: "active" | "archived";
  uploaded_by: string | null;
  uploaded_at: string;
  archived_at: string | null;
  archive_reason: string | null;
}

const COLUMNS =
  "id,title,source,period_start,period_end,notes,file_name,storage_path,mime_type," +
  "size_bytes,sha256,status,uploaded_by,uploaded_at,archived_at,archive_reason";

/** How long a signed link lives. Long enough to click, short enough to be useless if shared. */
const LINK_SECONDS = 60;

/** The largest slice of a CSV the preview will ever pull across. */
const PREVIEW_BYTES = 1_000_000;

/**
 * A one-time ticket the browser can upload to.
 *
 * The caller has already established that this session may write in this
 * company. The path is minted here rather than accepted from the client, so a
 * request cannot name a path belonging to another company.
 */
export async function createSavedReportUploadTicket(
  companyId: string,
  mimeType: string,
): Promise<{ path: string; token: string }> {
  const path = savedReportStoragePath(companyId, mimeType, crypto.randomUUID());
  const admin = createSavedReportStorageClient();
  const { data, error } = await admin.storage.from(SAVED_REPORT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    throw new SavedReportError(error?.message ?? "Could not prepare the upload");
  }
  return { path, token: data.token };
}

export async function registerSavedReport(
  sb: SupabaseClient,
  input: SavedReportRegisterInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_register_saved_report", {
    p_title: input.title,
    p_source: input.source,
    p_period_start: input.period_start,
    p_period_end: input.period_end,
    p_notes: input.notes,
    p_file_name: input.file_name,
    p_storage_path: input.storage_path,
    p_mime_type: input.mime_type,
    p_size_bytes: input.size_bytes,
    p_sha256: input.sha256,
  });
  if (error) throw new SavedReportError(error.message);
  return data as string;
}

export async function listSavedReports(
  sb: SupabaseClient,
  includeArchived = false,
): Promise<SavedReportRow[]> {
  let query = sb.from("acc_saved_report").select(COLUMNS);
  if (!includeArchived) query = query.eq("status", "active");
  const { data, error } = await query.order("uploaded_at", { ascending: false });
  if (error) throw new SavedReportError(error.message);
  return (data ?? []) as unknown as SavedReportRow[];
}

/**
 * Read the row through the session client first.
 *
 * This is where authorisation for the object happens: the session client is
 * bound to one company's schema and filtered by `documents.read`, so a row it
 * cannot see is a report this request may not have.
 */
async function requireReadableRow(sb: SupabaseClient, id: string): Promise<SavedReportRow> {
  const { data, error } = await sb
    .from("acc_saved_report")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new SavedReportError(error.message);
  if (!data) throw new SavedReportError("Report not found");
  return data as unknown as SavedReportRow;
}

export async function createSavedReportDownloadUrl(
  sb: SupabaseClient,
  id: string,
): Promise<{ url: string; fileName: string }> {
  const row = await requireReadableRow(sb, id);
  const admin = createSavedReportStorageClient();
  const { data, error } = await admin.storage
    .from(SAVED_REPORT_BUCKET)
    .createSignedUrl(row.storage_path, LINK_SECONDS, { download: row.file_name });
  if (error || !data) throw new SavedReportError(error?.message ?? "Could not prepare the download");
  return { url: data.signedUrl, fileName: row.file_name };
}

/**
 * The text of a saved CSV, read by the server so the browser never holds a
 * storage credential for a preview it only renders.
 */
export async function readSavedReportText(sb: SupabaseClient, id: string): Promise<string> {
  const row = await requireReadableRow(sb, id);
  if (!isTabularSavedReport(row.mime_type)) {
    throw new SavedReportError("This report cannot be shown as a table. Download it instead.");
  }
  const admin = createSavedReportStorageClient();
  const { data, error } = await admin.storage.from(SAVED_REPORT_BUCKET).download(row.storage_path);
  if (error || !data) throw new SavedReportError(error?.message ?? "Could not read the report");
  return data.slice(0, PREVIEW_BYTES).text();
}

export async function archiveSavedReport(
  sb: SupabaseClient,
  id: string,
  reason: string,
): Promise<void> {
  const { error } = await sb.rpc("acc_archive_saved_report", { p_id: id, p_reason: reason });
  if (error) throw new SavedReportError(error.message);
}
