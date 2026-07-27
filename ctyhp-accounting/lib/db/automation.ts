import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * RLS-bypassing client reserved for authenticated background automation.
 * Import it only from a route that independently verifies a server-held secret.
 * Interactive accounting requests must continue to use the session client.
 */
export function createSupabaseAutomationClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || key.length < 20 || /^REPLACE/i.test(key)) {
    throw new Error("Background automation requires SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
