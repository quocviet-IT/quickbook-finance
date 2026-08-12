import { httpStatusFor } from "@/lib/domain/health";
import { cachedHealth } from "@/lib/services/health";

// Never prerendered: an answer baked at build time would report the state of
// the build machine, which is nobody's question.
export const dynamic = "force-dynamic";

/**
 * Is the application usable?
 *
 * Public, because a health check behind a session is unreachable in the one
 * situation it exists for. It answers with the component names and a verdict —
 * no error text, no host names, no versions, no timings.
 */
export async function GET() {
  const payload = await cachedHealth();
  return Response.json(payload, { status: httpStatusFor(payload.status) });
}
