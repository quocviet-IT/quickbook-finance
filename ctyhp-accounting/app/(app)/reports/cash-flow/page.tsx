import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { resolveActiveCompany } from "@/lib/db/company";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import CashFlowClient from "./CashFlowClient";

export const dynamic = "force-dynamic";

export default async function CashFlowPage() {
  const sb = await createSupabaseServerClient();
  const entity = await resolveActiveCompany();
  const [currencies, company] = await Promise.all([
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
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
        title="Cash Flow Statement"
        description="Indirect method — net income and balance-sheet drivers reconciled to ending cash."
      />
      <CashFlowClient
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
        companyName={company?.legal_name ?? "Company name not set"}
      />
    </div>
  );
}
