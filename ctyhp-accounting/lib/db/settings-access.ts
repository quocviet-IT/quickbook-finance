import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  canShowNavItem,
  settingsGateFor,
  type NavigationAccess,
} from "@/lib/domain/navigation";
import type { AppRole } from "@/lib/db/types";

/**
 * What the signed-in person may do, resolved once per request.
 *
 * The shell and the page inside it both need this, and two copies of "what may
 * this person do" would be the drift the catalog gate exists to prevent.
 * React's cache() collapses them into one pair of queries per request.
 */
export const currentAccess = cache(async (): Promise<NavigationAccess> => {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { role: null, permissionKeys: [] };

  const [profile, allowed] = await Promise.all([
    sb.from("acc_app_user").select("role").eq("id", user.id).maybeSingle(),
    sb.from("acc_role_permission").select("role,permission_key").eq("allowed", true),
  ]);
  const role = (profile.data?.role as AppRole | undefined) ?? null;
  // null means the lookup itself failed. Navigation treats that as "show it", so
  // a database hiccup cannot lock an administrator out of their own settings;
  // requireSettingsAccess below deliberately treats it as "deny".
  const permissionKeys = allowed.error
    ? null
    : (allowed.data ?? []).filter((row) => row.role === role).map((row) => row.permission_key);
  return { role, permissionKeys };
});

/**
 * Refuse anyone who may not use this screen.
 *
 * Fails closed, unlike the hub: no role, or a permission lookup that failed,
 * both redirect. A guard that opens when it is confused is not a guard.
 */
export async function requireSettingsAccess(href: string): Promise<void> {
  const item = settingsGateFor(href);
  const access = await currentAccess();
  const strict: NavigationAccess = {
    role: access.role,
    permissionKeys: access.permissionKeys ?? [],
  };
  if (!access.role || !canShowNavItem(item, strict)) {
    redirect(`/settings?denied=${encodeURIComponent(href)}`);
  }
}
