import { timingSafeEqual } from "node:crypto";
import { runBankFeedAutomationJob } from "@/lib/services/automation-jobs";

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

  try {
    // Every active company, its own quota, two at a time — all of that belongs
    // to the job. A company that fails is reported inside `companies`; only an
    // unreadable register reaches the catch below, because then we do not know
    // who the companies are and a partial run would read as a success.
    const job = await runBankFeedAutomationJob();
    return Response.json({
      synchronizedAt: new Date().toISOString(),
      ...job,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Bank-feed automation failed" },
      { status: 500 },
    );
  }
}
