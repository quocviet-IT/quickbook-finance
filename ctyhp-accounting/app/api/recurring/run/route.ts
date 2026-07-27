import { timingSafeEqual } from "node:crypto";
import { createSupabaseAutomationClient } from "@/lib/db/automation";
import {
  generateRecurringTemplate,
  listDueRecurringTemplates,
} from "@/lib/services/recurring";
import { nextRecurringDate } from "@/lib/domain/recurring";

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

  const asOf = new Date().toISOString().slice(0, 10);
  try {
    const sb = createSupabaseAutomationClient();
    const templates = await listDueRecurringTemplates(sb, asOf, 50);
    const results: Array<{
      templateId: string;
      name: string;
      scheduledDate: string;
      ok: boolean;
      status?: string;
      documentId?: string | null;
      error?: string;
    }> = [];

    let occurrenceCount = 0;
    for (const template of templates) {
      let scheduledDate = template.next_run_date;
      let scheduleOccurrences = 0;
      while (
        scheduledDate <= asOf &&
        (!template.end_date || scheduledDate <= template.end_date) &&
        scheduleOccurrences < 12 &&
        occurrenceCount < 100
      ) {
        try {
          const result = await generateRecurringTemplate(sb, template.id);
          results.push({
            templateId: template.id,
            name: template.name,
            scheduledDate,
            ok: true,
            status: result.status,
            documentId: result.documentId,
          });
          if (!result.claimed) break;
          scheduledDate = nextRecurringDate(
            scheduledDate,
            template.start_date,
            template.frequency,
            template.interval_count,
          );
          scheduleOccurrences += 1;
          occurrenceCount += 1;
        } catch (error) {
          results.push({
            templateId: template.id,
            name: template.name,
            scheduledDate,
            ok: false,
            error: error instanceof Error ? error.message : "Generation failed",
          });
          break;
        }
      }
    }

    return Response.json({
      processedAt: new Date().toISOString(),
      asOf,
      scheduleCount: templates.length,
      results,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Recurring automation failed" },
      { status: 500 },
    );
  }
}
