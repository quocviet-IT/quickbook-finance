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
    // `status` is not decoration. acc_current_role() (migration 0037) answers
    // this question for every RLS policy and RPC in the application, and it
    // answers it only for 'invited' or 'active'. Reading the role without that
    // filter would make this resolver disagree with the database about who a
    // suspended administrator is — and the product tells the person doing the
    // suspending that it "revokes access immediately across the whole
    // application".
    sb
      .from("acc_app_user")
      .select("role")
      .eq("id", user.id)
      .in("status", ["invited", "active"])
      .maybeSingle(),
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

/**
 * The same fail-closed refusal, for a settings route that cannot have a
 * catalog entry.
 *
 * `requireSettingsAccess` above guards a screen through its settings-hub card,
 * and `settingsGateFor` throws for an href with no card — deliberately. A
 * dynamic route (one page per record id) can never appear in that catalog:
 * there is no static href to match and no card to show. Its gate is declared
 * here instead, through the same single predicate the hub, the sidebar and
 * the catalog guard all share, with the same fail-closed reading of a broken
 * permission lookup.
 */
export async function requireSettingsPermission(
  anyPermissions: readonly string[],
  deniedHref: string,
): Promise<void> {
  const access = await currentAccess();
  const strict: NavigationAccess = {
    role: access.role,
    permissionKeys: access.permissionKeys ?? [],
  };
  if (!access.role || !canShowNavItem({ anyPermissions: [...anyPermissions] }, strict)) {
    redirect(`/settings?denied=${encodeURIComponent(deniedHref)}`);
  }
}
