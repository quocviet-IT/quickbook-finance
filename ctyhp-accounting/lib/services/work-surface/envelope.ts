import type { SectionEnvelope } from "@/lib/domain/work-surface/types";
import type { WorkItemState } from "@/lib/domain/work-surface/lifecycle";
import { formatMoney } from "@/lib/format";

/**
 * The rule every surface composes by: a section that fails costs only itself.
 *
 * The old overview screens put every read into one `Promise.all`, so one slow
 * query left a reader with none of the things they came for. Here each section
 * settles on its own and reports its own state — and a section that could not be
 * computed says so rather than rendering as an empty one.
 *
 * Deliberately separate from any area's composition: the promise the whole
 * redesign turns on should be provable without a database, a Next.js server, or
 * the twelve-month query it exists to defend against.
 *
 * Plan: docs/superpowers/plans/2026-08-22-accounting-cockpit-phase6.md
 */

/** A settled section, wrapped. `reason` reaches the screen; the cause does not. */
export function envelope<T>(
  result: PromiseSettledResult<T>,
  reason: string,
): SectionEnvelope<T> {
  if (result.status === "fulfilled") {
    return { data: result.value, generatedAt: new Date().toISOString(), dataState: "fresh" };
  }
  return failed(reason, result.reason);
}

/**
 * A section that could not be computed.
 *
 * The caller's message reaches the screen, never the database's: a section note
 * is read by a person doing their job, and a raw Postgres error tells them
 * nothing they can act on — while possibly naming tables they should not see.
 */
export function failed<T>(reason: string, cause: unknown): SectionEnvelope<T> {
  console.error("work surface section failed:", cause);
  return {
    data: null,
    generatedAt: new Date().toISOString(),
    dataState: "unavailable",
    unavailableReason: reason,
  };
}

/** A section fetched with `.then`, wrapped the same way as a settled one. */
export function envelopeOf<T>(
  work: Promise<T>,
  reason: string,
): Promise<SectionEnvelope<T>> {
  return work
    .then<SectionEnvelope<T>>((data) => ({
      data,
      generatedAt: new Date().toISOString(),
      dataState: "fresh",
    }))
    .catch((cause) => failed<T>(reason, cause));
}

/**
 * What the records say about each item, joined to what a person decided about
 * it.
 *
 * An item nobody has touched carries the default: new, unowned, undated. That is
 * not a stored row — it is the absence of one, and saying so here keeps the
 * state table holding only decisions somebody actually made.
 *
 * The money string is produced here for the same reason: it never changes while
 * the page is open, so working it out in the browser means shipping a currency
 * formatter to print a fixed number.
 */
export function withDecisions<T extends { key: string; amountMinor?: number }>(
  items: readonly T[],
  state: ReadonlyMap<string, WorkItemState>,
  currency: { currencyCode: string; currencyDecimals: number },
): (T & {
  amountText: string | null;
  lifecycle: WorkItemState["lifecycle"];
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  dismissReason: string | null;
  stateVersion: number | null;
})[] {
  return items.map((item) => {
    const decided = state.get(item.key);
    return {
      ...item,
      amountText:
        item.amountMinor === undefined
          ? null
          : formatMoney(item.amountMinor, currency.currencyCode, currency.currencyDecimals),
      lifecycle: decided?.lifecycle ?? ("new" as const),
      ownerId: decided?.ownerId ?? null,
      ownerName: decided?.ownerName ?? null,
      dueDate: decided?.dueDate ?? null,
      dismissReason: decided?.dismissReason ?? null,
      stateVersion: decided?.version ?? null,
    };
  });
}
