"use client";
import SurfaceScreen from "@/components/work-surface/SurfaceScreen";
import type { Assignee } from "@/components/work-surface/WorkItemActions";
import type { BankingSurfaceData } from "@/lib/services/banking-surface";
import { BANKING_KIND_FILTERS, BANKING_NOUNS } from "@/lib/domain/banking-surface/lifecycle";
import { changeBankingWorkItemAction } from "@/app/(app)/banking/overview/actions";

/**
 * The Banking surface.
 *
 * Two sections, and the order is the whole decision: **the work first, then the
 * three things that can be true or false about it.** The screen this replaces
 * opened with four metric cards and a twelve-month chart, and somebody looking
 * for what to match had to scroll past both.
 *
 * There is no chart here at all. Banking's job is *what is unmatched, and how
 * far each account is reconciled* — a trend line answers neither question, and
 * the only reason to draw one would be that another screen has one.
 */
export default function BankingSurface({
  data,
  viewerId,
  canManage,
  assignees,
}: {
  data: BankingSurfaceData;
  viewerId: string | null;
  canManage: boolean;
  assignees: Assignee[];
}) {
  const { context, controls, queue } = data;
  return (
    <SurfaceScreen
      facts={[`As of ${context.asOf}`, context.currencyCode, context.timeZone]}
      queue={queue}
      controls={controls}
      queueTitle="What needs matching"
      controlsTitle="Banking checks"
      kindFilters={BANKING_KIND_FILTERS}
      nouns={BANKING_NOUNS}
      changeAction={changeBankingWorkItemAction}
      emptyState={{
        title: "Nothing is waiting to be matched",
        // An empty queue means something only when the checks behind it ran.
        evidence:
          controls.dataState === "unavailable"
            ? "No unmatched line, broken feed or unfinished reconciliation was found — but the checks could not run, so this is not a clean bill of health."
            : "Every settled line is matched or set aside, every feed is syncing, and no reconciliation was left open.",
      }}
      viewerId={viewerId}
      canManage={canManage}
      assignees={assignees}
      today={context.asOf}
      currencyCode={context.currencyCode}
      currencyDecimals={context.currencyDecimals}
      queueUnavailable="The banking work could not be loaded."
      controlsUnavailable="The banking checks could not be evaluated."
    />
  );
}
