"use server";
import { revalidatePath } from "next/cache";
import { getUserRole, isAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { WorkPolicy } from "@/lib/domain/accounting-dashboard/policy";
import { saveWorkPolicy, WorkPolicyError } from "@/lib/services/accounting-dashboard/policy";

export interface WorkPolicyActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Record a new version of the company's work policy.
 *
 * Admin only, and the RPC checks again. Materiality and an SLA decide what
 * every accountant in the company is told is urgent and what is late — a
 * decision about the business, not about one person's queue.
 */
export async function saveWorkPolicyAction(
  input: WorkPolicy & { note: string | null },
): Promise<WorkPolicyActionResult> {
  const role = await getUserRole();
  if (!isAdmin(role)) {
    return { ok: false, error: "Only an admin can change the work policy" };
  }

  // Null is the answer "nobody has decided", and it has to survive the round
  // trip. Coercing it to zero here would turn "unset" into the strictest
  // policy the system allows, silently.
  const clean = (value: number | null): number | null =>
    value === null || value === undefined || !Number.isFinite(value) || value < 0 ? null : value;

  try {
    const sb = await createSupabaseServerClient();
    await saveWorkPolicy(sb, {
      materialityMinor: clean(input.materialityMinor),
      approvalSlaDays: clean(input.approvalSlaDays),
      unmatchedBankAgeDays: clean(input.unmatchedBankAgeDays),
      note: input.note?.trim() ? input.note.trim() : null,
    });
    revalidatePath("/accounting");
    revalidatePath("/settings/work-policy");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof WorkPolicyError || error instanceof Error
          ? error.message
          : "An unexpected error occurred",
    };
  }
}
