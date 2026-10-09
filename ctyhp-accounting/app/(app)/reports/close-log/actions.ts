"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getCloseLog } from "@/lib/services/review-reports";
import type { CloseLogReport } from "@/lib/domain/close-log";

/** Month-End Close Log: read-only. Nothing this action can be asked to do changes a figure. */
export async function closeLogAction(when: ReportWhen): Promise<ReportRunResult<CloseLogReport>> {
  try {
    const checked = checkWhen(when, "fiscalYear");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getCloseLog(sb, checked.fiscalYear!) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
