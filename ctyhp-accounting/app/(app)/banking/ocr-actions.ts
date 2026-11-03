"use server";
/**
 * A scanned statement read by the company's own OCR server (3.02): whether the
 * server is there, asking for a kept file to be read, and where that stands.
 * Who may ask, and who may see the answer, is decided again by the onebook
 * functions (0188); these only carry the request.
 */
import { z } from "zod";
import { canWrite, getUserRole } from "@/lib/auth";
import { activeSchema } from "@/lib/db/company";
import { createSupabaseServerClientForSchema } from "@/lib/db/server";
import type { ActionResult } from "./actions";

export interface OcrJobStatus {
  status: "pending" | "running" | "done" | "failed";
  pages_done: number;
  pages_total: number | null;
  result: unknown;
  error: string | null;
}

const ocrConfigured = () => (process.env.OCR_WORKER_SECRET?.trim().length ?? 0) >= 24;

export async function ocrAvailableAction(): Promise<boolean> {
  if (!ocrConfigured()) return false;
  try {
    const sb = await createSupabaseServerClientForSchema("onebook");
    const { data, error } = await sb.rpc("ocr_worker_online");
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function requestOcrAction(savedReportId: string): Promise<ActionResult<{ jobId: string }>> {
  if (!ocrConfigured()) return { ok: false, error: "OCR is not set up for this OneBook." };
  if (!canWrite(await getUserRole())) return { ok: false, error: "You do not have permission to perform this action" };
  const id = z.uuid().safeParse(savedReportId);
  if (!id.success) return { ok: false, error: "That statement file is not kept in this company" };
  try {
    const sb = await createSupabaseServerClientForSchema("onebook");
    const { data, error } = await sb.rpc("request_ocr_job", { p_schema: await activeSchema(), p_saved_report_id: id.data });
    if (error || typeof data !== "string") return { ok: false, error: error?.message ?? "The reading could not be requested" };
    return { ok: true, data: { jobId: data } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "An unexpected error occurred" };
  }
}

export async function ocrStatusAction(jobId: string): Promise<ActionResult<OcrJobStatus>> {
  const id = z.uuid().safeParse(jobId);
  if (!id.success) return { ok: false, error: "That reading does not exist" };
  try {
    const sb = await createSupabaseServerClientForSchema("onebook");
    const { data, error } = await sb.rpc("ocr_job_status", { p_id: id.data });
    if (error) return { ok: false, error: error.message };
    const row = (data as OcrJobStatus[] | null)?.[0];
    return row ? { ok: true, data: row } : { ok: false, error: "That reading does not exist, or is not yours to see" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "An unexpected error occurred" };
  }
}
