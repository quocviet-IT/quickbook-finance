"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { holdsPermission } from "@/lib/auth";
import { approvalPolicySchema, rolePermissionSchema } from "@/lib/domain/schemas";
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

export async function setRolePermissionAction(raw: unknown): Promise<ActionResult> {
  const denied = await guard("permissions.manage");
  if (denied) return { ok: false, error: denied };
  const parsed = rolePermissionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await setRolePermission(sb, parsed.data);
    revalidatePath("/settings/permissions");
    return { ok: true };
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
