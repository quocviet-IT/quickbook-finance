import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import InventoryReviewClient from "./InventoryReviewClient";

export const dynamic = "force-dynamic";

export default async function InventoryReviewPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, role] = await Promise.all([listCurrencies(sb), getUserRole()]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Inventory Review"
        description="Slow-moving and obsolete stock, and inventory carried above what it would fetch."
      />
      <InventoryReviewClient
        canWrite={canWrite(role)}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
