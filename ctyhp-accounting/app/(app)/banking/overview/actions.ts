"use server";
import { revalidatePath } from "next/cache";
import {
  changeWorkItem,
  type WorkItemActionResult,
  type WorkItemChange,
} from "@/lib/services/work-surface/change-work-item";
import { bankingBlockingKeys } from "@/lib/services/banking-surface";
import { BANKING_NOUNS } from "@/lib/domain/banking-surface/lifecycle";

export type { WorkItemActionResult, WorkItemChange };

/**
 * One action for every change a person makes to a piece of banking work.
 *
 * The body is `changeWorkItem` — Accounting's queue and this one write the same
 * table, and two implementations would be two answers to "may this be
 * dismissed". What this file supplies is Banking's: how to work out what is
 * blocking (nothing is, and `bankingBlockingKeys` says why), and what this
 * surface calls things.
 */
export async function changeBankingWorkItemAction(
  change: WorkItemChange,
): Promise<WorkItemActionResult> {
  const result = await changeWorkItem(change, {
    blockingKeys: bankingBlockingKeys,
    nouns: BANKING_NOUNS,
  });
  if (result.ok) revalidatePath("/banking/overview");
  return result;
}
