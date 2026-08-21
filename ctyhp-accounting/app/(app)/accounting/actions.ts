"use server";
import { revalidatePath } from "next/cache";
import { getUserRole } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { transitionProblem, type WorkLifecycle } from "@/lib/domain/accounting-dashboard/lifecycle";
import { canWrite } from "@/lib/domain/roles";
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
  if (error instanceof WorkItemStateError || error instanceof Error) return error.message;
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
