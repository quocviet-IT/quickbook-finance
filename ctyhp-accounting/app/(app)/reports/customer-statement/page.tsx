import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { listCustomers } from "@/lib/services/invoicing";
import PageHeader from "@/components/PageHeader";
import CustomerStatementClient from "./CustomerStatementClient";

export const dynamic = "force-dynamic";

export default async function CustomerStatementPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, customers] = await Promise.all([listCurrencies(sb), listCustomers(sb)]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Customer Statement"
        description="Opening balance, activity, and closing balance for a customer over a date range."
      />
      <CustomerStatementClient
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
