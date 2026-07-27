import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentAttachmentRow } from "@/lib/db/types";
import {
  DOCUMENT_BUCKET,
  documentCanBeAccessed,
  type DocumentAttachmentCreateInput,
} from "@/lib/domain/documents";

export class DocumentsError extends Error {}

const ATTACHMENT_COLUMNS =
  "id,entity_type,entity_id,document_kind,file_name,storage_bucket,storage_path," +
  "mime_type,size_bytes,sha256,description,scan_status,scan_attempts,scan_started_at," +
  "scan_completed_at,scan_engine,threat_name,scan_error,retention_until,legal_hold," +
  "status,uploaded_by,uploaded_at,archived_by,archived_at,archive_reason";

export async function listDocumentAttachments(
  sb: SupabaseClient,
  entityType: string,
  entityId: string,
): Promise<DocumentAttachmentRow[]> {
  const { data, error } = await sb
    .from("acc_document_attachment")
    .select(ATTACHMENT_COLUMNS)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("status", "active")
    .order("uploaded_at", { ascending: false });
  if (error) throw new DocumentsError(error.message);
  return (data ?? []) as unknown as DocumentAttachmentRow[];
}

export async function registerDocumentAttachment(
  sb: SupabaseClient,
  input: DocumentAttachmentCreateInput,
  userId: string,
): Promise<DocumentAttachmentRow> {
  const { data, error } = await sb
    .from("acc_document_attachment")
    .insert({
      ...input,
      description: input.description || null,
      storage_bucket: DOCUMENT_BUCKET,
      uploaded_by: userId,
      scan_status: "pending",
    })
    .select(ATTACHMENT_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new DocumentsError("This file is already attached to this document.");
    }
    throw new DocumentsError(error.message);
  }
  return data as unknown as DocumentAttachmentRow;
}

export async function archiveDocumentAttachment(
  sb: SupabaseClient,
  attachmentId: string,
  reason: string,
): Promise<void> {
  const { error } = await sb.rpc("acc_archive_document_attachment", {
    p_attachment_id: attachmentId,
    p_reason: reason,
  });
  if (error) throw new DocumentsError(error.message);
}

export async function updateDocumentGovernance(
  sb: SupabaseClient,
  attachmentId: string,
  retentionUntil: string | null,
  legalHold: boolean,
  reason: string,
): Promise<void> {
  const { error } = await sb.rpc("acc_update_document_governance", {
    p_attachment_id: attachmentId,
    p_retention_until: retentionUntil,
    p_legal_hold: legalHold,
    p_reason: reason,
  });
  if (error) throw new DocumentsError(error.message);
}

export async function queueDocumentScan(
  sb: SupabaseClient,
  attachmentId: string,
): Promise<void> {
  const { error } = await sb.rpc("acc_queue_document_scan", {
    p_attachment_id: attachmentId,
  });
  if (error) throw new DocumentsError(error.message);
}

export async function createDocumentAccessUrl(
  sb: SupabaseClient,
  attachmentId: string,
  action: "preview" | "download",
): Promise<string> {
  const { data: attachment, error: attachmentError } = await sb
    .from("acc_document_attachment")
    .select("id,file_name,storage_bucket,storage_path,status,scan_status")
    .eq("id", attachmentId)
    .eq("status", "active")
    .maybeSingle();
  if (attachmentError) throw new DocumentsError(attachmentError.message);
  if (!attachment) throw new DocumentsError("Attachment not found.");
  if (!documentCanBeAccessed(attachment.scan_status)) {
    throw new DocumentsError(
      attachment.scan_status === "blocked"
        ? "This attachment was quarantined after a security scan."
        : "This attachment is unavailable until it passes security scanning.",
    );
  }

  const options = action === "download" ? { download: attachment.file_name as string } : undefined;
  const { data, error } = await sb.storage
    .from((attachment.storage_bucket as string) || DOCUMENT_BUCKET)
    .createSignedUrl(attachment.storage_path as string, 60, options);
  if (error) throw new DocumentsError(error.message);

  const { error: logError } = await sb.rpc("acc_log_document_access", {
    p_attachment_id: attachmentId,
    p_action: action,
  });
  if (logError) throw new DocumentsError(logError.message);
  return data.signedUrl;
}
