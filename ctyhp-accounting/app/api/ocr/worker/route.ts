import { z } from "zod";
import { OCR_MAX_PAGES, ocrResultSchema } from "@/lib/domain/ocr-statement";
import { workerAccess } from "@/lib/domain/ocr-worker-auth";
import { claimOcrJob, completeOcrJob, failOcrJob, reportOcrProgress } from "@/lib/services/ocr-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The company's OCR server asks for work and answers it here (3.0.3). It sits
 * inside the office network and only ever calls out, so this is the only way
 * work reaches it. Twenty pages of text is far below Vercel's 4.5 MB body cap.
 */
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), version: z.string().max(100) }),
  z.object({
    action: z.literal("progress"),
    id: z.uuid(),
    pagesDone: z.number().int().min(0).max(OCR_MAX_PAGES),
    pagesTotal: z.number().int().min(1).max(OCR_MAX_PAGES),
  }),
  z.object({ action: z.literal("complete"), id: z.uuid(), result: ocrResultSchema }),
  z.object({ action: z.literal("fail"), id: z.uuid(), error: z.string().max(2000) }),
]);

export async function POST(request: Request) {
  const access = workerAccess(request.headers.get("authorization"), process.env.OCR_WORKER_SECRET);
  if (access === "disabled") return Response.json({ error: "Not found" }, { status: 404 });
  if (access === "unauthorized") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const body = parsed.data;
  try {
    switch (body.action) {
      case "claim": {
        const job = await claimOcrJob(body.version);
        return job ? Response.json({ job }) : new Response(null, { status: 204 });
      }
      case "progress":
        return Response.json({ ok: await reportOcrProgress(body.id, body.pagesDone, body.pagesTotal) });
      case "complete":
        return Response.json({ ok: await completeOcrJob(body.id, body.result) });
      case "fail":
        return Response.json({ ok: await failOcrJob(body.id, body.error) });
    }
  } catch (error) {
    console.error("OCR worker request failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "The OCR queue failed" }, { status: 500 });
  }
}
