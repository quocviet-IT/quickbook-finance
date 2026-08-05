import { timingSafeEqual } from "node:crypto";
import { runDocumentScanAutomationJob } from "@/lib/services/automation-jobs";
import { isDocumentScannerConfigured } from "@/lib/services/document-scanner";

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
  // Checked once for the whole run: no company's attachments can be scanned
  // without a scanner, and saying so beats twenty identical item failures.
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
    const job = await runDocumentScanAutomationJob();
    return Response.json({
      processedAt: new Date().toISOString(),
      ...job,
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
