"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getUnpaidBills, type OpenDocumentsResult } from "@/lib/services/party-reports";
import { companyClock } from "@/lib/services/report-context";

/** Unpaid Bills: read-only. Nothing this action can be asked to do changes a figure. */
export async function unpaidBillsAction(when: ReportWhen): Promise<ReportRunResult<OpenDocumentsResult>> {
  try {
    const checked = checkWhen(when, "asOf");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getUnpaidBills(sb, checked.to, (await companyClock(sb)).today) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
