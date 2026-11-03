"use client";
/**
 * Reading a scanned statement (3.0.3): the file is kept as evidence, as an
 * import keeps it (1.83; the import later finds the same file by its SHA-256),
 * the company's OCR server is asked to read it, and its answer is read by the
 * same rules as a PDF with text. Never throws: every failure comes back as the
 * words to show.
 */
import { glyphsFromOcrPages, ocrResultSchema, OCR_TEXT, type ScannedReading } from "@/lib/domain/ocr-statement";
import { readPdfStatements, type PdfStatement } from "@/lib/domain/pdf-statement";
import { PDF_MESSAGES } from "@/lib/domain/pdf-statement-view";
import type { KeptStatementFile } from "@/lib/client/keep-statement-file";
import type { StatementPeriod } from "@/lib/domain/statement-evidence";
import type { ActionResult } from "@/app/(app)/banking/actions";
import type { OcrJobStatus } from "@/app/(app)/banking/ocr-actions";

const POLL_MS = 3000;
/** Twenty pages at about fifteen seconds each, plus a wait for the server to pick the job up. */
const GIVE_UP_MS = 15 * 60 * 1000;

export interface ScannedStatementDeps {
  keep: (file: File, account: string, period: StatementPeriod) => Promise<KeptStatementFile>;
  request: (savedReportId: string) => Promise<ActionResult<{ jobId: string }>>;
  status: (jobId: string) => Promise<ActionResult<OcrJobStatus>>;
  wait: (ms: number) => Promise<void>;
}

async function defaultDeps(): Promise<ScannedStatementDeps> {
  const [{ keepStatementFile }, actions] = await Promise.all([
    import("@/lib/client/keep-statement-file"),
    import("@/app/(app)/banking/ocr-actions"),
  ]);
  return {
    keep: keepStatementFile,
    request: actions.requestOcrAction,
    status: actions.ocrStatusAction,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export async function readScannedStatement(
  file: File,
  account: string,
  onProgress: (reading: ScannedReading) => void,
  deps?: ScannedStatementDeps,
  options?: { isCancelled?: () => boolean },
): Promise<{ statements: PdfStatement[] } | { message: string }> {
  const cancelled = () => options?.isCancelled?.() === true;
  const stopped = { message: "cancelled" };
  try {
    const d = deps ?? (await defaultDeps());
    onProgress({ phase: "sending" });
    const kept = await d.keep(file, account, { from: null, to: null });
    if (cancelled()) return stopped;
    if (!kept.ok) return { message: `The file could not be sent for reading: ${kept.reason}.` };
    const requested = await d.request(kept.id);
    if (cancelled()) return stopped;
    if (!requested.ok || !requested.data) return { message: requested.error ?? "The reading could not be requested." };

    const started = Date.now();
    while (Date.now() - started < GIVE_UP_MS) {
      if (cancelled()) return stopped;
      const status = await d.status(requested.data.jobId);
      if (cancelled()) return stopped;
      if (!status.ok || !status.data) return { message: status.error ?? "The reading could not be followed." };
      const job = status.data;
      if (job.status === "failed") return { message: job.error ?? "The OCR server could not read this file." };
      if (job.status === "done") {
        const parsed = ocrResultSchema.safeParse(job.result);
        if (!parsed.success) return { message: "The OCR server's answer could not be read." };
        const statements = readPdfStatements(glyphsFromOcrPages(parsed.data.pages));
        return statements.some((s) => s.lines.length) ? { statements } : { message: PDF_MESSAGES.noLines };
      }
      onProgress(job.status === "pending" ? { phase: "waiting" } : { phase: "reading", pagesDone: job.pages_done, pagesTotal: job.pages_total });
      await d.wait(POLL_MS);
      if (cancelled()) return stopped;
    }
    return { message: OCR_TEXT.timedOut };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "An unexpected error occurred" };
  }
}
