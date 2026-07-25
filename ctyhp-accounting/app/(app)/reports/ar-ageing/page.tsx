import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ArAgeingClient from "./ArAgeingClient";

export const dynamic = "force-dynamic";

export default async function ArAgeingPage() {
  const sb = await createSupabaseServerClient();
  const base = (await listCurrencies(sb)).find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Accounts Receivable Ageing"
        description="Open receivables by age, reconciled to the Accounts Receivable control account."
      />
      <ArAgeingClient baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2} />
    </div>
  );
}
