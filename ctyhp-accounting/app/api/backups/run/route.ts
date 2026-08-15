import { timingSafeEqual } from "node:crypto";
import { runDueCompanyBackups } from "@/lib/services/backup-queue-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const configured = process.env.CRON_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (configured.length < 24 || configured.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(configured), Buffer.from(supplied));
}

/**
 * Tonight's snapshots.
 *
 * Covers a batch of the companies waiting longest rather than all of them: one
 * company already takes 18.6 seconds to read, and a run that sweeps everybody
 * is a run that eventually covers nobody.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runDueCompanyBackups();
    return Response.json({ processedAt: new Date().toISOString(), ...result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Backups failed" },
      { status: 500 },
    );
  }
}

/** Vercel cron issues GET; the behaviour is identical. */
export async function GET(request: Request) {
  return POST(request);
}
