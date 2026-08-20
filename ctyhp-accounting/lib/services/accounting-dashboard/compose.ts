import type { SupabaseClient } from "@supabase/supabase-js";
import { controlFailureItems } from "@/lib/domain/accounting-dashboard/queue-items";
import { orderQueue } from "@/lib/domain/accounting-dashboard/priority";
import type {
  AccountingControl,
  PriorityQueueItem,
  SectionEnvelope,
} from "@/lib/domain/accounting-dashboard/types";
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
  ) => Promise<PriorityQueueItem[]>;
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

  const [controlsResult, queueResult, secondaryResult] = await Promise.allSettled([
    sections.controls(sb, context),
    sections.queue(sb, context),
    sections.secondary(sb, context),
  ]);

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
          data: orderQueue([
            ...(controls.data ? controlFailureItems(controls.data, controls.generatedAt) : []),
            ...queueResult.value,
          ]),
          generatedAt: new Date().toISOString(),
          dataState: "fresh",
        }
      : failed(
          "The work queue could not be loaded, so this is not a statement that there is no work.",
          queueResult.reason,
        );

  return { context, controls, queue, secondary };
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
