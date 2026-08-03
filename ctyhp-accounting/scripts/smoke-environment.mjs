/**
 * Environment for the page smoke sweep, deliberately separate from
 * `e2e-environment.mjs`.
 *
 * That guard exists to stop suites that WRITE from ever pointing at real books,
 * and it enforces this by demanding a second Supabase project. `smoke-pages`
 * writes nothing — it signs in once and issues GET requests — so sharing the
 * guard meant the one check that catches render-time failures could never run
 * against the project people actually develop against. Six of the last seven
 * reported defects were on screens; none of them would have been caught by
 * typecheck, tests, lint or build.
 *
 * Signing in needs no new secret. With a service role key already present, a
 * one-time link is minted for an existing user and exchanged for a session,
 * which is what a password would have bought anyway. SMOKE_EMAIL and
 * SMOKE_PASSWORD still work when someone would rather be explicit.
 */
import { createClient } from "@supabase/supabase-js";

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required to run the page smoke sweep`);
  return value;
}

/**
 * A signed-in Supabase session for the smoke sweep.
 * @param {Record<string, string | undefined>} env
 */
export async function smokeSession(env = process.env) {
  const supabaseUrl = required(env, "NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = required(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

  const email = env.SMOKE_EMAIL?.trim() || env.E2E_EMAIL?.trim();
  const password = env.SMOKE_PASSWORD?.trim() || env.E2E_PASSWORD?.trim();

  if (email && password) {
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`smoke sign-in failed: ${error.message}`);
    return { supabaseUrl, anonKey, session: data.session, user: data.user };
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error(
      "Set SMOKE_EMAIL and SMOKE_PASSWORD, or SUPABASE_SERVICE_ROLE_KEY, to run the page smoke sweep",
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const target = email ?? (await firstActiveAdminEmail(admin));
  if (!target) throw new Error("No active administrator to sign in as; set SMOKE_EMAIL");

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: target,
  });
  if (linkError) throw new Error(`smoke sign-in link failed: ${linkError.message}`);

  const tokenHash = link?.properties?.hashed_token;
  if (!tokenHash) throw new Error("smoke sign-in link carried no token");

  const { data, error } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error) throw new Error(`smoke sign-in failed: ${error.message}`);
  return { supabaseUrl, anonKey, session: data.session, user: data.user };
}

/**
 * Whoever the register calls an active administrator. The sweep only reads, so
 * it wants the account that can see the most pages rather than a specific one.
 */
async function firstActiveAdminEmail(admin) {
  const { data, error } = await admin
    .from("acc_app_user")
    .select("id")
    .eq("role", "admin")
    .eq("status", "active")
    .order("created_at")
    .limit(1);
  if (error) throw new Error(`looking up an administrator failed: ${error.message}`);
  const id = data?.[0]?.id;
  if (!id) return null;
  const { data: user, error: userError } = await admin.auth.admin.getUserById(id);
  if (userError) throw new Error(`looking up an administrator failed: ${userError.message}`);
  return user?.user?.email ?? null;
}
