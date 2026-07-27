"use server";

import { createSupabaseServerClient } from "@/lib/db/server";
import type { DocumentAttachmentRow } from "@/lib/db/types";
import {
  documentAccessSchema,
  documentArchiveSchema,
  documentAttachmentCreateSchema,
  documentAttachmentQuerySchema,
} from "@/lib/domain/documents";
import {
  archiveDocumentAttachment,
  createDocumentAccessUrl,
  DocumentsError,
  listDocumentAttachments,
  registerDocumentAttachment,
} from "@/lib/services/documents";

export interface DocumentActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function authorize(permission: "documents.read" | "documents.manage") {
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
  try {
    return {
      ok: true,
      data: await registerDocumentAttachment(context.sb, parsed.data, context.user.id),
    };
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
