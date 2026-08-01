import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { getCurrentCompanySettings } from "@/lib/services/company";
import PageHeader from "@/components/PageHeader";
import ApAgingClient from "./ApAgingClient";

export const dynamic = "force-dynamic";

export default async function ApAgingPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, company] = await Promise.all([
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
  ]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Accounts Payable Aging"
        description="Open payables by age, reconciled to the Accounts Payable control account."
      />
      <ApAgingClient baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2}
        companyName={company?.legal_name ?? "Company name not set"}
      />
    </div>
  );
}
