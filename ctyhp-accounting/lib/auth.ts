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

/** Current user's application role, or null if unauthenticated / unregistered. */
export async function getUserRole(): Promise<AppRole | null> {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("acc_app_user").select("role").eq("id", user.id).maybeSingle();
  return (data?.role as AppRole | undefined) ?? null;
}

/** Redirect to /login unless authenticated; returns the user otherwise. */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export function canWrite(role: AppRole | null): boolean {
  return role === "admin" || role === "accountant";
}

/** Config that only admins may change (tax rates, currencies, COA approval). */
export function isAdmin(role: AppRole | null): boolean {
  return role === "admin";
}
