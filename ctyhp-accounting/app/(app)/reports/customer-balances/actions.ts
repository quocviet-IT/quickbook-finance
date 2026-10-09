"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getCustomerBalances, type PartyBalancesResult } from "@/lib/services/party-reports";
import { companyClock } from "@/lib/services/report-context";

/** Customer Balance Summary: read-only. Nothing this action can be asked to do changes a figure. */
export async function customerBalancesAction(when: ReportWhen): Promise<ReportRunResult<PartyBalancesResult>> {
  try {
    const checked = checkWhen(when, "asOf");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getCustomerBalances(sb, checked.to, (await companyClock(sb)).today) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
