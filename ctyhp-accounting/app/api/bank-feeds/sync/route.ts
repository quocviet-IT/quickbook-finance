import { timingSafeEqual } from "node:crypto";
import { createSupabaseAutomationClient } from "@/lib/db/automation";
import { listBankConnections, syncBankConnection } from "@/lib/services/banking";

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
    const sb = createSupabaseAutomationClient();
    const connections = (await listBankConnections(sb))
      .filter((connection) => connection.status !== "disconnected")
      .slice(0, 20);
    const results: Array<{
      connectionId: string;
      institution: string;
      ok: boolean;
      added?: number;
      modified?: number;
      removed?: number;
      suggestions?: number;
      error?: string;
    }> = [];

    // Sequential by design: it avoids provider bursts and keeps one connection's
    // cursor update isolated from every other institution.
    for (const connection of connections) {
      try {
        const result = await syncBankConnection(sb, connection.id);
        results.push({
          connectionId: connection.id,
          institution: connection.institution_name,
          ok: true,
          ...result,
        });
      } catch (error) {
        results.push({
          connectionId: connection.id,
          institution: connection.institution_name,
          ok: false,
          error: error instanceof Error ? error.message : "Synchronization failed",
        });
      }
    }

    return Response.json({
      synchronizedAt: new Date().toISOString(),
      connectionCount: connections.length,
      results,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Bank-feed automation failed" },
      { status: 500 },
    );
  }
}
