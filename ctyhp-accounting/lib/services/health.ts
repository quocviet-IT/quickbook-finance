import {
  buildPayload,
  checkConfiguration,
  type CheckResult,
  type HealthCheckName,
  type HealthPayload,
} from "@/lib/domain/health";

/**
 * Reaching the two Supabase surfaces this application cannot work without.
 *
 * `fetch` and the clock arrive as dependencies so the probes can be tested
 * without a network and without waiting for real time to pass. Nothing here
 * decides what "up" means — that is lib/domain/health.ts — and nothing here
 * shapes what is said about it.
 */
export interface HealthDeps {
  fetch: typeof globalThis.fetch;
  now: () => Date;
  url?: string;
  anonKey?: string;
}

/** A hung dependency must not hang the endpoint reporting on it. */
export const PROBE_TIMEOUT_MS = 5000;

/**
 * How long an answer is reused.
 *
 * This endpoint is public and makes two outbound calls per request, so it is a
 * small amplifier. A failure is cached exactly as a success is: caching only
 * the good answer would let a flood arriving during an outage bypass the cap
 * entirely, which is the worst moment to remove it. The cost is that recovery
 * can take this long to show, which no monitor polling at thirty seconds or
 * more will notice.
 */
export const CACHE_TTL_MS = 10_000;

async function probe(
  name: HealthCheckName,
  request: () => Promise<Response>,
): Promise<boolean> {
  try {
    const response = await request();
    return response.ok;
  } catch (error) {
    // The verdict is all a public caller may be told, so the reason goes to the
    // log instead of the response. It has to go somewhere: without this line an
    // outage leaves no trace anywhere in the system, and whoever is woken by the
    // alert has only "database: fail" to work from — no DNS failure, no timeout,
    // no malformed URL. Same shape as lib/services/banking.ts.
    console.warn(
      `Health probe "${name}" could not reach its dependency:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

async function probeDatabase(deps: HealthDeps): Promise<CheckResult> {
  const ok = await probe("database", async () => {
    const response = await deps.fetch(`${deps.url}/rest/v1/rpc/health`, {
      method: "POST",
      headers: {
        // PostgREST refuses the anon key on `apikey` alone, and the function
        // lives in onebook rather than public. Both were measured.
        apikey: deps.anonKey ?? "",
        authorization: `Bearer ${deps.anonKey ?? ""}`,
        "content-profile": "onebook",
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return response;
    // A 200 carrying anything other than the constant means something answered
    // that is not the function this migration created.
    const body = (await response.text()).trim().replace(/^"|"$/g, "");
    return body === "ok" ? response : new Response(null, { status: 502 });
  });
  return { name: "database", status: ok ? "ok" : "fail" };
}

async function probeAuthentication(deps: HealthDeps): Promise<CheckResult> {
  const ok = await probe("authentication", () =>
    deps.fetch(`${deps.url}/auth/v1/health`, {
      headers: { apikey: deps.anonKey ?? "" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    }),
  );
  // The body carries the GoTrue version. Only the status code is read; the
  // version is not forwarded to an unauthenticated caller.
  return { name: "authentication", status: ok ? "ok" : "fail" };
}

export async function probeHealth(deps: HealthDeps): Promise<HealthPayload> {
  const configuration = checkConfiguration({ url: deps.url, anonKey: deps.anonKey });
  // Run together: serialised probes double the worst case, and the worst case
  // is what a monitor's timeout is set against.
  const [database, authentication] = await Promise.all([
    probeDatabase(deps),
    probeAuthentication(deps),
  ]);
  return buildPayload(
    [database, authentication, configuration],
    deps.now().toISOString(),
  );
}

let cached: { at: number; payload: HealthPayload } | null = null;
let inFlight: Promise<HealthPayload> | null = null;

/**
 * The probes as the route calls them, with real dependencies and the cache.
 *
 * Stated plainly: on serverless each instance holds its own cache, so this
 * bounds abuse rather than acting as a shared cache.
 */
export async function cachedHealth(): Promise<HealthPayload> {
  const elapsed = cached ? Date.now() - cached.at : Number.POSITIVE_INFINITY;
  if (cached && elapsed < CACHE_TTL_MS) return cached.payload;

  // Share the run that is already happening rather than starting another.
  // Consulting the cache before the await and writing it after leaves a window
  // the width of a whole probe — so a burst arriving on a cold cache would each
  // fire their own pair, and the cap this exists for would not apply under the
  // one condition it was written for. During an outage each of those also holds
  // the instance for the full timeout.
  inFlight ??= probeHealth({
    fetch: globalThis.fetch,
    now: () => new Date(),
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })
    .then((payload) => {
      cached = { at: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
