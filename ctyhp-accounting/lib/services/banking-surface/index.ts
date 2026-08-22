import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SectionEnvelope,
  SurfaceControl,
  SurfaceWorkItem,
} from "@/lib/domain/work-surface/types";
import { EMPTY_WORK_POLICY, type WorkPolicy } from "@/lib/domain/work-policy";
import { envelope, failed, withDecisions } from "@/lib/services/work-surface/envelope";
import {
  listWorkItemState,
  retireWorkItems,
} from "@/lib/services/work-surface/work-item-state";
import { getWorkPolicy } from "@/lib/services/work-policy";
import { getBankingContext, getBankingFacts, type BankingContext } from "./facts";
import { bankingControls, bankingWorkQueue } from "./sections";

export type { BankingContext } from "./facts";

/**
 * The Banking surface: what is unmatched, and how far each account is
 * reconciled.
 *
 * **Not the accounting composition with different data in it.** That page
 * answers "are the books safe to close" and needs seven controls, an
 * explanation panel and a close mode. This one answers a smaller question and
 * says so with two sections: the work, and the three things that can be true or
 * false about it. Adding a twelve-month chart because the other screen has one
 * is exactly how `WorkAreaOverview` ended up giving Inventory a "trend".
 *
 * Plan: docs/superpowers/plans/2026-08-22-accounting-cockpit-phase6.md
 */

export interface BankingSurfaceData {
  context: BankingContext;
  controls: SectionEnvelope<SurfaceControl[]>;
  queue: SectionEnvelope<SurfaceWorkItem[]>;
  policy: WorkPolicy;
}

export interface BankingSections {
  context: (sb: SupabaseClient) => Promise<BankingContext>;
  facts: (sb: SupabaseClient, context: BankingContext) => Promise<Awaited<ReturnType<typeof getBankingFacts>>>;
  workState: (sb: SupabaseClient) => Promise<Map<string, import("@/lib/domain/work-surface/lifecycle").WorkItemState>>;
  retire: (sb: SupabaseClient, liveKeys: readonly string[]) => Promise<number>;
  policy: (sb: SupabaseClient) => Promise<WorkPolicy>;
}

export const DEFAULT_BANKING_SECTIONS: BankingSections = {
  context: getBankingContext,
  facts: getBankingFacts,
  workState: listWorkItemState,
  retire: retireWorkItems,
  policy: getWorkPolicy,
};

export async function getBankingSurface(
  sb: SupabaseClient,
  sections: BankingSections = DEFAULT_BANKING_SECTIONS,
): Promise<BankingSurfaceData> {
  const context = await sections.context(sb);

  const [factsResult, stateResult, policyResult] = await Promise.allSettled([
    sections.facts(sb, context),
    sections.workState(sb),
    sections.policy(sb),
  ]);

  // An unreadable policy reads on screen exactly like an unset one: severity
  // falls back to age and nothing is called late. Losing the page over a
  // settings read would be out of all proportion.
  const policy = policyResult.status === "fulfilled" ? policyResult.value : EMPTY_WORK_POLICY;

  // A failed state read costs the owner column, never the work.
  const state =
    stateResult.status === "fulfilled"
      ? stateResult.value
      : (console.error("reading work item state failed:", stateResult.reason), new Map());

  const at = new Date().toISOString();

  // One read, two sections, two envelopes. When the read fails both say "we
  // could not look" — which is true — rather than one of them saying "nothing
  // to do", which would not be.
  const controls = envelope(
    factsResult.status === "fulfilled"
      ? { status: "fulfilled" as const, value: bankingControls(factsResult.value, context, at) }
      : factsResult,
    "The banking checks could not be evaluated. Nothing here should be read as passing.",
  );

  const queue: SectionEnvelope<SurfaceWorkItem[]> =
    factsResult.status === "fulfilled"
      ? {
          data: withDecisions(
            bankingWorkQueue(factsResult.value, context, policy.unmatchedBankAgeDays, at),
            state,
            context,
          ),
          generatedAt: at,
          dataState: "fresh",
        }
      : failed(
          "The banking work could not be loaded, so this is not a statement that there is none.",
          factsResult.reason,
        );

  if (queue.data) {
    // Retire the state of work that has gone, now the live set is known. This is
    // the one moment it can be known, and it is what stops a dismissal
    // outliving the thing it dismissed.
    await sections.retire(sb, queue.data.map((item) => item.key));
  }

  return { context, controls, queue, policy };
}

/**
 * Which Banking items are blocking. None are, and that is a decision.
 *
 * Every control on this surface summarises work the queue already itemises, so
 * no control becomes a row and nothing here is un-dismissable. Dismissing an
 * unmatched line hides the row and the `unmatched-activity` control goes on
 * counting it — nothing is hidden from the reader, only from the list.
 *
 * Stated as a function rather than left implicit because the server action asks
 * this question before allowing a dismissal, and "no items are blocking" should
 * be an answer somebody wrote down, not an empty file.
 */
export async function bankingBlockingKeys(): Promise<ReadonlySet<string>> {
  return new Set<string>();
}
