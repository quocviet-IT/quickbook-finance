import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  requireDestructiveE2eEnvironment,
  requireDestructiveE2eServiceRoleEnvironment,
} from "../../../scripts/e2e-environment.mjs";

/** A run-unique marker written into every row the test creates. */
export function newMarker(): string {
  return `E2E-DOC-LEDGER-${Date.now()}`;
}

export async function openE2eSession(): Promise<{
  sb: SupabaseClient;
  userId: string;
  marker: string;
  today: string;
}> {
  const { supabaseUrl: url, anonKey, email, password } =
    requireDestructiveE2eEnvironment();

  const sb = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new Error(
      `Could not sign in as ${email}: ${error?.message ?? "no user returned"}`,
    );
  }

  const { data: allowed, error: permError } = await sb.rpc("acc_has_permission", {
    p_key: "invoice.issue",
  });
  if (permError || allowed !== true) {
    throw new Error(
      `${email} lacks invoice.issue; the end-to-end test needs an account that can issue invoices.`,
    );
  }

  return {
    sb,
    userId: data.user.id,
    marker: newMarker(),
    today: new Date().toISOString().slice(0, 10),
  };
}

export function createE2eServiceClient(): SupabaseClient {
  const { supabaseUrl, serviceRoleKey } =
    requireDestructiveE2eServiceRoleEnvironment();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function closeE2eSession(sb: SupabaseClient): Promise<void> {
  await sb.auth.signOut();
}
