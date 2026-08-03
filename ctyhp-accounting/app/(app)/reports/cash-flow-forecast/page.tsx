import { createSupabaseServerClient } from "@/lib/db/server";
import { getCashFlowForecast, listOpenItems, FORECAST_WEEKS } from "@/lib/services/forecast";
import { resolveActiveCompany } from "@/lib/db/company";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import CashFlowForecastClient from "./CashFlowForecastClient";

export const dynamic = "force-dynamic";

export default async function CashFlowForecastPage() {
  const sb = await createSupabaseServerClient();
  const entity = await resolveActiveCompany();
  const asOf = new Date().toISOString().slice(0, 10);
  const [forecast, openItems] = await Promise.all([
    getCashFlowForecast(sb, { asOf, weeks: FORECAST_WEEKS }),
    listOpenItems(sb, asOf),
  ]);

  return (
    <div>
      <PageHeader
        meta={
          <ReportEntityBadge
            companyName={entity.active?.dbaName || entity.active?.legalName || "No company selected"}
            isSample={entity.active?.isSample ?? false}
          />
        }
        title="Cash Flow Forecast"
        description="Money still owed to you and by you, projected onto the weeks ahead — on the dates the documents say, and on the dates people actually pay."
      />
      <CashFlowForecastClient forecast={forecast} openItems={openItems} />
    </div>
  );
}
