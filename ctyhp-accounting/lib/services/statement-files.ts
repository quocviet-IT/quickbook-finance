import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSavedReportStorageClient } from "@/lib/db/storage-admin";
import { SAVED_REPORT_BUCKET } from "@/lib/domain/saved-reports";
import type { StatementFileKeepInput } from "@/lib/domain/statement-evidence";

/**
 * The statement file kept beside what was read from it (1.83), in the
 * Reports › Saved store. The rows are read and written through the session —
 * the company's schema, its policies and its functions decide; the storage
 * client only moves bytes the session has already agreed to.
 */
export class StatementFileError extends Error {}

/** The active kept file with this SHA-256, if any: the same file is kept once. */
export async function findKeptStatementFile(sb: SupabaseClient, sha256: string): Promise<string | null> {
  const { data, error } = await sb
    .from("acc_saved_report")
    .select("id")
    .eq("sha256", sha256)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new StatementFileError(error.message);
  return (data as { id: string } | null)?.id ?? null;
}

/** Keeps the uploaded file, or finds it kept already — two people keeping it at once still give one row. */
export async function keepStatementFile(
  sb: SupabaseClient,
  input: StatementFileKeepInput,
): Promise<{ id: string; reused: boolean }> {
  const { data, error } = await sb.rpc("acc_keep_statement_file", {
    p_title: input.title,
    p_period_start: input.period_start,
    p_period_end: input.period_end,
    p_file_name: input.file_name,
    p_storage_path: input.storage_path,
    p_mime_type: input.mime_type,
    p_size_bytes: input.size_bytes,
    p_sha256: input.sha256,
  });
  if (error) throw new StatementFileError(error.message);
  const kept = data as { id: string; reused: boolean };
  return { id: kept.id, reused: Boolean(kept.reused) };
}

/**
 * Removes an upload no row points at: the copy made redundant when the same
 * file turned out to be kept already, or one whose keeping failed. Only in the
 * company's own folder, and never a path a row of this company names. Best
 * effort — an orphan left behind costs storage, not correctness.
 */
export async function removeUnkeptUpload(sb: SupabaseClient, folder: string, path: string): Promise<void> {
  if (!/^[a-z0-9_]+$/.test(folder)) return;
  if (!new RegExp(`^${folder}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(pdf|csv|txt)$`).test(path)) return;
  const { data, error } = await sb.from("acc_saved_report").select("id").eq("storage_path", path).maybeSingle();
  if (error || data) return;
  await createSavedReportStorageClient().storage.from(SAVED_REPORT_BUCKET).remove([path]);
}

/** Attaches a kept file to a reconciliation that has none (Attach the statement). */
export async function linkReconciliationStatementFile(sb: SupabaseClient, reconciliationId: string, fileId: string): Promise<void> {
  const { error } = await sb.rpc("acc_link_reconciliation_statement_file", {
    p_reconciliation_id: reconciliationId,
    p_file_id: fileId,
  });
  if (error) throw new StatementFileError(error.message);
}

/** Points a statement import at the file its lines were read from; set once. */
export async function linkImportBatchStatementFile(sb: SupabaseClient, batchId: string, fileId: string): Promise<void> {
  const { error } = await sb.rpc("acc_link_import_batch_statement_file", { p_batch_id: batchId, p_file_id: fileId });
  if (error) throw new StatementFileError(error.message);
}
