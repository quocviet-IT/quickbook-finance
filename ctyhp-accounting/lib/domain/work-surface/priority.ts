import type { DerivedWorkItem, Severity } from "./types";

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * A queue's order, decided once, deterministically.
 *
 * Blocking work first, then severity, then age, then amount.
 *
 * **Which items may be blocking is the area's decision, not this file's.** The
 * accounting surface marks only a failed hard control; a soft check takes its
 * turn on severity like anything else. If every advisory item set the flag the
 * tier would stop meaning anything — but that is a mistake an area makes, and
 * an area is where it should be prevented.
 *
 * **Amount is the last tie-breaker, never a tier of its own**: money is what an
 * exception costs, not what makes it urgent. A missing amount therefore sorts
 * below a present one rather than above it — an item with no figure is not
 * thereby the largest.
 *
 * Two tiers the design document asks for are still missing between severity and
 * age: an SLA breach and a configured materiality threshold. The policy that
 * would feed them exists (`work-surface/policy.ts`), and wiring it in is real
 * work rather than a line here, because "breached" needs a due date this
 * function is not given. Recorded as a gap rather than quietly approximated.
 */
export function orderWork<T extends DerivedWorkItem>(items: readonly T[]): T[] {
  return orderWorkBy(items, (item) => item);
}

/** The four facts the order is decided from, and nothing else. */
export interface WorkOrderFacts {
  blocking: boolean;
  severity: Severity;
  ageDays: number;
  amountMinor?: number;
}

/**
 * The same order, for items that spell those facts differently.
 *
 * An area whose items call the blocking flag something else — accounting's is
 * `blocksClose` — passes an accessor rather than reshaping its own type or
 * casting through it. The comparison lives in one place either way, which is
 * the point: two surfaces that ordered work differently would be two answers to
 * "what should I do next".
 */
export function orderWorkBy<T>(
  items: readonly T[],
  facts: (item: T) => WorkOrderFacts,
): T[] {
  return [...items].sort((left, right) => {
    const a = facts(left);
    const b = facts(right);
    return (
      Number(b.blocking) - Number(a.blocking) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.ageDays - a.ageDays ||
      (b.amountMinor ?? 0) - (a.amountMinor ?? 0)
    );
  });
}
