import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import ReconciliationsClient from "./ReconciliationsClient";
import { reconciliationsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReconciliationsPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Reconciliation Report"
        description="Every bank reconciliation that was signed off, and whether it still agrees with the books."
      />
      <ReconciliationsClient companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} today={ctx.today} timeZone={ctx.timeZone} load={reconciliationsAction} />
    </div>
  );
}
