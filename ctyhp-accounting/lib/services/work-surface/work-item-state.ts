import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkItemState, WorkLifecycle } from "@/lib/domain/work-surface/lifecycle";

export class WorkItemStateError extends Error {}

const COLUMNS = "work_key,lifecycle,owner_id,due_date,dismiss_reason,version,updated_by";

/**
 * What people have decided about the work, keyed by the item's own key.
 *
 * One table for every surface, and correctly so: a work key is unique across the
 * product, and an "owner" means the same thing whichever screen the item was
 * derived on. Splitting it per area would have meant four tables answering one
 * question.
 *
 * Owner names are resolved through `acc_actor_directory` rather than joined: the
 * table references `auth.users`, which an application session cannot read, and a
 * uuid on screen tells nobody who is holding the work.
 */
export async function listWorkItemState(
  sb: SupabaseClient,
): Promise<Map<string, WorkItemState>> {
  const [rows, actors] = await Promise.all([
    sb.from("acc_work_item_state").select(COLUMNS).neq("lifecycle", "resolved"),
    sb.rpc("acc_actor_directory"),
  ]);
  if (rows.error) throw new WorkItemStateError(rows.error.message);

  const names = new Map<string, string>();
  if (!actors.error) {
    for (const actor of (actors.data ?? []) as Record<string, unknown>[]) {
      const name = String(actor.full_name ?? "").trim() || String(actor.email ?? "").trim();
      if (name) names.set(String(actor.id), name);
    }
  }

  const state = new Map<string, WorkItemState>();
  for (const row of (rows.data ?? []) as Record<string, unknown>[]) {
    const ownerId = row.owner_id ? String(row.owner_id) : null;
    state.set(String(row.work_key), {
      key: String(row.work_key),
      lifecycle: String(row.lifecycle) as WorkLifecycle,
      ownerId,
      ownerName: ownerId ? (names.get(ownerId) ?? null) : null,
      dueDate: row.due_date ? String(row.due_date) : null,
      dismissReason: row.dismiss_reason ? String(row.dismiss_reason) : null,
      version: Number(row.version),
      updatedBy: row.updated_by ? String(row.updated_by) : null,
    });
  }
  return state;
}

export interface SetWorkItemStateInput {
  key: string;
  lifecycle: WorkLifecycle;
  ownerId: string | null;
  dueDate: string | null;
  reason: string | null;
  /** What the caller last saw. Null means "I believe there is no row yet". */
  expectedVersion: number | null;
  /**
   * Whether this item blocks its surface's outcome.
   *
   * **The caller must have worked this out server-side.** The value travels to a
   * database check that refuses to dismiss a blocking item, and a value taken
   * from the browser would let a crafted request answer its own guard. See
   * `resolveBlocking` in `blocking.ts`.
   */
  blocking: boolean;
}

/** Returns the new concurrency token, so the caller can change it again. */
export async function setWorkItemState(
  sb: SupabaseClient,
  input: SetWorkItemStateInput,
): Promise<number> {
  const { data, error } = await sb.rpc("acc_set_work_item_state", {
    p_key: input.key,
    p_lifecycle: input.lifecycle,
    p_owner_id: input.ownerId,
    p_due_date: input.dueDate,
    p_reason: input.reason,
    p_expected_version: input.expectedVersion,
    p_blocks_close: input.blocking,
  });
  if (error) throw new WorkItemStateError(error.message);
  return Number(data);
}

/**
 * Mark as resolved the state of work that has gone.
 *
 * Called with the keys a queue just produced, at the one moment the live set is
 * actually known. A failure here costs the tidy-up, never the queue — so it is
 * reported and swallowed rather than thrown.
 */
export async function retireWorkItems(
  sb: SupabaseClient,
  liveKeys: readonly string[],
): Promise<number> {
  const { data, error } = await sb.rpc("acc_retire_work_items", {
    p_live_keys: [...liveKeys],
  });
  if (error) {
    console.error("retiring finished work items failed:", error.message);
    return 0;
  }
  return Number(data ?? 0);
}
