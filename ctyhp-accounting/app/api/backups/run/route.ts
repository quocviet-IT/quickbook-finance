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
    // Vercel's cron log keeps path, status and duration and discards the
    // body — the same fact /api/health's httpStatusFor is built on. A run
    // that touched every company but failed some of them must not read as
    // identical, by status code alone, to a clean night: each per-company
    // failure is already logged where it happened (see
    // backup-queue-runner.ts), and this status is what makes the run itself
    // visible to whoever only ever looks at the status column.
    const status = result.failed > 0 ? 500 : 200;
    return Response.json({ processedAt: new Date().toISOString(), ...result }, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backups failed";
    // The response body is where this message lives for a caller, but
    // Vercel's cron log keeps only path, status and duration and discards
    // the body — the same fact the 500-on-failed-company branch above
    // already accounts for. Without this line, a failure this early (the
    // company register itself unreadable, nothing attempted) leaves an empty
    // function log behind a bare 500, indistinguishable from a per-company
    // failure logged and lost some other way.
    console.error("Nightly backup run failed before it could produce a result:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

/** Vercel cron issues GET; the behaviour is identical. */
export async function GET(request: Request) {
  return POST(request);
}
