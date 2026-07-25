import { createSupabaseServerClient } from "@/lib/db/server";
import { listPurchaseOrders } from "@/lib/services/purchasing";
import { listVendors } from "@/lib/services/payables";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { listItems } from "@/lib/services/items";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import PurchaseOrdersClient from "./PurchaseOrdersClient";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage() {
  const sb = await createSupabaseServerClient();
  const [orders, vendors, accounts, currencies, items, role] = await Promise.all([
    listPurchaseOrders(sb),
    listVendors(sb),
    listAccounts(sb),
    listCurrencies(sb),
    listItems(sb),
    getUserRole(),
  ]);

  const expenseAccounts = accounts.filter(
    (a) =>
      (a.account_type === "expense" ||
        a.account_type === "cost_of_goods_sold" ||
        a.account_type === "other_expense" ||
        a.account_type === "current_asset" ||
        a.account_type === "fixed_asset") &&
      a.is_posting_account &&
      a.status === "active",
  );

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        description="Commit to a vendor, receive against the order, and convert what arrived into a bill. A purchase order itself posts nothing to the ledger."
      />
      <PurchaseOrdersClient
        orders={orders}
        vendors={vendors}
        expenseAccounts={expenseAccounts}
        currencies={currencies}
        items={items.filter((i) => i.is_purchased && i.is_active)}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
