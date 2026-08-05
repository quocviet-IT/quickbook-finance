import { timingSafeEqual } from "node:crypto";
import { runRecurringAutomationJob } from "@/lib/services/automation-jobs";

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
    // The occurrence budget resets for every company, so one busy schedule
    // cannot spend the next company's allowance. The job owns those rules.
    const job = await runRecurringAutomationJob(asOf);
    return Response.json({
      processedAt: new Date().toISOString(),
      ...job,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Recurring automation failed" },
      { status: 500 },
    );
  }
}
