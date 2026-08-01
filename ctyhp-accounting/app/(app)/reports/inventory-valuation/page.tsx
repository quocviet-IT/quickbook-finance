import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { getInventoryPolicy } from "@/lib/services/inventory-review";
import PageHeader from "@/components/PageHeader";
import InventoryValuationClient from "./InventoryValuationClient";

export const dynamic = "force-dynamic";

export default async function InventoryValuationPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, policy] = await Promise.all([listCurrencies(sb), getInventoryPolicy(sb)]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Inventory Valuation"
        description="Quantity and value per tracked item, on the company's stated cost basis, reconciled to the inventory control accounts."
      />
      <InventoryValuationClient
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
        valuationMethod={policy.method}
        policyMemo={policy.memo}
      />
    </div>
  );
}
