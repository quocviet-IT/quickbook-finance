"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getCashForecast, type CashForecastData } from "@/lib/services/forecast";
import { reportPageContext } from "@/lib/services/report-context";

/**
 * 13 Week Cash Forecast: read-only. A forecast always starts today, in the
 * company's own time zone, so the dates the page sends are checked and ignored.
 */
export async function cashForecastAction(when: ReportWhen): Promise<ReportRunResult<CashForecastData>> {
  try {
    checkWhen(when, "none");
    const sb = await createSupabaseServerClient();
    const ctx = await reportPageContext(sb);
    return { ok: true, data: await getCashForecast(sb, { today: ctx.today, baseCurrency: ctx.currencyCode }) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
