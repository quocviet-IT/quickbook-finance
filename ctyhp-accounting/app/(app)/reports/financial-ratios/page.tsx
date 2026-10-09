import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import FinancialRatiosClient from "./FinancialRatiosClient";
import { financialRatiosAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FinancialRatiosPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Financial Ratios"
        description="Liquidity, leverage and margin, worked out from the statements."
      />
      <FinancialRatiosClient
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        presets={ctx.presets}
        load={financialRatiosAction}
      />
    </div>
  );
}
