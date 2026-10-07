import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { currentUser } from "./db/company";
import { currentAccess } from "./db/settings-access";
import type { AppRole } from "./db/types";

/** Current authenticated user, or null. The request's one answer, shared. */
export async function getSessionUser(): Promise<User | null> {
  return currentUser();
}

/**
 * Current user's application role, or null if unauthenticated, unregistered, or
 * no longer active.
 *
 * Read from `currentAccess()` rather than queried again. It used to be a second
 * resolver with its own three round trips (client, user, role) on each of 87
 * call sites; `currentAccess` already reads the same row once per request, with
 * the status filter that keeps it in step with `acc_current_role()` (migration
 * 0037) — so a suspended user has no role here either, everywhere at once.
 */
export async function getUserRole(): Promise<AppRole | null> {
  return (await currentAccess()).role;
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
