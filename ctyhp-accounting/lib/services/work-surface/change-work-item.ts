import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserRole } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite } from "@/lib/domain/roles";
import {
  transitionProblem,
  type SurfaceNouns,
  type WorkLifecycle,
} from "@/lib/domain/work-surface/lifecycle";
import { setWorkItemState, WorkItemStateError } from "./work-item-state";

/**
 * One change to one piece of work, on any surface.
 *
 * Deliberately one function rather than five. Acknowledge, start, assign, date
 * and dismiss all write the same row, and five entry points would be five places
 * for the guard and the concurrency token to drift apart. Deliberately one
 * function across surfaces too: Banking's queue and Accounting's are the same
 * table, and two implementations would be two answers to "may this be
 * dismissed".
 *
 * ## Blocking is worked out here, never accepted from the caller
 *
 * The database refuses to dismiss a blocking item — and until now the flag it
 * checked came from the browser, so a crafted request could answer its own
 * guard. Nothing could be posted through that: dismissing changes no figure, and
 * `acc_close_period` re-derives its own gate and has never read this flag. But
 * the refusal exists to stop a blocking exception being swept out of sight, and
 * one the sweeper supplies does not stop that.
 *
 * So the surface hands in a resolver and this function calls it — only on
 * dismissal, which is the one transition the flag governs, so the common actions
 * cost nothing extra. A resolver that throws leaves the item treated as
 * blocking: a failed read must not become permission.
 *
 * Plan: docs/superpowers/plans/2026-08-22-accounting-cockpit-phase6.md
 */

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
}

export interface SurfaceChangeOptions {
  /**
   * Which of this surface's live items are blocking, derived from the records.
   * Called only when something is being dismissed.
   */
  blockingKeys: (sb: SupabaseClient) => Promise<ReadonlySet<string>>;
  /** What this surface calls the outcome being blocked, and its records. */
  nouns: SurfaceNouns;
}

export async function changeWorkItem(
  change: WorkItemChange,
  options: SurfaceChangeOptions,
): Promise<WorkItemActionResult> {
  const role = await getUserRole();
  if (!canWrite(role)) {
    return { ok: false, error: "You do not have permission to change work" };
  }

  try {
    const sb = await createSupabaseServerClient();

    // Worked out from the records, on the server, for the one transition where
    // it decides anything. The value the screen holds is never consulted.
    const blocking =
      change.to === "dismissed" ? (await blockingFor(sb, options, change.key)) : false;

    const problem = transitionProblem(
      change.from,
      change.to,
      { blocking },
      change.reason,
      options.nouns,
    );
    if (problem) return { ok: false, error: problem };

    const version = await setWorkItemState(sb, {
      key: change.key,
      lifecycle: change.to,
      ownerId: change.ownerId,
      dueDate: change.dueDate,
      reason: change.reason,
      expectedVersion: change.expectedVersion,
      blocking,
    });
    return { ok: true, version };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

/** Fails closed: a resolver that cannot answer means "treat it as blocking". */
async function blockingFor(
  sb: SupabaseClient,
  options: SurfaceChangeOptions,
  key: string,
): Promise<boolean> {
  try {
    return (await options.blockingKeys(sb)).has(key);
  } catch (error) {
    console.error("could not work out whether this item is blocking:", error);
    return true;
  }
}

function message(error: unknown): string {
  if (error instanceof WorkItemStateError || error instanceof Error) return error.message;
  return "An unexpected error occurred";
}
