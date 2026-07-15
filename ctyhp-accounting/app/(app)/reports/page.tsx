import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ReportsClient from "./ReportsClient";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const sb = await createSupabaseServerClient();
  const currencies = await listCurrencies(sb);
  const base = currencies.find((c) => c.is_base);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Financial statements derived directly from the ledger."
      />
      <ReportsClient baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2} />
    </div>
  );
}
