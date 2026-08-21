import type { PriorityQueueItem } from "./types";

/**
 * What a piece of work may become, and who is looking at it.
 *
 * The queue is derived from the books on every read — Phase 1's decision, and
 * still true. What this file governs is the layer of human judgement over the
 * top: who picked something up, who put it down, and who decided it does not
 * need doing. None of that touches an accounting figure, and none of it can
 * declare an exception fixed. Only the books do that.
 *
 * Design record: docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md §7.2
 */

export type WorkLifecycle = "new" | "acknowledged" | "in_progress" | "dismissed" | "resolved";

/** The user-created state of one work item. Nothing accounting-shaped lives here. */
export interface WorkItemState {
  key: string;
  lifecycle: WorkLifecycle;
  ownerId: string | null;
  ownerName: string | null;
  /** Entered by a person. Phase 3 adds a policy that can propose one. */
  dueDate: string | null;
  dismissReason: string | null;
  /**
   * The concurrency token: an update carrying a stale one is refused.
   *
   * A counter rather than a timestamp — a timestamp loses precision on its way
   * through a driver and a JSON serialiser, and would refuse writes that were
   * never actually stale.
   */
  version: number;
  updatedBy: string | null;
}

/**
 * Null when the move is legal; the reason it is not, otherwise.
 *
 * Deliberately permissive in both directions between `new`, `acknowledged` and
 * `in_progress`: a queue that only moves forwards is one people avoid touching,
 * and picking something up then putting it down is ordinary. The three refusals
 * are the ones that mean something.
 */
export function transitionProblem(
  from: WorkLifecycle,
  to: WorkLifecycle,
  item: { blocksClose: boolean },
  reason: string | null,
): string | null {
  if (to === "resolved") {
    return "Work is resolved by the books, not by hand — an item goes when its exception does.";
  }
  if (from === "resolved") {
    return "This item is already resolved; its exception has cleared.";
  }
  if (to === "dismissed") {
    if (item.blocksClose) {
      return "This blocks the period close and cannot be dismissed. Fix it or reopen the period.";
    }
    if ((reason ?? "").trim().length === 0) {
      return "Say why this is being dismissed.";
    }
  }
  return null;
}

export type QueueFilter =
  | "all"
  | "mine"
  | "unassigned"
  | "overdue"
  | "critical"
  | "reconciliation"
  | "approvals"
  | "period_close"
  | "dismissed";

/**
 * Whether one item belongs under one filter.
 *
 * A dismissed item is hidden from every filter but its own. Hidden from the
 * work, never hidden from the reader: somebody decided it did not need doing,
 * and that decision has to remain inspectable.
 */
export function matchesFilter(
  item: PriorityQueueItem,
  filter: QueueFilter,
  viewerId: string | null,
  today: string,
): boolean {
  const dismissed = item.lifecycle === "dismissed";
  if (filter === "dismissed") return dismissed;
  if (dismissed) return false;

  switch (filter) {
    case "mine":
      // No viewer means no "mine". Matching everything would quietly show one
      // person another person's work.
      return viewerId !== null && item.ownerId === viewerId;
    case "unassigned":
      return item.ownerId === null;
    case "overdue":
      // Due today is due, not late — the same rule the invoice screens settle
      // on. And no due date is not overdue: nobody promised a day.
      return item.dueDate !== null && item.dueDate < today;
    case "critical":
      return item.severity === "critical";
    case "reconciliation":
      return item.sourceKind === "unmatched-bank";
    case "approvals":
      return item.sourceKind === "pending-approval";
    case "period_close":
      return item.sourceKind === "overdue-period";
    default:
      return true;
  }
}
