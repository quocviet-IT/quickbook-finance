import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import CashFlowClient from "./CashFlowClient";

export const dynamic = "force-dynamic";

export default async function CashFlowPage() {
  const sb = await createSupabaseServerClient();
  const base = (await listCurrencies(sb)).find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Cash Flow Statement"
        description="Indirect method — net income and balance-sheet drivers reconciled to ending cash."
      />
      <CashFlowClient baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2} />
    </div>
  );
}
