import { publicErrorBody, type PostgrestErrorBody } from "./postgrest-errors";

/** A request to PostgREST: tables, views and functions under /rest/v1/. */
function isRest(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(url).pathname.includes("/rest/v1/");
  } catch {
    return false;
  }
}

/** The same status and headers around a new body; the old length and encoding no longer describe it. */
function withBody(response: Response, body: string): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * `fetch` for the Supabase clients that act as a signed-in person. A refused
 * PostgREST request whose message Postgres wrote about itself comes back with
 * the screen's sentence instead (see ./postgrest-errors.ts); the original goes
 * to the server log, where it is still needed to find the cause. Everything
 * else — successes, Auth, Storage, our own messages — passes through as it is.
 */
// The default looks `fetch` up per call, so it is whatever the runtime has
// installed by then rather than the one present when this module loaded.
export function sanitizingFetch(base: typeof fetch = (input, init) => fetch(input, init)): typeof fetch {
  return async (input, init) => {
    const response = await base(input, init);
    if (response.ok || !isRest(input)) return response;
    if (!(response.headers.get("content-type") ?? "").includes("json")) return response;

    const text = await response.text();
    let body: PostgrestErrorBody;
    try {
      body = JSON.parse(text) as PostgrestErrorBody;
    } catch {
      return withBody(response, text);
    }
    const safe = body && typeof body === "object" ? publicErrorBody(body) : null;
    if (!safe) return withBody(response, text);

    // Code and message only: `details` can hold the refused row's values.
    console.error(`[postgrest ${response.status}] ${body.code ?? "no code"}: ${body.message ?? ""}`);
    return withBody(response, JSON.stringify(safe));
  };
}
