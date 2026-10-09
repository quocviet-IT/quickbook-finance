"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import type { ChangeLogReport } from "@/lib/domain/change-log";
import { getChangeLog } from "@/lib/services/review-reports";

/**
 * Change Log: read-only. The audit search itself refuses anybody without
 * `audit.read`, so a reader the page let through by mistake still sees nothing.
 */
export async function changeLogAction(when: ReportWhen): Promise<ReportRunResult<ChangeLogReport>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getChangeLog(sb, checked.from!, checked.to) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
