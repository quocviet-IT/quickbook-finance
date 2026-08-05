import { timingSafeEqual } from "node:crypto";
import { runPendingCompanyProvisioning } from "@/lib/services/company-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const configured = process.env.CRON_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (configured.length < 24 || configured.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(configured), Buffer.from(supplied));
}

/**
 * The safety net behind the Create company button.
 *
 * The button schedules the same work with `after`, so this route exists for the
 * cases that leaves out: an invocation that died mid-build, and a retry. The
 * migration file count in the response is also how a deployment proves it
 * actually carries the migration files — without them a company would be built
 * out of nothing.
 */
async function run() {
  const result = await runPendingCompanyProvisioning();
  return Response.json({ processedAt: new Date().toISOString(), ...result });
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return await run();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Company provisioning failed" },
      { status: 500 },
    );
  }
}

/** Vercel cron issues GET; the behaviour is identical. */
export async function GET(request: Request) {
  return POST(request);
}
