"use server";

import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseAutomationClient } from "@/lib/db/automation";
import type { DocumentAttachmentRow } from "@/lib/db/types";
import {
  documentAccessSchema,
  documentArchiveSchema,
  documentAttachmentCreateSchema,
  documentAttachmentQuerySchema,
  documentGovernanceSchema,
  documentRescanSchema,
} from "@/lib/domain/documents";
import {
  archiveDocumentAttachment,
  createDocumentAccessUrl,
  DocumentsError,
  listDocumentAttachments,
  queueDocumentScan,
  registerDocumentAttachment,
  updateDocumentGovernance,
} from "@/lib/services/documents";
import {
  isDocumentScannerConfigured,
  scanDocumentAttachment,
} from "@/lib/services/document-scanner";

export interface DocumentActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function authorize(
  permission: "documents.read" | "documents.manage" | "documents.govern",
) {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." } as const;

  const { data, error } = await sb.rpc("acc_has_permission", { p_key: permission });
  if (error || data !== true) {
    return {
      error:
        permission === "documents.read"
          ? "You do not have permission to read supporting documents."
          : permission === "documents.govern"
            ? "You do not have permission to govern document retention."
          : "You do not have permission to manage supporting documents.",
    } as const;
  }
  return { sb, user } as const;
}

function message(error: unknown): string {
  if (error instanceof DocumentsError || error instanceof Error) return error.message;
  return "An unexpected document error occurred.";
}

export async function listDocumentAttachmentsAction(
  raw: unknown,
): Promise<DocumentActionResult<DocumentAttachmentRow[]>> {
  const parsed = documentAttachmentQuerySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid document reference." };
  const context = await authorize("documents.read");
  if ("error" in context) return { ok: false, error: context.error };

  try {
    return {
      ok: true,
      data: await listDocumentAttachments(
        context.sb,
        parsed.data.entity_type,
        parsed.data.entity_id,
      ),
    };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function registerDocumentAttachmentAction(
  raw: unknown,
): Promise<DocumentActionResult<DocumentAttachmentRow>> {
  const parsed = documentAttachmentCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid attachment." };
  }
  const expectedPrefix = `${parsed.data.entity_type}/${parsed.data.entity_id}/`;
  if (!parsed.data.storage_path.startsWith(expectedPrefix)) {
    return { ok: false, error: "The upload path does not match this document." };
  }

  const context = await authorize("documents.manage");
  if ("error" in context) return { ok: false, error: context.error };
  if (!isDocumentScannerConfigured()) {
    return {
      ok: false,
      error:
        "Document upload is disabled until DOCUMENT_SCANNER_URL and DOCUMENT_SCANNER_TOKEN are configured.",
    };
  }
  try {
    const attachment = await registerDocumentAttachment(
      context.sb,
      parsed.data,
      context.user.id,
    );

    try {
      return {
        ok: true,
        data: await scanDocumentAttachment(
          createSupabaseAutomationClient(),
          attachment.id,
        ),
      };
    } catch {
      // The upload remains safely pending. The cron and retry action can resume
      // scanning without losing the accounting evidence.
      return { ok: true, data: attachment };
    }
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function archiveDocumentAttachmentAction(
  raw: unknown,
): Promise<DocumentActionResult> {
  const parsed = documentArchiveSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid archive request." };
  }
  const context = await authorize("documents.manage");
  if ("error" in context) return { ok: false, error: context.error };
  try {
    await archiveDocumentAttachment(context.sb, parsed.data.attachment_id, parsed.data.reason);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function createDocumentAccessUrlAction(
  raw: unknown,
): Promise<DocumentActionResult<{ url: string }>> {
  const parsed = documentAccessSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid document access request." };
  const context = await authorize("documents.read");
  if ("error" in context) return { ok: false, error: context.error };
  try {
    return {
      ok: true,
      data: {
        url: await createDocumentAccessUrl(
          context.sb,
          parsed.data.attachment_id,
          parsed.data.action,
        ),
      },
    };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function rescanDocumentAttachmentAction(
  raw: unknown,
): Promise<DocumentActionResult<DocumentAttachmentRow>> {
  const parsed = documentRescanSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid scan request." };
  if (!isDocumentScannerConfigured()) {
    return {
      ok: false,
      error: "Set DOCUMENT_SCANNER_URL and DOCUMENT_SCANNER_TOKEN to scan documents.",
    };
  }

  const context = await authorize("documents.manage");
  if ("error" in context) return { ok: false, error: context.error };
  try {
    await queueDocumentScan(context.sb, parsed.data.attachment_id);
    return {
      ok: true,
      data: await scanDocumentAttachment(
        createSupabaseAutomationClient(),
        parsed.data.attachment_id,
      ),
    };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function updateDocumentGovernanceAction(
  raw: unknown,
): Promise<DocumentActionResult> {
  const parsed = documentGovernanceSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid governance change.",
    };
  }
  const context = await authorize("documents.govern");
  if ("error" in context) return { ok: false, error: context.error };
  try {
    await updateDocumentGovernance(
      context.sb,
      parsed.data.attachment_id,
      parsed.data.retention_until,
      parsed.data.legal_hold,
      parsed.data.reason,
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}
