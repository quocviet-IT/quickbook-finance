"use server";
import { revalidatePath } from "next/cache";
import {
  changeWorkItem,
  type WorkItemActionResult,
  type WorkItemChange,
} from "@/lib/services/work-surface/change-work-item";
import { purchasesBlockingKeys } from "@/lib/services/purchases-surface";
import { PURCHASES_NOUNS } from "@/lib/domain/purchases-surface/rules";

export type { WorkItemActionResult, WorkItemChange };

/** One action for every change a person makes to a piece of purchasing work. */
export async function changePurchasesWorkItemAction(
  change: WorkItemChange,
): Promise<WorkItemActionResult> {
  const result = await changeWorkItem(change, {
    blockingKeys: purchasesBlockingKeys,
    nouns: PURCHASES_NOUNS,
  });
  if (result.ok) revalidatePath("/purchases");
  return result;
}
