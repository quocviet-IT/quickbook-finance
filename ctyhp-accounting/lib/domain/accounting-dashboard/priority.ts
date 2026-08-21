import type { DerivedQueueItem, QueueSeverity } from "./types";

export const SEVERITY_RANK: Record<QueueSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * The queue's order, decided once, deterministically.
 *
 * The design document's order is: close-blocking control failures, severity,
 * SLA breach, configured materiality, age, amount. Two of those tiers are
 * missing here on purpose — no company can yet configure an SLA or a
 * materiality threshold, and the document is explicit that an unconfigured
 * value must be recorded as a gap rather than invented (spec §7.2, Phase 0.4).
 * They join between severity and age when Phase 3 gives them a home; the
 * tiers around them do not move.
 *
 * Amount is the last tie-breaker, never a tier of its own: money is what an
 * exception costs, not what makes it urgent. A missing amount therefore sorts
 * below a present one rather than above it.
 */
export function orderQueue<T extends DerivedQueueItem>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      blockingRank(a) - blockingRank(b) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.ageDays - a.ageDays ||
      (b.amountMinor ?? 0) - (a.amountMinor ?? 0),
  );
}

/**
 * 0 for a control failure that can block the close, 1 for everything else.
 *
 * Only a *blocking* control jumps the queue. An advisory control takes its
 * turn on severity like any other item, or every soft check would claim the
 * top of the page and the tier would stop meaning anything.
 */
function blockingRank(item: DerivedQueueItem): number {
  return item.sourceKind === "control-failure" && item.blocksClose ? 0 : 1;
}
