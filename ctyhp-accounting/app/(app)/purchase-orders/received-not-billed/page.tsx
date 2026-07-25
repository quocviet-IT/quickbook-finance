import { createSupabaseServerClient } from "@/lib/db/server";
import { getReceivedNotBilled } from "@/lib/services/purchasing";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ReceivedNotBilledClient from "./ReceivedNotBilledClient";

export const dynamic = "force-dynamic";

export default async function ReceivedNotBilledPage() {
  const sb = await createSupabaseServerClient();
  const [rows, currencies] = await Promise.all([getReceivedNotBilled(sb), listCurrencies(sb)]);

  return (
    <div>
      <PageHeader
        title="Received Not Billed"
        description="Goods and services that have arrived against a purchase order but have no vendor bill yet."
        breadcrumbItems={[{ title: "Purchase Orders", href: "/purchase-orders" }, { title: "Received Not Billed" }]}
      />
      <ReceivedNotBilledClient rows={rows} currencies={currencies} />
    </div>
  );
}
