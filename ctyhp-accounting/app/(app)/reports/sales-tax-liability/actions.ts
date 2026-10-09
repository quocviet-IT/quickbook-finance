"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import type { SalesTaxLiabilityData } from "@/lib/domain/sales-tax-liability";
import { getSalesTaxLiabilityData } from "@/lib/services/sales-tax-liability";

/** Sales Tax Liability: read-only. Recording a payment goes through the Sales Tax Center's own action. */
export async function salesTaxLiabilityAction(when: ReportWhen): Promise<ReportRunResult<SalesTaxLiabilityData>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getSalesTaxLiabilityData(sb, checked.from as string, checked.to) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
