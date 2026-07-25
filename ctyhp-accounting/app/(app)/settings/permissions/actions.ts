"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin } from "@/lib/auth";
import { approvalPolicySchema, rolePermissionSchema } from "@/lib/domain/schemas";
import { AccessError, setApprovalPolicy, setRolePermission } from "@/lib/services/access";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return isAdmin(role) ? null : "Only an admin can change access settings";
}
function msg(e: unknown): string {
  return e instanceof AccessError || e instanceof Error ? e.message : "An unexpected error occurred";
}

export async function setRolePermissionAction(raw: unknown): Promise<ActionResult> {
  const denied = await guard();
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
  const denied = await guard();
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
