import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import CashForecastReport from "@/components/reports/CashForecastReport";
import { reportPageContext } from "@/lib/services/report-context";
import { cashForecastAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CashFlowForecastPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="13 Week Cash Forecast"
        description="Receipts and payments expected over the next thirteen weeks."
      />
      <CashForecastReport
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        today={ctx.today}
        load={cashForecastAction}
      />
    </div>
  );
}
