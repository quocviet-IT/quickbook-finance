import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import InventoryValuationClient from "./InventoryValuationClient";

export const dynamic = "force-dynamic";

export default async function InventoryValuationPage() {
  const sb = await createSupabaseServerClient();
  const base = (await listCurrencies(sb)).find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Inventory Valuation"
        description="Quantity and weighted-average value per tracked item, reconciled to the inventory control accounts."
      />
      <InventoryValuationClient
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
