"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getReconciliationList } from "@/lib/services/review-reports";
import type { ReconciliationListReport } from "@/lib/domain/reconciliation-list";

/** Reconciliation Report: read-only. Nothing this action can be asked to do changes a figure. */
export async function reconciliationsAction(when: ReportWhen): Promise<ReportRunResult<ReconciliationListReport>> {
  try {
    checkWhen(when, "none");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getReconciliationList(sb) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
