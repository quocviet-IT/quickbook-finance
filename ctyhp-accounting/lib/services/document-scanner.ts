import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentAttachmentRow, DocumentScanStatus } from "@/lib/db/types";
import {
  DOCUMENT_BUCKET,
  documentScannerResponseSchema,
} from "@/lib/domain/documents";
import { DocumentsError } from "@/lib/services/documents";

const SCAN_COLUMNS =
  "id,entity_type,entity_id,document_kind,file_name,storage_bucket,storage_path," +
  "mime_type,size_bytes,sha256,description,scan_status,scan_attempts,scan_started_at," +
  "scan_completed_at,scan_engine,threat_name,scan_error,retention_until,legal_hold," +
  "status,uploaded_by,uploaded_at,archived_by,archived_at,archive_reason";

interface ScannerConfig {
  url: string;
  token: string;
}

function scannerConfig(): ScannerConfig | null {
  const rawUrl = process.env.DOCUMENT_SCANNER_URL?.trim() ?? "";
  const token = process.env.DOCUMENT_SCANNER_TOKEN?.trim() ?? "";
  if (!rawUrl || token.length < 24 || /^REPLACE/i.test(token)) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return null;
    }
    return { url: url.toString(), token };
  } catch {
    return null;
  }
}

export function isDocumentScannerConfigured(): boolean {
  return scannerConfig() !== null;
}

async function getAttachment(
  sb: SupabaseClient,
  attachmentId: string,
): Promise<DocumentAttachmentRow> {
  const { data, error } = await sb
    .from("acc_document_attachment")
    .select(SCAN_COLUMNS)
    .eq("id", attachmentId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new DocumentsError(error.message);
  if (!data) throw new DocumentsError("Active attachment not found.");
  return data as unknown as DocumentAttachmentRow;
}

async function completeScan(
  sb: SupabaseClient,
  attachmentId: string,
  status: Extract<DocumentScanStatus, "clean" | "blocked" | "error">,
  engine: string,
  threatName?: string,
  errorMessage?: string,
): Promise<DocumentAttachmentRow> {
  const { error } = await sb.rpc("acc_complete_document_scan", {
    p_attachment_id: attachmentId,
    p_status: status,
    p_engine: engine,
    p_threat_name: threatName ?? null,
    p_error: errorMessage ?? null,
  });
  if (error) throw new DocumentsError(error.message);
  return getAttachment(sb, attachmentId);
}

export async function scanDocumentAttachment(
  sb: SupabaseClient,
  attachmentId: string,
): Promise<DocumentAttachmentRow> {
  const config = scannerConfig();
  if (!config) {
    throw new DocumentsError(
      "Document scanning requires DOCUMENT_SCANNER_URL and DOCUMENT_SCANNER_TOKEN.",
    );
  }

  const attachment = await getAttachment(sb, attachmentId);
  const { error: beginError } = await sb.rpc("acc_begin_document_scan", {
    p_attachment_id: attachment.id,
  });
  if (beginError) throw new DocumentsError(beginError.message);

  try {
    const { data: file, error: downloadError } = await sb.storage
      .from(attachment.storage_bucket || DOCUMENT_BUCKET)
      .download(attachment.storage_path);
    if (downloadError || !file) {
      throw new Error(downloadError?.message ?? "Stored file could not be downloaded");
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== attachment.size_bytes || digest !== attachment.sha256) {
      return completeScan(
        sb,
        attachment.id,
        "blocked",
        "CTYHP integrity verifier",
        "Stored file integrity mismatch",
      );
    }

    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": attachment.mime_type,
        "x-document-name": encodeURIComponent(attachment.file_name),
        "x-document-sha256": attachment.sha256,
      },
      body: bytes,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`Scanner returned HTTP ${response.status}`);
    }

    const rawResult: unknown = await response.json();
    const parsed = documentScannerResponseSchema.safeParse(rawResult);
    if (!parsed.success) throw new Error("Scanner returned an invalid response");

    const engine = parsed.data.engine ?? "Configured malware scanner";
    if (parsed.data.verdict === "blocked") {
      return completeScan(
        sb,
        attachment.id,
        "blocked",
        engine,
        parsed.data.threat,
      );
    }
    return completeScan(sb, attachment.id, "clean", engine);
  } catch (error) {
    const safeMessage = (
      error instanceof Error ? error.message : "Document scan failed"
    ).slice(0, 500);
    return completeScan(
      sb,
      attachment.id,
      "error",
      "Configured malware scanner",
      undefined,
      safeMessage,
    );
  }
}

export async function listDocumentsAwaitingScan(
  sb: SupabaseClient,
  limit = 20,
): Promise<Array<{ id: string; file_name: string }>> {
  const { data, error } = await sb
    .from("acc_document_attachment")
    .select("id,file_name")
    .eq("status", "active")
    .in("scan_status", ["pending", "error"])
    .lt("scan_attempts", 5)
    .order("uploaded_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 50)));
  if (error) throw new DocumentsError(error.message);
  return (data ?? []) as Array<{ id: string; file_name: string }>;
}
