import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ApAgeingClient from "./ApAgeingClient";

export const dynamic = "force-dynamic";

export default async function ApAgeingPage() {
  const sb = await createSupabaseServerClient();
  const base = (await listCurrencies(sb)).find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Accounts Payable Ageing"
        description="Open payables by age, reconciled to the Accounts Payable control account."
      />
      <ApAgeingClient baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2} />
    </div>
  );
}
