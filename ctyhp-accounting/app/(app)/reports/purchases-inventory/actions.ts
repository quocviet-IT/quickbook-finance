"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { PurchasesInventoryReport } from "@/lib/domain/purchases-inventory";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getPurchasesInventory } from "@/lib/services/purchases-inventory";

/** Purchases and Inventory: read-only. Nothing this action can be asked to do changes a figure. */
export async function purchasesInventoryAction(when: ReportWhen): Promise<ReportRunResult<PurchasesInventoryReport>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getPurchasesInventory(sb, checked.from as string, checked.to) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
