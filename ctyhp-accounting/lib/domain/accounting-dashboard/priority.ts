import { orderWorkBy } from "@/lib/domain/work-surface/priority";
import type { DerivedQueueItem } from "./types";

export { SEVERITY_RANK } from "@/lib/domain/work-surface/priority";

/**
 * The accounting queue's order.
 *
 * The rule moved to `lib/domain/work-surface/priority.ts` in Phase 6 — blocking
 * work, then severity, then age, then amount is not an accounting idea. This
 * wrapper does one accounting-specific thing: it says that `blocksClose` is what
 * "blocking" means on this surface.
 *
 * Only a failed *hard* control ever sets that flag here (`queue-items.ts` sets
 * `blocksClose: control.status === "blocked"`, and every other builder sets
 * false). An advisory control therefore takes its turn on severity like anything
 * else — if every soft check claimed the top of the page, the tier would stop
 * meaning anything.
 */
export function orderQueue<T extends DerivedQueueItem>(items: T[]): T[] {
  return orderWorkBy(items, (item) => ({
    blocking: item.blocksClose,
    severity: item.severity,
    ageDays: item.ageDays,
    amountMinor: item.amountMinor,
  }));
}
