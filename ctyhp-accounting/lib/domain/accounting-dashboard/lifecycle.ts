import {
  matchesFilter as matchesSurfaceFilter,
  surfaceFilters,
  transitionProblem as surfaceTransitionProblem,
  type KindFilter,
  type WorkLifecycle,
} from "@/lib/domain/work-surface/lifecycle";
import { asWorkItem, type PriorityQueueItem } from "./types";

/**
 * What a piece of accounting work may become, and who is looking at it.
 *
 * The rules themselves moved to `lib/domain/work-surface/lifecycle.ts` in
 * Phase 6 — they are about work, not about ledgers, and Banking needs the same
 * ones. What stays here is the part that is accounting's: that the outcome being
 * blocked is a **period close**, and that this surface's own filters are
 * reconciliation, approvals and period close.
 *
 * Design record: docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md §7.2
 */

export type { WorkLifecycle, WorkItemState } from "@/lib/domain/work-surface/lifecycle";

/**
 * What this surface calls things. Banking's blocking outcome is a
 * reconciliation, and what decides its work is the feed, not the books.
 */
export const ACCOUNTING_NOUNS = { blocking: "the period close", records: "the books" };

/**
 * The filters this surface adds to the universal ones.
 *
 * Each names the `sourceKind` values it covers, and the shared layer only checks
 * membership — it never learns that "unmatched-bank" has anything to do with a
 * bank.
 */
export const ACCOUNTING_KIND_FILTERS: readonly KindFilter[] = [
  { id: "reconciliation", label: "Reconciliation", kinds: ["unmatched-bank"] },
  { id: "approvals", label: "Approvals", kinds: ["pending-approval"] },
  { id: "period_close", label: "Period close", kinds: ["overdue-period"] },
];

export const QUEUE_FILTERS = surfaceFilters(ACCOUNTING_KIND_FILTERS);

export type QueueFilter = string;

/** Null when the move is legal; the reason it is not, otherwise. */
export function transitionProblem(
  from: WorkLifecycle,
  to: WorkLifecycle,
  item: { blocksClose: boolean },
  reason: string | null,
): string | null {
  return surfaceTransitionProblem(from, to, { blocking: item.blocksClose }, reason, ACCOUNTING_NOUNS);
}

/** Whether one item belongs under one filter. */
export function matchesFilter(
  item: PriorityQueueItem,
  filter: QueueFilter,
  viewerId: string | null,
  today: string,
): boolean {
  return matchesSurfaceFilter(asWorkItem(item), filter, {
    viewerId,
    today,
    kindFilters: ACCOUNTING_KIND_FILTERS,
  });
}
