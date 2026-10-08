"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getExpensesByVendor, type PartyActivityResult } from "@/lib/services/party-reports";

/** Expenses by Vendor Summary: read-only. Nothing this action can be asked to do changes a figure. */
export async function expensesByVendorAction(when: ReportWhen): Promise<ReportRunResult<PartyActivityResult>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getExpensesByVendor(sb, checked.from!, checked.to) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
