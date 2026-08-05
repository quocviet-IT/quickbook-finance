import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AutomationCompany } from "@/lib/domain/company-automation";

/**
 * RLS-bypassing client reserved for authenticated background automation.
 * Import it only from a route that independently verifies a server-held secret.
 * Interactive accounting requests must continue to use the session client.
 *
 * The schema is explicit because automation now serves several companies. It is
 * never derived from a request: a cron job names the schema the register handed
 * it, and a client bound to one company cannot reach another's tables at all.
 */
export function createSupabaseAutomationClient(schema = "public"): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || key.length < 20 || /^REPLACE/i.test(key)) {
    throw new Error("Background automation requires SUPABASE_SERVICE_ROLE_KEY");
  }
  // `createClient` types the schema into the client. Every service takes the
  // schema-agnostic client, so the generic is widened once, here, exactly as
  // `createSupabaseServerClientForSchema` does for interactive requests.
  return createClient(url, key, {
    db: { schema },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SupabaseClient;
}

/**
 * Every company automation should work through, in the register's own order.
 *
 * Archived companies are left alone — their books are closed, and pulling a
 * bank feed into them would revive activity nobody asked for. A failure here is
 * deliberately not swallowed: without a trustworthy register the only honest
 * outcome is a failed job, never a run that quietly covered one company.
 */
export async function listActiveAutomationCompanies(): Promise<AutomationCompany[]> {
  const register = createSupabaseAutomationClient("onebook");
  const { data, error } = await register
    .from("company")
    .select("id,slug,schema_name,legal_name")
    .eq("status", "active")
    .order("display_order")
    .order("legal_name");
  if (error) throw new Error(`Company register unavailable: ${error.message}`);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    schemaName: row.schema_name as string,
    legalName: row.legal_name as string,
  }));
}
