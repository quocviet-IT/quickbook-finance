"use client";
import SurfaceScreen from "@/components/work-surface/SurfaceScreen";
import type { Assignee } from "@/components/work-surface/WorkItemActions";
import type { InventorySurfaceData } from "@/lib/services/inventory-surface";
import {
  INVENTORY_KIND_FILTERS,
  INVENTORY_NOUNS,
  inventoryQueueEmptyState,
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
      emptyState={inventoryQueueEmptyState(controls.dataState === "unavailable" ? null : (controls.data ?? null))}
      viewerId={viewerId}
      canManage={canManage}
      assignees={assignees}
      today={context.asOf}
      timeZone={context.timeZone}
      currencyCode={context.currencyCode}
      currencyDecimals={context.currencyDecimals}
      queueUnavailable="The inventory work could not be loaded."
      controlsUnavailable="The inventory checks could not be evaluated."
    />
  );
}
