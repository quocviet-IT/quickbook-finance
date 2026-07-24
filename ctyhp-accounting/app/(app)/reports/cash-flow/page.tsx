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
      <PageHeader title="Cash Flow Statement" description="Direct method — cash movement by activity, reconciled to the change in cash." />
      <CashFlowClient baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2} />
    </div>
  );
}
