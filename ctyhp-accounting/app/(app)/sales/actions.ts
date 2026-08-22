"use server";
import { revalidatePath } from "next/cache";
import {
  changeWorkItem,
  type WorkItemActionResult,
  type WorkItemChange,
} from "@/lib/services/work-surface/change-work-item";
import { salesBlockingKeys } from "@/lib/services/sales-surface";
import { SALES_NOUNS } from "@/lib/domain/sales-surface/queue-items";

export type { WorkItemActionResult, WorkItemChange };

/**
 * One action for every change a person makes to a piece of collection work.
 *
 * The body is `changeWorkItem` — every surface writes the same table, and a
 * second implementation would be a second answer to "may this be dismissed".
 * What this file supplies is Sales's: how to work out what is blocking (nothing
 * is, and `salesBlockingKeys` says why), and what this surface calls things.
 */
export async function changeSalesWorkItemAction(
  change: WorkItemChange,
): Promise<WorkItemActionResult> {
  const result = await changeWorkItem(change, {
    blockingKeys: salesBlockingKeys,
    nouns: SALES_NOUNS,
  });
  if (result.ok) revalidatePath("/sales");
  return result;
}
