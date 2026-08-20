import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. It bypasses RLS, so it exists for exactly one job:
 * creating users through the Auth admin API, which no anon-key client can do.
 * Never import this from a client component, and never use it to read or write
 * accounting data — those paths must stay under RLS and the role guards.
 */
/**
 * Whether the service-role key is actually configured. A fresh checkout ships a
 * placeholder, so "present" is not the same as "usable" — the UI asks this
 * before offering to create anyone, rather than letting the Auth API fail with
 * a bare "Invalid API key".
 */
export function isAdminClientConfigured(): boolean {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && key.length > 20 && !/^REPLACE/i.test(key);
}

export function createSupabaseAdminClient(schema: string = "public"): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!isAdminClientConfigured()) {
    throw new Error(
      "Creating users needs a real SUPABASE_SERVICE_ROLE_KEY in the environment; " +
        "it is currently missing or still the placeholder value",
    );
  }
  return createClient(url as string, serviceKey as string, {
    // The register lives in the onebook schema and only the service role may
    // write it — granting a new user their membership row is the one job that
    // needs this parameter (see createUser in lib/services/access.ts).
    db: { schema },
    auth: { persistSession: false, autoRefreshToken: false },
    // Widened the same way lib/db/server.ts widens: the schema is a runtime
    // parameter here, so the client type cannot carry it.
  }) as unknown as SupabaseClient;
}
