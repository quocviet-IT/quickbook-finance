import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAutomationClient } from "@/lib/db/automation";
import { createSavedReportStorageClient } from "@/lib/db/storage-admin";
import type { OcrResult } from "@/lib/domain/ocr-statement";
import { SAVED_REPORT_BUCKET } from "@/lib/domain/saved-reports";

/** Long enough to download a 10 MB file over a slow office line, short enough to be useless if it leaks. */
const DOWNLOAD_SECONDS = 600;

export interface ClaimedOcrJob {
  id: string;
  downloadUrl: string;
  mimeType: string;
  attempts: number;
}

/** The worker's side of the queue (0188) is the service role on the onebook schema; its functions refuse anyone else. */
function queue(): SupabaseClient {
  return createSupabaseAutomationClient("onebook");
}

async function flag(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data === true;
}

export async function claimOcrJob(
  version: string,
  sb: SupabaseClient = queue(),
  storage: SupabaseClient = createSavedReportStorageClient(),
): Promise<ClaimedOcrJob | null> {
  const { data, error } = await sb.rpc("claim_ocr_job", { p_worker_version: version.slice(0, 100) });
  if (error) throw new Error(error.message);
  const job = (data as { id: string; storage_path: string; mime_type: string; attempts: number }[] | null)?.[0];
  if (!job) return null;
  const signed = await storage.storage.from(SAVED_REPORT_BUCKET).createSignedUrl(job.storage_path, DOWNLOAD_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    await flag(sb, "fail_ocr_job", { p_id: job.id, p_error: "OneBook could not open the kept file for reading." });
    return null;
  }
  return { id: job.id, downloadUrl: signed.data.signedUrl, mimeType: job.mime_type, attempts: job.attempts };
}

export function reportOcrProgress(id: string, pagesDone: number, pagesTotal: number, sb: SupabaseClient = queue()) {
  return flag(sb, "report_ocr_progress", { p_id: id, p_pages_done: pagesDone, p_pages_total: pagesTotal });
}

export function completeOcrJob(id: string, result: OcrResult, sb: SupabaseClient = queue()) {
  return flag(sb, "complete_ocr_job", { p_id: id, p_result: result });
}

export function failOcrJob(id: string, error: string, sb: SupabaseClient = queue()) {
  return flag(sb, "fail_ocr_job", { p_id: id, p_error: error });
}
