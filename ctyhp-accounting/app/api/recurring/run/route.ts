import { bearerMatches } from "@/lib/domain/bearer-secret";
import { runRecurringAutomationJob } from "@/lib/services/automation-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  return bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // The occurrence budget resets for every company, so one busy schedule
    // cannot spend the next company's allowance. The job owns those rules, and
    // runs each company for its own today.
    const job = await runRecurringAutomationJob();
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
