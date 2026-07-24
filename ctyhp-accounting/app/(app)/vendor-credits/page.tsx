import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listCurrencies } from "@/lib/services/reference";
import { listAccounts } from "@/lib/services/accounts";
import { listVendors } from "@/lib/services/payables";
import PageHeader from "@/components/PageHeader";
import VendorCreditsClient from "./VendorCreditsClient";

export const dynamic = "force-dynamic";

export default async function VendorCreditsPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, accounts, vendors, role] = await Promise.all([
    listCurrencies(sb),
    listAccounts(sb),
    listVendors(sb),
    getUserRole(),
  ]);
  const base = currencies.find((c) => c.is_base);
  const expenseAccounts = accounts.filter(
    (a) =>
      ["expense", "cost_of_goods_sold", "other_expense"].includes(a.account_type) &&
      a.is_posting_account &&
      a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Vendor Credits" description="Issue vendor credits and apply them to open bills." />
      <VendorCreditsClient
        canWrite={canWrite(role)}
        vendors={vendors}
        expenseAccounts={expenseAccounts}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
