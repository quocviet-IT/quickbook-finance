import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(
      `${name} is required for the HTTPS end-to-end test. Run it through ` +
        "npm run test:e2e:document-ledger-report so .env.local is loaded.",
    );
  }
  return value;
}

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
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  // Same fallback pair as scripts/smoke-pages.mjs, so the test runs out of the
  // box against the demo company and an override stays a one-line env change.
  const email = required("E2E_EMAIL", process.env.SMOKE_EMAIL ?? "admin@ctyhp.vn");
  const password = required(
    "E2E_PASSWORD",
    process.env.SMOKE_PASSWORD ?? "Ctyhp@Ketoan2026",
  );

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

export async function closeE2eSession(sb: SupabaseClient): Promise<void> {
  await sb.auth.signOut();
}
