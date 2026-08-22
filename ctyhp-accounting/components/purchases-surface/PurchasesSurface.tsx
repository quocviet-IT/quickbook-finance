"use client";
import SurfaceScreen from "@/components/work-surface/SurfaceScreen";
import type { Assignee } from "@/components/work-surface/WorkItemActions";
import type { PurchasesSurfaceData } from "@/lib/services/purchases-surface";
import {
  PURCHASES_KIND_FILTERS,
  PURCHASES_NOUNS,
} from "@/lib/domain/purchases-surface/rules";
import { changePurchasesWorkItemAction } from "@/app/(app)/purchases/actions";

/**
 * The Purchases surface: what must be paid, what has arrived, and what does not
 * add up.
 *
 * Three kinds of work in one list, ordered by the same rule, because they
 * compete for the same hour: a bill two months late, goods received in March
 * that nobody has been invoiced for, and a payment sitting against no bill are
 * all "this supplier's account is wrong" seen from different sides.
 */
export default function PurchasesSurface({
  data,
  viewerId,
  canManage,
  assignees,
}: {
  data: PurchasesSurfaceData;
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
      queueTitle="What to settle"
      controlsTitle="Purchasing checks"
      kindFilters={PURCHASES_KIND_FILTERS}
      nouns={PURCHASES_NOUNS}
      changeAction={changePurchasesWorkItemAction}
      emptyState={{
        title: "Nothing is waiting to be settled",
        evidence:
          controls.dataState === "unavailable"
            ? "No overdue bill, unbilled receipt or unapplied payment was found — but the checks could not run, so this is not a clean bill of health."
            : "Every open bill is within terms, everything received has been billed, and every payment is applied.",
      }}
      viewerId={viewerId}
      canManage={canManage}
      assignees={assignees}
      today={context.asOf}
      currencyCode={context.currencyCode}
      currencyDecimals={context.currencyDecimals}
      queueUnavailable="The purchasing work could not be loaded."
      controlsUnavailable="The purchasing checks could not be evaluated."
    />
  );
}
