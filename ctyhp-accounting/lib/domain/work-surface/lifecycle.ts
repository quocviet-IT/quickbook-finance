import type { SurfaceWorkItem } from "./types";

/**
 * What a piece of work may become, and who is looking at it.
 *
 * A queue is derived from the records on every read — that is true on every
 * surface. What this file governs is the layer of human judgement over the top:
 * who picked something up, who put it down, and who decided it does not need
 * doing. None of it can declare an exception fixed. Only the records do that.
 *
 * Design record: docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md §7.2
 */

export type WorkLifecycle = "new" | "acknowledged" | "in_progress" | "dismissed" | "resolved";

/** The user-created state of one work item. Nothing area-shaped lives here. */
export interface WorkItemState {
  key: string;
  lifecycle: WorkLifecycle;
  ownerId: string | null;
  ownerName: string | null;
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
 *
 * The two labels are what this surface calls things. `blocking` is the outcome
 * being blocked — a period close, a reconciliation. `records` is what an area
 * calls the thing that decides an item is finished — the books, the feed, the
 * stock. The rule is the same everywhere; only the nouns are local, and a shared
 * file that hard-coded one area's nouns would be telling Banking users about
 * periods and ledgers.
 */
export interface SurfaceNouns {
  /** What a blocked item is blocking here. */
  blocking?: string;
  /** What resolves work here — the thing a person cannot overrule by hand. */
  records?: string;
}

export function transitionProblem(
  from: WorkLifecycle,
  to: WorkLifecycle,
  item: { blocking: boolean },
  reason: string | null,
  nouns: SurfaceNouns = {},
): string | null {
  const blockingLabel = nouns.blocking ?? "this area's sign-off";
  const recordsLabel = nouns.records ?? "the records";
  if (to === "resolved") {
    return `Work is resolved by ${recordsLabel}, not by hand — an item goes when its exception does.`;
  }
  if (from === "resolved") {
    return "This item is already resolved; its exception has cleared.";
  }
  if (to === "dismissed") {
    if (item.blocking) {
      return `This blocks ${blockingLabel} and cannot be dismissed. Fix it, or change what is blocked.`;
    }
    if ((reason ?? "").trim().length === 0) {
      return "Say why this is being dismissed.";
    }
  }
  return null;
}

/**
 * The filters every surface has, because they are about work rather than about
 * what the work is.
 */
export type UniversalFilter =
  | "all"
  | "mine"
  | "unassigned"
  | "overdue"
  | "critical"
  | "dismissed";

/**
 * A filter an area adds for its own kinds of work — "Reconciliation",
 * "Approvals", "Three-way match".
 *
 * The area supplies the label and the `sourceKind` values it covers. The shared
 * layer never learns what those kinds mean; it only checks membership. That is
 * the difference between a primitive and one area's screen with a general name.
 */
export interface KindFilter {
  id: string;
  label: string;
  kinds: readonly string[];
}

export const UNIVERSAL_FILTERS: readonly { id: UniversalFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "unassigned", label: "Unassigned" },
  { id: "overdue", label: "Overdue" },
  { id: "critical", label: "Critical" },
];

/** The filter bar for one surface: the universal ones, its own, then Dismissed. */
export function surfaceFilters(
  extra: readonly KindFilter[],
): { id: string; label: string }[] {
  return [
    ...UNIVERSAL_FILTERS.map(({ id, label }) => ({ id: id as string, label })),
    ...extra.map(({ id, label }) => ({ id, label })),
    { id: "dismissed", label: "Dismissed" },
  ];
}

/**
 * Whether one item belongs under one filter.
 *
 * A dismissed item is hidden from every filter but its own. Hidden from the
 * work, never hidden from the reader: somebody decided it did not need doing,
 * and that decision has to remain inspectable.
 */
export function matchesFilter(
  item: SurfaceWorkItem,
  filterId: string,
  context: {
    viewerId: string | null;
    today: string;
    kindFilters?: readonly KindFilter[];
  },
): boolean {
  const dismissed = item.lifecycle === "dismissed";
  if (filterId === "dismissed") return dismissed;
  if (dismissed) return false;

  switch (filterId) {
    case "mine":
      // No viewer means no "mine". Matching everything would quietly show one
      // person another person's work.
      return context.viewerId !== null && item.ownerId === context.viewerId;
    case "unassigned":
      return item.ownerId === null;
    case "overdue":
      // Due today is due, not late — the same rule the invoice screens settle
      // on. And no due date is not overdue: nobody promised a day.
      return item.dueDate !== null && item.dueDate < context.today;
    case "critical":
      return item.severity === "critical";
    case "all":
      return true;
    default: {
      const kind = context.kindFilters?.find((f) => f.id === filterId);
      // An unknown filter shows nothing rather than everything. Falling through
      // to "all" would make a typo in a filter id look like a working filter.
      return kind ? kind.kinds.includes(item.sourceKind) : false;
    }
  }
}
