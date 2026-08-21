"use server";
import { revalidatePath } from "next/cache";
import { getUserRole } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { transitionProblem, type WorkLifecycle } from "@/lib/domain/accounting-dashboard/lifecycle";
import { canWrite } from "@/lib/domain/roles";
import { closePeriod, PeriodsError, reopenPeriod } from "@/lib/services/periods";
import {
  setWorkItemState,
  WorkItemStateError,
} from "@/lib/services/accounting-dashboard/work-item-state";

export interface WorkItemActionResult {
  ok: boolean;
  error?: string;
  /** The new concurrency token, so the screen can change the item again. */
  version?: number;
}

export interface WorkItemChange {
  key: string;
  from: WorkLifecycle;
  to: WorkLifecycle;
  ownerId: string | null;
  dueDate: string | null;
  reason: string | null;
  expectedVersion: number | null;
  blocksClose: boolean;
}

function msg(error: unknown): string {
  if (error instanceof WorkItemStateError || error instanceof PeriodsError) return error.message;
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred";
}

/**
 * One action for every change a person makes to a piece of work.
 *
 * Deliberately not five: acknowledge, start, assign, date and dismiss all
 * write the same row, and five entry points would be five places for the
 * guard and the concurrency token to drift apart.
 *
 * The transition is checked here *and* in the RPC. Not belt and braces — the
 * screen is not the only caller the database can ever have, and the rule
 * about what may be dismissed is a rule about the books rather than about
 * this page.
 */
export async function changeWorkItemAction(
  change: WorkItemChange,
): Promise<WorkItemActionResult> {
  const role = await getUserRole();
  if (!canWrite(role)) {
    return { ok: false, error: "You do not have permission to change work" };
  }

  const problem = transitionProblem(change.from, change.to, change, change.reason);
  if (problem) return { ok: false, error: problem };

  try {
    const sb = await createSupabaseServerClient();
    const version = await setWorkItemState(sb, {
      key: change.key,
      lifecycle: change.to,
      ownerId: change.ownerId,
      dueDate: change.dueDate,
      reason: change.reason,
      expectedVersion: change.expectedVersion,
      blocksClose: change.blocksClose,
    });
    revalidatePath("/accounting");
    return { ok: true, version };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
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
