"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getSalesByCustomer, type PartyActivityResult } from "@/lib/services/party-reports";

/** Sales by Customer Summary: read-only. Nothing this action can be asked to do changes a figure. */
export async function salesByCustomerAction(when: ReportWhen): Promise<ReportRunResult<PartyActivityResult>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getSalesByCustomer(sb, checked.from!, checked.to) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
