"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole, holdsPermission, isAdmin } from "@/lib/auth";
import { closePeriodSchema, reopenPeriodSchema } from "@/lib/domain/schemas";
import {
  generatePeriods,
  closePeriod,
  reopenPeriod,
  listPeriods,
  periodCloseBlockers,
  PeriodsError,
} from "@/lib/services/periods";
import {
  executeOrSubmitForApproval,
  toControlledActionResponse,
  type ControlledActionResponse,
} from "@/lib/services/approval-flow";
import type { AccountingPeriodRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
/**
 * Each control on this screen asks for what its database function checks
 * (2.59): setting up the calendar is a company setting, closing needs
 * `period.close`, and reopening stays with an admin holding `period.reopen`.
 */
async function refusal(rule: "set_up" | "close" | "reopen"): Promise<string | null> {
  const role = await getUserRole();
  if (rule === "set_up") {
    return (await holdsPermission("settings.manage")) ? null : "You do not have permission to set up accounting periods";
  }
  if (rule === "close") {
    return canWrite(role) && (await holdsPermission("period.close"))
      ? null
      : "You do not have permission to close a period";
  }
  if (!isAdmin(role)) return "Only an admin can reopen a period";
  return (await holdsPermission("period.reopen")) ? null : "You do not have permission to reopen a period";
}
function msg(e: unknown): string { return e instanceof PeriodsError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function generatePeriodsAction(fiscalYear: number): Promise<ActionResult<{ created: number }>> {
  const denied = await refusal("set_up"); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); const created = await generatePeriods(sb, fiscalYear); revalidatePath("/settings/periods"); return { ok: true, data: { created } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function closePeriodAction(id: string, raw: unknown): Promise<ActionResult> {
  const denied = await refusal("close"); if (denied) return { ok: false, error: denied };
  const parsed = closePeriodSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); await closePeriod(sb, id, parsed.data.reason, parsed.data.variance_note ?? null); revalidatePath("/settings/periods"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
/** What would stop this period closing — asked before the button is pressed. */
export async function periodCloseBlockersAction(id: string): Promise<ActionResult<string | null>> {
  const denied = await refusal("close"); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await periodCloseBlockers(sb, id) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function reopenPeriodAction(
  id: string,
  raw: unknown,
): Promise<ActionResult<ControlledActionResponse>> {
  const denied = await refusal("reopen"); if (denied) return { ok: false, error: denied };
  const parsed = reopenPeriodSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const outcome = await executeOrSubmitForApproval({
      sb,
      actionKey: "period_reopen",
      title: "Accounting period reopen",
      amountMinor: 0,
      reason: parsed.data.reason,
      payload: { period_id: id },
      execute: async () => {
        await reopenPeriod(sb, id, parsed.data.reason);
        return id;
      },
    });
    revalidatePath("/settings/periods");
    revalidatePath("/approvals");
    revalidatePath("/dashboard");
    return { ok: true, data: toControlledActionResponse(outcome, String) };
  }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function listPeriodsAction(fiscalYear: number): Promise<ActionResult<AccountingPeriodRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listPeriods(sb, fiscalYear) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
