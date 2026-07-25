"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin } from "@/lib/auth";
import { buildPasswordSetupUrl } from "@/lib/auth-url";
import { userInviteSchema, userRoleSchema, userStatusSchema } from "@/lib/domain/schemas";
import { AccessError, inviteUser, setUserRole, setUserStatus } from "@/lib/services/access";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

/**
 * The role check here is the outer gate; the RPCs re-check `users.manage`, so an
 * admin who removed that permission from their own role is still stopped.
 */
async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return isAdmin(role) ? null : "Only an admin can manage users";
}
function msg(e: unknown): string {
  return e instanceof AccessError || e instanceof Error ? e.message : "An unexpected error occurred";
}

export async function inviteUserAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = userInviteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const requestHeaders = await headers();
    const origin = requestHeaders.get("origin");
    if (!origin) {
      throw new AccessError("The application origin is unavailable; the password email was not sent");
    }
    const sb = await createSupabaseServerClient();
    const id = await inviteUser(sb, parsed.data, buildPasswordSetupUrl(origin));
    revalidatePath("/settings/users");
    return { ok: true, data: { id } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setUserRoleAction(userId: string, raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = userRoleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await setUserRole(sb, userId, parsed.data);
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setUserStatusAction(userId: string, raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = userStatusSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await setUserStatus(sb, userId, parsed.data);
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
