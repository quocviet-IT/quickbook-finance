import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ArAgingClient from "./ArAgingClient";

export const dynamic = "force-dynamic";

export default async function ArAgingPage() {
  const sb = await createSupabaseServerClient();
  const base = (await listCurrencies(sb)).find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Accounts Receivable Aging"
        description="Open receivables by age, reconciled to the Accounts Receivable control account."
      />
      <ArAgingClient baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2} />
    </div>
  );
}
