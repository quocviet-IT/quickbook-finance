import { createSupabaseServerClient } from "@/lib/db/server";
import { listItems } from "@/lib/services/items";
import { listAccounts } from "@/lib/services/accounts";
import { salesRevenueAccounts } from "@/lib/domain/accounts";
import { listTaxCodes } from "@/lib/services/reference";
import { getInventoryValuation } from "@/lib/services/inventory";
import { getUserRole, canWrite } from "@/lib/auth";
import { hasPermission } from "@/lib/services/access";
import PageHeader from "@/components/PageHeader";
import ItemsClient from "./ItemsClient";

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  const sb = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const [items, accounts, taxCodes, valuation, role, canManageItems] = await Promise.all([
    listItems(sb),
    listAccounts(sb),
    listTaxCodes(sb),
    getInventoryValuation(sb, today),
    getUserRole(),
    hasPermission(sb, "items.manage"),
  ]);

  // An item's income account is what its invoice lines default to.
  const incomeAccounts = salesRevenueAccounts(accounts);
  const expenseAccounts = accounts.filter(
    (a) =>
      (a.account_type === "expense" || a.account_type === "cost_of_goods_sold" || a.account_type === "other_expense") &&
      a.is_posting_account &&
      a.status === "active",
  );

  const inventoryAccounts = accounts.filter(
    (a) => a.account_type === "current_asset" && a.is_posting_account && a.status === "active",
  );
  const cogsAccounts = accounts.filter(
    (a) => a.account_type === "cost_of_goods_sold" && a.is_posting_account && a.status === "active",
  );
  // Where a write-off, shrinkage, or found-stock adjustment lands.
  const adjustmentAccounts = accounts.filter(
    (a) =>
      ["expense", "cost_of_goods_sold", "other_expense", "income", "other_income"].includes(a.account_type) &&
      a.is_posting_account &&
      a.status === "active",
  );

  return (
    <div>
      <PageHeader
        title="Products & Services"
        description="Reusable items that prefill invoice and bill lines. Tracked items also carry quantity on hand and a weighted-average value."
      />
      <ItemsClient
        items={items}
        incomeAccounts={incomeAccounts}
        expenseAccounts={expenseAccounts}
        inventoryAccounts={inventoryAccounts}
        cogsAccounts={cogsAccounts}
        adjustmentAccounts={adjustmentAccounts}
        taxCodes={taxCodes}
        onHand={valuation.rows}
        canManageItems={canManageItems}
        canAdjustInventory={canWrite(role)}
      />
    </div>
  );
}
