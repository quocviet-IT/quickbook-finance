import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { listVendors } from "@/lib/services/payables";
import PageHeader from "@/components/PageHeader";
import VendorStatementClient from "./VendorStatementClient";

export const dynamic = "force-dynamic";

export default async function VendorStatementPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, vendors] = await Promise.all([listCurrencies(sb), listVendors(sb)]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Vendor Statement"
        description="Opening balance, activity, and closing balance for a vendor over a date range."
      />
      <VendorStatementClient
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
