"use client";
import { calculateFileSha256 } from "@/lib/client/documents";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import type { WaveLedgerParse } from "@/lib/domain/wave-ledger";
import {
  createSavedReportUploadTicketAction,
  registerSavedReportAction,
} from "@/app/(app)/reports/saved/actions";

/**
 * Keep the file that was imported, so the ledger can be checked against its
 * source later. Slice 3 already owns every part of this; nothing here is new
 * except the title.
 */
export async function saveLedgerCopy(
  file: File,
  parse: WaveLedgerParse,
): Promise<{ ok: boolean; reportId?: string; error?: string }> {
  try {
    const ticket = await createSavedReportUploadTicketAction("text/csv");
    if (!ticket.ok || !ticket.data) throw new Error(ticket.error ?? "no upload ticket");

    const sb = createSupabaseBrowserClient();
    const upload = await sb.storage
      .from(ticket.data.bucket)
      .uploadToSignedUrl(ticket.data.path, ticket.data.token, file);
    if (upload.error) throw new Error(upload.error.message);

    const registered = await registerSavedReportAction({
      title: `Wave general ledger ${parse.fromDate ?? ""} to ${parse.toDate ?? ""}`.trim(),
      source: "wave",
      period_start: parse.fromDate,
      period_end: parse.toDate,
      notes: `Imported into One Book: ${parse.entries.length} entries, ${parse.lineCount} lines.`,
      file_name: file.name,
      storage_path: ticket.data.path,
      mime_type: "text/csv",
      size_bytes: file.size,
      sha256: await calculateFileSha256(file),
    });
    if (!registered.ok || !registered.data) throw new Error(registered.error ?? "not registered");
    return { ok: true, reportId: registered.data.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}
