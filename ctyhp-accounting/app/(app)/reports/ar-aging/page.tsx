import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { getCurrentCompanySettings } from "@/lib/services/company";
import PageHeader from "@/components/PageHeader";
import ArAgingClient from "./ArAgingClient";

export const dynamic = "force-dynamic";

export default async function ArAgingPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, company] = await Promise.all([
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
  ]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Accounts Receivable Aging"
        description="Open receivables by age, reconciled to the Accounts Receivable control account."
      />
      <ArAgingClient baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2}
        companyName={company?.legal_name ?? "Company name not set"}
      />
    </div>
  );
}
