import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { getUserRole } from "@/lib/auth";
import { resolveActiveCompany } from "@/lib/db/company";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite } from "@/lib/domain/roles";
import { listFinancialAnalyses } from "@/lib/services/financial-analysis";
import { listCurrencies } from "@/lib/services/reference";
import AnalysisClient from "./AnalysisClient";

export const dynamic = "force-dynamic";

export default async function FinancialAnalysisPage() {
  const sb = await createSupabaseServerClient();
  const [entity, role, frozen, currencies] = await Promise.all([
    resolveActiveCompany(),
    getUserRole(),
    listFinancialAnalyses(sb, true),
    listCurrencies(sb),
  ]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        meta={
          <ReportEntityBadge
            companyName={entity.active?.dbaName || entity.active?.legalName || "No company selected"}
            isSample={entity.active?.isSample ?? false}
          />
        }
        title="What-If Analysis"
        description="Lay hypothetical adjustments over real numbers and see where they land. Nothing here posts to the books — freeze a scenario to keep it."
      />
      <AnalysisClient
        canFreeze={canWrite(role)}
        frozenReports={frozen}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
