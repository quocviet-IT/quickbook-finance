import type { SupabaseClient } from "@supabase/supabase-js";
import { controlFailureItems } from "@/lib/domain/accounting-dashboard/queue-items";
import { orderQueue } from "@/lib/domain/accounting-dashboard/priority";
import type {
  AccountingControl,
  DerivedQueueItem,
  PriorityQueueItem,
  SectionEnvelope,
} from "@/lib/domain/accounting-dashboard/types";
import type { WorkItemState } from "@/lib/domain/accounting-dashboard/lifecycle";
import type { AccountingDashboardContext } from "./context";
import type { SecondaryAnalysis } from "./secondary-analysis";

/**
 * Putting the sections together, and surviving the ones that fail.
 *
 * Deliberately separate from `index.ts`, which decides *which* services fill
 * the slots: the rule this file encodes — a section that fails costs only
 * itself — is the promise the whole redesign turns on, and it should be
 * provable without a database, a Next.js server, or the twelve-month journal
 * query it exists to defend against.
 */

export interface AccountingDashboardData {
  context: AccountingDashboardContext;
  controls: SectionEnvelope<AccountingControl[]>;
  queue: SectionEnvelope<PriorityQueueItem[]>;
  secondary: SectionEnvelope<SecondaryAnalysis>;
}

/** How each section is fetched. Injectable, which is what makes the above testable. */
export interface AccountingDashboardSections {
  context: (sb: SupabaseClient) => Promise<AccountingDashboardContext>;
  controls: (
    sb: SupabaseClient,
    context: AccountingDashboardContext,
  ) => Promise<AccountingControl[]>;
  queue: (
    sb: SupabaseClient,
    context: AccountingDashboardContext,
  ) => Promise<DerivedQueueItem[]>;
  /** What people have decided about the work, keyed by the item's own key. */
  workState: (sb: SupabaseClient) => Promise<Map<string, WorkItemState>>;
  /** Marks as resolved the state of work no longer in the live set. */
  retire: (sb: SupabaseClient, liveKeys: readonly string[]) => Promise<number>;
  secondary: (
    sb: SupabaseClient,
    context: AccountingDashboardContext,
  ) => Promise<SecondaryAnalysis>;
}

/**
 * The old page put every read into one `Promise.all`, so a slow twelve-month
 * journal query could leave an accountant with no queue and no controls — the
 * two things they came for. Here the three sections settle independently and
 * each reports its own state.
 *
 * Control failures are merged into the queue here rather than inside the queue
 * service, for the same reason: if evaluating the controls fails, the queue
 * still has its invoices, bills, bank lines and approvals.
 *
 * The context is awaited first and is allowed to throw. Without a date and a
 * currency there is no dashboard to degrade — only an error page, which is the
 * honest outcome.
 */
export async function composeAccountingDashboard(
  sb: SupabaseClient,
  sections: AccountingDashboardSections,
): Promise<AccountingDashboardData> {
  const context = await sections.context(sb);

  const [controlsResult, queueResult, secondaryResult, stateResult] = await Promise.allSettled([
    sections.controls(sb, context),
    sections.queue(sb, context),
    sections.secondary(sb, context),
    sections.workState(sb),
  ]);

  // A failed state read costs the lifecycle columns, never the work. An
  // accountant who cannot see who owns an invoice can still see the invoice.
  const state =
    stateResult.status === "fulfilled"
      ? stateResult.value
      : (console.error("reading work item state failed:", stateResult.reason),
        new Map<string, WorkItemState>());

  const controls = envelope(
    controlsResult,
    "The accounting controls could not be evaluated. Nothing here should be read as passing.",
  );
  const secondary = envelope(
    secondaryResult,
    "The trend and journal analysis could not be loaded. The work above is unaffected.",
  );

  const queue: SectionEnvelope<PriorityQueueItem[]> =
    queueResult.status === "fulfilled"
      ? {
          data: withState(
            orderQueue([
              ...(controls.data ? controlFailureItems(controls.data, controls.generatedAt) : []),
              ...queueResult.value,
            ]),
            state,
          ),
          generatedAt: new Date().toISOString(),
          dataState: "fresh",
        }
      : failed(
          "The work queue could not be loaded, so this is not a statement that there is no work.",
          queueResult.reason,
        );

  // Retire the state of work that has gone, now that the live set is known.
  // This is the one moment it can be known, and it is what stops a dismissal
  // outliving its exception: the key of a trial-balance failure is the same
  // every time it fails, so March's dismissal would otherwise hide April's.
  if (queue.data) {
    await sections.retire(sb, queue.data.map((item) => item.key));
  }

  return { context, controls, queue, secondary };
}

/**
 * The books' half of each item, joined to what a person decided about it.
 *
 * An item nobody has touched carries the default: new, unowned, undated. That
 * is not a stored row — it is the absence of one, and saying so here keeps the
 * state table holding only decisions somebody actually made.
 */
function withState(
  items: DerivedQueueItem[],
  state: Map<string, WorkItemState>,
): PriorityQueueItem[] {
  return items.map((item) => {
    const decided = state.get(item.key);
    return {
      ...item,
      lifecycle: decided?.lifecycle ?? "new",
      ownerId: decided?.ownerId ?? null,
      ownerName: decided?.ownerName ?? null,
      dueDate: decided?.dueDate ?? null,
      dismissReason: decided?.dismissReason ?? null,
      stateVersion: decided?.version ?? null,
    };
  });
}

function envelope<T>(result: PromiseSettledResult<T>, reason: string): SectionEnvelope<T> {
  if (result.status === "fulfilled") {
    return { data: result.value, generatedAt: new Date().toISOString(), dataState: "fresh" };
  }
  return failed(reason, result.reason);
}

function failed<T>(reason: string, cause: unknown): SectionEnvelope<T> {
  // The caller's message reaches the screen, never the database's: a section
  // note is read by an accountant, and a raw Postgres error tells them nothing
  // they can act on — while possibly naming tables they should not see.
  console.error("accounting dashboard section failed:", cause);
  return {
    data: null,
    generatedAt: new Date().toISOString(),
    dataState: "unavailable",
    unavailableReason: reason,
  };
}
