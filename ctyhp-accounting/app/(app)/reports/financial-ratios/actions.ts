"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { FinancialRatiosReport } from "@/lib/domain/financial-ratios";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getFinancialRatios } from "@/lib/services/financial-ratios";

/** Financial Ratios: read-only. Nothing this action can be asked to do changes a figure. */
export async function financialRatiosAction(when: ReportWhen): Promise<ReportRunResult<FinancialRatiosReport>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getFinancialRatios(sb, checked.from as string, checked.to) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
