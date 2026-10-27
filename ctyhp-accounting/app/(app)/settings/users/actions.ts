"use server";
import { revalidatePath } from "next/cache";
import { resolveActiveCompany } from "@/lib/db/company";
import { createSupabaseServerClient } from "@/lib/db/server";
import { holdsPermission } from "@/lib/auth";
import {
  userAddExistingSchema,
  userCreateSchema,
  userRoleSchema,
  userStatusSchema,
  userTwoStepResetSchema,
} from "@/lib/domain/schemas";
import { AccessError, addExistingUser, createUser, resetTwoStep, setUserRole, setUserStatus } from "@/lib/services/access";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

/**
 * The outer gate, on the permission the Users card opens for; the RPCs check
 * `users.manage` again (2.59).
 */
async function guard(): Promise<string | null> {
  return (await holdsPermission("users.manage")) ? null : "You do not have permission to manage users";
}
function msg(e: unknown): string {
  return e instanceof AccessError || e instanceof Error ? e.message : "An unexpected error occurred";
}

export async function createUserAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = userCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const company = await resolveActiveCompany();
    if (!company.active) return { ok: false, error: "No company is selected" };
    const sb = await createSupabaseServerClient();
    // The company id names where the new user's register membership goes —
    // the same company this admin is signed into and creating them in.
    const id = await createUser(sb, company.active.id, parsed.data);
    revalidatePath("/settings/users");
    return { ok: true, data: { id } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** A person who already has a OneBook sign-in, added to this company by email (2.57). */
export async function addExistingUserAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = userAddExistingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const company = await resolveActiveCompany();
    if (!company.active) return { ok: false, error: "No company is selected" };
    const sb = await createSupabaseServerClient();
    const id = await addExistingUser(sb, company.active.id, parsed.data);
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

/** Remove someone's second sign-in step, for a lost or replaced phone (2.65). */
export async function resetTwoStepAction(userId: string, raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = userTwoStepResetSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await resetTwoStep(sb, userId, parsed.data.reason);
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
