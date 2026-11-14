"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { holdsPermission } from "@/lib/auth";
import { approvalPolicySchema, rolePermissionsSchema } from "@/lib/domain/schemas";
import { AccessError, setApprovalPolicy, setRolePermission } from "@/lib/services/access";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

/** The permission each screen's card opens for, which its RPC checks again (2.59). */
async function guard(key: "permissions.manage" | "settings.manage"): Promise<string | null> {
  if (await holdsPermission(key)) return null;
  return key === "permissions.manage"
    ? "You do not have permission to change the permission matrix"
    : "You do not have permission to change approval policies";
}
function msg(e: unknown): string {
  return e instanceof AccessError || e instanceof Error ? e.message : "An unexpected error occurred";
}

/** A change the database refused, and its reason. */
export interface PermissionChangeRefused {
  role: string;
  permission_key: string;
  error: string;
}

/**
 * The matrix's changes, saved when the reader presses Save (3.0.34) — one
 * request, not one per switch. Each change is its own row and goes through the
 * same checked function as before (acc_set_role_permission), in order; one the
 * database refuses is reported with its reason and the rest are kept, so the
 * screen can say "3 saved, 1 not" and leave the refused one to try again.
 */
export async function saveRolePermissionsAction(
  raw: unknown,
): Promise<ActionResult<{ saved: number; refused: PermissionChangeRefused[] }>> {
  const denied = await guard("permissions.manage");
  if (denied) return { ok: false, error: denied };
  const parsed = rolePermissionsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const refused: PermissionChangeRefused[] = [];
    let saved = 0;
    for (const change of parsed.data) {
      try {
        await setRolePermission(sb, change);
        saved++;
      } catch (e) {
        refused.push({ role: change.role, permission_key: change.permission_key, error: msg(e) });
      }
    }
    if (saved > 0) revalidatePath("/settings/permissions");
    return { ok: true, data: { saved, refused } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setApprovalPolicyAction(raw: unknown): Promise<ActionResult> {
  const denied = await guard("settings.manage");
  if (denied) return { ok: false, error: denied };
  const parsed = approvalPolicySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await setApprovalPolicy(sb, parsed.data);
    revalidatePath("/settings/approvals");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
