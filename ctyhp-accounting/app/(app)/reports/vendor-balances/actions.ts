"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getVendorBalances, type PartyBalancesResult } from "@/lib/services/party-reports";
import { companyClock } from "@/lib/services/report-context";

/** Vendor Balance Summary: read-only. Nothing this action can be asked to do changes a figure. */
export async function vendorBalancesAction(when: ReportWhen): Promise<ReportRunResult<PartyBalancesResult>> {
  try {
    const checked = checkWhen(when, "asOf");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getVendorBalances(sb, checked.to, (await companyClock(sb)).today) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
