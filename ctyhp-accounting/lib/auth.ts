import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./db/server";
import type { AppRole } from "./db/types";

/** Current authenticated user, or null. */
export async function getSessionUser(): Promise<User | null> {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user;
}

/**
 * Current user's application role, or null if unauthenticated, unregistered, or
 * no longer active.
 *
 * The status filter is not optional. `acc_current_role()` (migration 0037) is
 * what every RLS policy and RPC derives from, and it answers only for 'invited'
 * or 'active'; `acc_is_admin()` and `acc_is_staff()` are built on it. Reading the
 * role without the filter made this function disagree with the database about a
 * suspended user: the server action would admit them and the database would then
 * refuse the write, which surfaces as an inexplicable error on a screen they
 * should never have been shown. Suspension is meant to take effect everywhere at
 * once, and this is one of the two places that has to mean it — the other is
 * `currentAccess()` in lib/db/settings-access.ts.
 */
export async function getUserRole(): Promise<AppRole | null> {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb
    .from("acc_app_user")
    .select("role")
    .eq("id", user.id)
    .in("status", ["invited", "active"])
    .maybeSingle();
  return (data?.role as AppRole | undefined) ?? null;
}

/** Redirect to /login unless authenticated; returns the user otherwise. */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

// The predicates themselves are pure and live in `lib/domain/roles.ts` so unit
// tests can reach them; this module is server-only. Re-exported here because 44
// call sites already import them from `@/lib/auth`.
export { canWrite, isAdmin } from "./domain/roles";
