import { createSupabaseServerClient } from "@/lib/db/server";
import { listItems } from "@/lib/services/items";
import { listAccounts } from "@/lib/services/accounts";
import { listTaxCodes } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ItemsClient from "./ItemsClient";

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  const sb = await createSupabaseServerClient();
  const [items, accounts, taxCodes, role] = await Promise.all([
    listItems(sb),
    listAccounts(sb),
    listTaxCodes(sb),
    getUserRole(),
  ]);

  const incomeAccounts = accounts.filter(
    (a) => (a.account_type === "income" || a.account_type === "other_income") && a.is_posting_account && a.status === "active",
  );
  const expenseAccounts = accounts.filter(
    (a) =>
      (a.account_type === "expense" || a.account_type === "cost_of_goods_sold" || a.account_type === "other_expense") &&
      a.is_posting_account &&
      a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Products & Services" description="Reusable items that prefill invoice and bill lines." />
      <ItemsClient
        items={items}
        incomeAccounts={incomeAccounts}
        expenseAccounts={expenseAccounts}
        taxCodes={taxCodes}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
