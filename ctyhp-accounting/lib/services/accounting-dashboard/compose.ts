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
import { EMPTY_WORK_POLICY, type WorkPolicy } from "@/lib/domain/accounting-dashboard/policy";
import {
  closeRecommendation,
  type CloseRecommendation,
} from "@/lib/domain/accounting-dashboard/close-checklist";
import { formatMoney } from "@/lib/format";
import { createRequestMemo, type RequestMemo } from "@/lib/services/request-memo";
import type { CloseReadiness } from "./close-readiness";
import type { InsightSection } from "./insights";
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

/**
 * Which question the screen is answering.
 *
 * Daily is "what needs doing today". Close is "can this period be signed off".
 * They want different things first, and pretending one layout serves both is
 * how the page this replaced ended up serving neither.
 */
export type DashboardMode = "daily" | "close";

export interface AccountingDashboardData {
  mode: DashboardMode;
  context: AccountingDashboardContext;
  controls: SectionEnvelope<AccountingControl[]>;
  queue: SectionEnvelope<PriorityQueueItem[]>;
  insights: SectionEnvelope<InsightSection>;
  secondary: SectionEnvelope<SecondaryAnalysis>;
  /**
   * Whether an accountant should be closing rather than doing daily work.
   * Costs nothing: the periods are already in the context and the policy is
   * already fetched, so daily mode pays no query for this.
   */
  recommendation: CloseRecommendation;
  /**
   * The close checklist. Null in daily mode, where it was never asked for —
   * which is different from a close section that was asked for and failed, and
   * different again from `data: null` inside it, which means this company has
   * no period to close.
   */
  close: SectionEnvelope<CloseReadiness | null> | null;
  /** What the company has configured, so the screen can say what it has not. */
  policy: WorkPolicy;
}

/** How each section is fetched. Injectable, which is what makes the above testable. */
export interface AccountingDashboardSections {
  context: (sb: SupabaseClient) => Promise<AccountingDashboardContext>;
  controls: (
    sb: SupabaseClient,
    context: AccountingDashboardContext,
    memo: RequestMemo,
  ) => Promise<AccountingControl[]>;
  queue: (
    sb: SupabaseClient,
    context: AccountingDashboardContext,
  ) => Promise<DerivedQueueItem[]>;
  /** What people have decided about the work, keyed by the item's own key. */
  workState: (sb: SupabaseClient) => Promise<Map<string, WorkItemState>>;
  /** Marks as resolved the state of work no longer in the live set. */
  retire: (sb: SupabaseClient, liveKeys: readonly string[]) => Promise<number>;
  policy: (sb: SupabaseClient) => Promise<WorkPolicy>;
  /**
   * Runs after the controls, because most of what an insight has to say is
   * about what a control found. A control section that failed simply gives the
   * rules less to work with, which is the honest outcome.
   */
  insights: (
    sb: SupabaseClient,
    context: AccountingDashboardContext,
    policy: WorkPolicy,
    /**
     * A promise, not a value. The rules need the controls; the reads behind
     * them do not, and passing the settled array would serialise two sections
     * that can overlap almost entirely.
     */
    controls: PromiseLike<readonly AccountingControl[]>,
    memo: RequestMemo,
  ) => Promise<InsightSection>;
  secondary: (
    sb: SupabaseClient,
    context: AccountingDashboardContext,
  ) => Promise<SecondaryAnalysis>;
  /** Only called in close mode. Returns null when there is no period to close. */
  close: (
    sb: SupabaseClient,
    context: AccountingDashboardContext,
  ) => Promise<CloseReadiness | null>;
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
  mode: DashboardMode = "daily",
): Promise<AccountingDashboardData> {
  const context = await sections.context(sb);

  // Created here and dropped when this render ends, so two sections wanting the
  // same read pay for one. Scoped to the request on purpose: see request-memo.ts.
  const memo = createRequestMemo();

  // Everything below starts now. The only ordering that survives is the one
  // the data genuinely requires: the rules need the policy and the controls,
  // and they await those themselves at the moment they need them. Awaiting the
  // controls out here — which is what this did — put a whole round trip on the
  // critical path to satisfy an argument list.
  const policyPromise = sections.policy(sb).catch((reason) => {
    // An unreadable policy is the same on screen as an unset one: the rules
    // that need it stay asleep and say so. Losing the dashboard over a settings
    // read would be out of all proportion.
    console.error("reading the work policy failed:", reason);
    return EMPTY_WORK_POLICY;
  });
  const controlsPromise = sections.controls(sb, context, memo);
  // Settled immediately so a slow or failing section can never surface as an
  // unhandled rejection while its siblings are still in flight.
  const settled = <T,>(promise: Promise<T>): Promise<PromiseSettledResult<T>> =>
    promise.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason) => ({ status: "rejected" as const, reason }),
    );

  const controlsSettled = settled(controlsPromise);
  // Started here rather than at the end. It needs only the context, so waiting
  // until the other sections had finished bought nothing but a round trip. In
  // daily mode it is never started at all: `null` means "not asked for", which
  // is a different thing from a section that was asked for and failed.
  const closeSettled =
    mode === "close" ? settled(sections.close(sb, context)) : Promise.resolve(null);
  const insightsSettled = settled(
    policyPromise.then((policy) => sections.insights(sb, context, policy, controlsPromise, memo)),
  );

  const [queueResult, secondaryResult, stateResult, controlsResult, insightsResult, policy] =
    await Promise.all([
      settled(sections.queue(sb, context)),
      settled(sections.secondary(sb, context)),
      settled(sections.workState(sb)),
      controlsSettled,
      insightsSettled,
      policyPromise,
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
  // Its own envelope, so a rule engine that throws costs the explanation and
  // never the work.
  const insights = envelope(
    insightsResult,
    "The explanations could not be worked out. The work and the controls above are unaffected.",
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
            context,
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
  //
  // Run alongside the close checklist rather than after it: one is a write that
  // nothing else waits on, the other a read that started long ago, and neither
  // has anything to say to the other.
  const [closeResult] = await Promise.all([
    closeSettled,
    queue.data ? sections.retire(sb, queue.data.map((item) => item.key)) : Promise.resolve(0),
  ]);

  const close: SectionEnvelope<CloseReadiness | null> | null =
    closeResult === null
      ? null
      : closeResult.status === "fulfilled"
        ? {
            data: closeResult.value,
            generatedAt: new Date().toISOString(),
            dataState: "fresh",
          }
        : failed<CloseReadiness | null>(
            "The close checklist could not be worked out, so nothing here says this period is ready.",
            closeResult.reason,
          );

  const oldestOverdue = [...context.overduePeriods].sort((a, b) =>
    a.periodEnd.localeCompare(b.periodEnd),
  )[0];

  return {
    mode,
    context,
    controls,
    queue,
    insights,
    secondary,
    close,
    policy,
    recommendation: closeRecommendation({
      today: context.asOf,
      overdueCount: context.overduePeriods.length,
      oldestOverdueLabel: oldestOverdue?.label ?? null,
      currentPeriodEnd: context.currentPeriod?.periodEnd ?? null,
      closeWindowDays: policy.closeWindowDays,
    }),
  };
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
  context: AccountingDashboardContext,
): PriorityQueueItem[] {
  return items.map((item) => {
    const decided = state.get(item.key);
    return {
      ...item,
      amountText:
        item.amountMinor === undefined
          ? null
          : formatMoney(item.amountMinor, context.currencyCode, context.currencyDecimals),
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
