"use client";
import SurfaceScreen from "@/components/work-surface/SurfaceScreen";
import type { Assignee } from "@/components/work-surface/WorkItemActions";
import type { SalesSurfaceData } from "@/lib/services/sales-surface";
import { SALES_KIND_FILTERS, SALES_NOUNS } from "@/lib/domain/sales-surface/queue-items";
import { changeSalesWorkItemAction } from "@/app/(app)/sales/actions";

/**
 * The Sales surface: who owes money, and what is being done about it.
 *
 * The work first — a named customer, a number, how many days late — then the
 * three things that can be true or false about collection. The screen this
 * replaces opened with four metric cards and a revenue chart; neither tells
 * anybody who to ring.
 *
 * Every row carries an owner and can carry a due date, which is the point: a
 * chase somebody has picked up looks different from one nobody has.
 */
export default function SalesSurface({
  data,
  viewerId,
  canManage,
  assignees,
}: {
  data: SalesSurfaceData;
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
      queueTitle="Who to chase"
      controlsTitle="Collection checks"
      kindFilters={SALES_KIND_FILTERS}
      nouns={SALES_NOUNS}
      changeAction={changeSalesWorkItemAction}
      emptyState={{
        title: "Nobody is behind",
        evidence:
          controls.dataState === "unavailable"
            ? "No overdue invoice, unapplied receipt or stale draft was found — but the checks could not run, so this is not a clean bill of health."
            : "Every issued invoice is within its terms, every receipt is applied, and nothing has been sitting in draft.",
      }}
      viewerId={viewerId}
      canManage={canManage}
      assignees={assignees}
      today={context.asOf}
      currencyCode={context.currencyCode}
      currencyDecimals={context.currencyDecimals}
      queueUnavailable="The collection work could not be loaded."
      controlsUnavailable="The collection checks could not be evaluated."
    />
  );
}
