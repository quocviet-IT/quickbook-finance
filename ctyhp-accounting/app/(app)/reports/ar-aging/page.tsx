import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { hasPermission } from "@/lib/services/access";
import { resolveActiveCompany } from "@/lib/db/company";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import ArAgingClient from "./ArAgingClient";

export const dynamic = "force-dynamic";

export default async function ArAgingPage() {
  const sb = await createSupabaseServerClient();
  const entity = await resolveActiveCompany();
  const [currencies, company, canPostAllowance] = await Promise.all([
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
    hasPermission(sb, "journal.post"),
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
        title="Accounts Receivable Aging"
        description="Open receivables by age, reconciled to the Accounts Receivable control account."
      />
      <ArAgingClient baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2}
        companyName={company?.legal_name ?? "Company name not set"}
        canPostAllowance={canPostAllowance}
      />
    </div>
  );
}
