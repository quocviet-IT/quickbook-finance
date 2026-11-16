import MonthEndClose from "@/components/dashboard-home/MonthEndClose";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { HomeCloseReport } from "@/lib/domain/dashboard-home/types";
import { getHomeClose } from "@/lib/services/dashboard-home";

/**
 * Month-end close on the Dashboard (3.0.38), read on the server after the rest
 * of the page has been sent: the page wraps it in Suspense, so the checklist's
 * reads (about a dozen) never hold up the figures. A failed read makes this
 * card unavailable and nothing else.
 */
export default async function CloseSection({ asOf }: { asOf: string }) {
  // Only the read is guarded: an error while drawing belongs to an error boundary, not here.
  let report: HomeCloseReport | null = null;
  let failed = false;
  try {
    const sb = await createSupabaseServerClient();
    report = await getHomeClose(sb, { asOf });
  } catch (cause) {
    console.error("Month-end close could not be read:", cause);
    failed = true;
  }
  if (failed || !report) return <MonthEndClose failure="Month-end close could not be read." />;
  return <MonthEndClose report={report} />;
}
