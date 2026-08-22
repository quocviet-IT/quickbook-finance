"use server";
import { revalidatePath } from "next/cache";
import {
  changeWorkItem,
  type WorkItemActionResult,
  type WorkItemChange,
} from "@/lib/services/work-surface/change-work-item";
import { inventoryBlockingKeys } from "@/lib/services/inventory-surface";
import { INVENTORY_NOUNS } from "@/lib/domain/inventory-surface/rules";

export type { WorkItemActionResult, WorkItemChange };

/**
 * One action for every change a person makes to a piece of inventory work.
 *
 * The only one of the four surfaces where `blockingKeys` does real work: a
 * valuation variance cannot be dismissed, and whether the key being dismissed
 * *is* the variance is re-derived from the ledger here rather than believed from
 * the browser.
 */
export async function changeInventoryWorkItemAction(
  change: WorkItemChange,
): Promise<WorkItemActionResult> {
  const result = await changeWorkItem(change, {
    blockingKeys: inventoryBlockingKeys,
    nouns: INVENTORY_NOUNS,
  });
  if (result.ok) revalidatePath("/inventory");
  return result;
}
