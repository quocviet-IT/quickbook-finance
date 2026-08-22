"use client";
import SurfaceScreen from "@/components/work-surface/SurfaceScreen";
import type { Assignee } from "@/components/work-surface/WorkItemActions";
import type { InventorySurfaceData } from "@/lib/services/inventory-surface";
import {
  INVENTORY_KIND_FILTERS,
  INVENTORY_NOUNS,
} from "@/lib/domain/inventory-surface/rules";
import { changeInventoryWorkItemAction } from "@/app/(app)/inventory/actions";

/**
 * The Inventory surface: can we sell it, and does the stock tie to the ledger?
 *
 * The only one of the four with a row that cannot be dismissed. A valuation
 * variance sits at the top with "blocks a reliable valuation" beside it, because
 * until it is explained the quantities on this screen and the figure on the
 * balance sheet are two different answers to one question.
 */
export default function InventorySurface({
  data,
  viewerId,
  canManage,
  assignees,
}: {
  data: InventorySurfaceData;
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
      queueTitle="What to sort out"
      controlsTitle="Inventory checks"
      kindFilters={INVENTORY_KIND_FILTERS}
      nouns={INVENTORY_NOUNS}
      changeAction={changeInventoryWorkItemAction}
      blockingTag={{
        label: "blocks valuation",
        title: "Until this is explained, neither the stock figure nor the ledger can be relied on.",
      }}
      emptyState={{
        title: "Stock is straight",
        evidence:
          controls.dataState === "unavailable"
            ? "No negative stock or unposted depreciation was found — but the checks could not run, so this is not a clean bill of health."
            : "Nothing is below zero, the stock ties to the ledger, and no depreciation is waiting to be posted.",
      }}
      viewerId={viewerId}
      canManage={canManage}
      assignees={assignees}
      today={context.asOf}
      currencyCode={context.currencyCode}
      currencyDecimals={context.currencyDecimals}
      queueUnavailable="The inventory work could not be loaded."
      controlsUnavailable="The inventory checks could not be evaluated."
    />
  );
}
