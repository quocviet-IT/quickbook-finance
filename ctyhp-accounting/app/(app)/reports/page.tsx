import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { hasPermission } from "@/lib/services/access";
import PageHeader from "@/components/PageHeader";
import ReportsClient from "./ReportsClient";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, company, canManageBudget] = await Promise.all([
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
    hasPermission(sb, "budget.manage"),
  ]);
  const base = currencies.find((c) => c.is_base);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Financial statements derived directly from the ledger."
      />
      <ReportsClient
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
        companyName={company?.legal_name ?? "CTYHP Accounting"}
        fiscalStartMonth={company?.fiscal_year_start_month ?? 1}
        canManageBudget={canManageBudget}
      />
    </div>
  );
}
