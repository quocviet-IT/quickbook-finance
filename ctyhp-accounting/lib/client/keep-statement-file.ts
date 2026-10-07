"use client";
/**
 * Keeps a statement file as evidence (1.83): hashed in the browser, uploaded
 * once to the Reports › Saved store through a one-time ticket, and recorded by
 * the company's own function. The same file — same SHA-256 — is found, not
 * uploaded again. Never throws: a file that cannot be kept comes back with the
 * reason, and whatever was being done with it goes on without it.
 */
import { calculateFileSha256 } from "@/lib/client/documents";
import {
  statementFileMime,
  statementFileRefusal,
  statementFileTitle,
  type StatementPeriod,
} from "@/lib/domain/statement-evidence";
import { keepStatementFileAction, prepareStatementFileAction } from "@/app/(app)/banking/statement-file-actions";

export type KeptStatementFile = { ok: true; id: string } | { ok: false; reason: string };

export async function keepStatementFile(
  file: File,
  account: string,
  period: StatementPeriod,
): Promise<KeptStatementFile> {
  const refusal = statementFileRefusal(file);
  if (refusal) return { ok: false, reason: refusal };
  const mimeType = statementFileMime(file.name, file.type)!;
  try {
    const sha256 = await calculateFileSha256(file);
    const prepared = await prepareStatementFileAction(sha256, mimeType);
    if (!prepared.ok || !prepared.data) return { ok: false, reason: prepared.error ?? "the upload could not be prepared" };
    if ("keptId" in prepared.data) return { ok: true, id: prepared.data.keptId };

    const { path, token, bucket } = prepared.data.ticket;
    const { createSupabaseBrowserClient } = await import("@/lib/db/client");
    // A File goes up as form data carrying its own type, not `contentType`; a
    // browser gives an .ofx/.qfx/.qbo/.qif no type the store accepts. The same
    // bytes are sent as the type the file is kept as.
    const body = file.slice(0, file.size, mimeType);
    const upload = await createSupabaseBrowserClient()
      .storage.from(bucket)
      .uploadToSignedUrl(path, token, body, { contentType: mimeType });
    if (upload.error) return { ok: false, reason: upload.error.message };

    const kept = await keepStatementFileAction({
      title: statementFileTitle(account, period),
      period_start: period.from,
      period_end: period.to,
      file_name: file.name,
      storage_path: path,
      mime_type: mimeType,
      size_bytes: file.size,
      sha256,
    });
    if (!kept.ok || !kept.data) return { ok: false, reason: kept.error ?? "it was not recorded" };
    return { ok: true, id: kept.data.id };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "an unexpected error occurred" };
  }
}
