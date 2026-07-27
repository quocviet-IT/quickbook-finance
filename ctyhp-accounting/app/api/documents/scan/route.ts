import { timingSafeEqual } from "node:crypto";
import { createSupabaseAutomationClient } from "@/lib/db/automation";
import {
  isDocumentScannerConfigured,
  listDocumentsAwaitingScan,
  scanDocumentAttachment,
} from "@/lib/services/document-scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const configured = process.env.CRON_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (configured.length < 24 || configured.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(configured), Buffer.from(supplied));
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDocumentScannerConfigured()) {
    return Response.json(
      {
        error:
          "Document scanning requires DOCUMENT_SCANNER_URL and DOCUMENT_SCANNER_TOKEN.",
      },
      { status: 503 },
    );
  }

  try {
    const sb = createSupabaseAutomationClient();
    const attachments = await listDocumentsAwaitingScan(sb, 20);
    const results: Array<{
      attachmentId: string;
      fileName: string;
      status?: string;
      ok: boolean;
      error?: string;
    }> = [];

    for (const attachment of attachments) {
      try {
        const scanned = await scanDocumentAttachment(sb, attachment.id);
        results.push({
          attachmentId: attachment.id,
          fileName: attachment.file_name,
          status: scanned.scan_status,
          ok: scanned.scan_status === "clean" || scanned.scan_status === "blocked",
          error: scanned.scan_error ?? undefined,
        });
      } catch (error) {
        results.push({
          attachmentId: attachment.id,
          fileName: attachment.file_name,
          ok: false,
          error: error instanceof Error ? error.message : "Document scan failed",
        });
      }
    }

    return Response.json({
      processedAt: new Date().toISOString(),
      attachmentCount: attachments.length,
      results,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Document scanning automation failed",
      },
      { status: 500 },
    );
  }
}
