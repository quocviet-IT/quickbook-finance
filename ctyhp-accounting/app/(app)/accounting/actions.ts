"use server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserRole } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { ACCOUNTING_NOUNS } from "@/lib/domain/accounting-dashboard/lifecycle";
import { closePeriod, PeriodsError, reopenPeriod } from "@/lib/services/periods";
import { getAccountingContext } from "@/lib/services/accounting-dashboard/context";
import { getAccountingControls } from "@/lib/services/accounting-dashboard/controls";
import {
  changeWorkItem,
  type WorkItemActionResult,
  type WorkItemChange,
} from "@/lib/services/work-surface/change-work-item";

export type { WorkItemActionResult, WorkItemChange };

/**
 * Which accounting work items are blocking, derived from the books.
 *
 * Called only when something is being dismissed, and never trusted from the
 * browser: `acc_set_work_item_state` refuses to dismiss a blocking item, and
 * until Phase 6 the flag it checked was a parameter the caller supplied. Nothing
 * could be posted through that — dismissing changes no figure, and
 * `acc_close_period` re-derives its own gate — but the refusal exists to stop a
 * blocking exception being swept out of sight, and one the sweeper supplies does
 * not stop that.
 *
 * Only the controls are re-evaluated, not the whole page: they are the only
 * source of a blocking item here (`queue-items.ts` sets `blocksClose` from a
 * control's status and every other builder sets false).
 */
async function accountingBlockingKeys(sb: SupabaseClient): Promise<ReadonlySet<string>> {
  const context = await getAccountingContext(sb);
  const controls = await getAccountingControls(sb, context);
  return new Set(
    controls.filter((control) => control.blocksClose).map((control) => `control:${control.key}`),
  );
}

/**
 * One action for every change a person makes to a piece of accounting work.
 *
 * The body is `changeWorkItem` in `lib/services/work-surface/change-work-item.ts`
 * — Banking's queue and this one write the same table, and two implementations
 * would be two answers to "may this be dismissed". What this file supplies is
 * accounting's: how to work out what is blocking, and what to call it.
 */
export async function changeWorkItemAction(
  change: WorkItemChange,
): Promise<WorkItemActionResult> {
  const result = await changeWorkItem(change, {
    blockingKeys: accountingBlockingKeys,
    nouns: ACCOUNTING_NOUNS,
  });
  if (result.ok) revalidatePath("/accounting");
  return result;
}

function msg(error: unknown): string {
  if (error instanceof PeriodsError || error instanceof Error) return error.message;
  return "An unexpected error occurred";
}

export interface PeriodActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Close a period from the cockpit.
 *
 * Every rule about whether it may be closed stays in `acc_close_period`: admin
 * only, a reason required, and a refusal when a control account does not tie
 * out at the period end unless the difference is explained in writing. None of
 * that is repeated here, and the role check below is a courtesy that produces a
 * readable message — not the guard. The guard is the database, because this
 * screen will not be its only caller forever.
 */
export async function closePeriodAction(input: {
  periodId: string;
  reason: string;
  varianceNote: string | null;
}): Promise<PeriodActionResult> {
  const role = await getUserRole();
  if (role !== "admin") {
    return { ok: false, error: "Only an admin can close a period" };
  }
  if (input.reason.trim().length === 0) {
    return { ok: false, error: "A close reason is required" };
  }
  try {
    const sb = await createSupabaseServerClient();
    await closePeriod(sb, input.periodId, input.reason.trim(), input.varianceNote);
    revalidatePath("/accounting");
    revalidatePath("/settings/periods");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function reopenPeriodAction(input: {
  periodId: string;
  reason: string;
}): Promise<PeriodActionResult> {
  const role = await getUserRole();
  if (role !== "admin") {
    return { ok: false, error: "Only an admin can reopen a period" };
  }
  if (input.reason.trim().length === 0) {
    return { ok: false, error: "A reason is required" };
  }
  try {
    const sb = await createSupabaseServerClient();
    await reopenPeriod(sb, input.periodId, input.reason.trim());
    revalidatePath("/accounting");
    revalidatePath("/settings/periods");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}
