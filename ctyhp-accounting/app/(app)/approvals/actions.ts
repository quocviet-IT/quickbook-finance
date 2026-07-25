"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { approvalDecisionSchema, approvalSubmitSchema } from "@/lib/domain/schemas";
import {
  AccessError,
  approveRequest,
  cancelRequest,
  rejectRequest,
  submitForApproval,
} from "@/lib/services/access";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

function msg(e: unknown): string {
  return e instanceof AccessError || e instanceof Error ? e.message : "An unexpected error occurred";
}
function revalidate(): void {
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
}

export async function submitForApprovalAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to submit requests" };
  const parsed = approvalSubmitSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await submitForApproval(sb, parsed.data);
    revalidate();
    return { ok: true, data: { id } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * Approving performs the requested action. Permission and segregation of duties
 * are enforced by the RPC, so this action deliberately does not second-guess it.
 */
export async function approveRequestAction(id: string, raw: unknown): Promise<ActionResult<{ result_id: string | null }>> {
  const parsed = approvalDecisionSchema.partial({ note: true }).safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const resultId = await approveRequest(sb, id, parsed.data.note ?? "");
    revalidate();
    return { ok: true, data: { result_id: resultId } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function rejectRequestAction(id: string, raw: unknown): Promise<ActionResult> {
  const parsed = approvalDecisionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await rejectRequest(sb, id, parsed.data.note);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function cancelRequestAction(id: string): Promise<ActionResult> {
  try {
    const sb = await createSupabaseServerClient();
    await cancelRequest(sb, id);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
