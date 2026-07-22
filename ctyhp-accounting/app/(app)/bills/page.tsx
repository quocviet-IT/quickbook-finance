import { createSupabaseServerClient } from "@/lib/db/server";
import { listBills, listVendors } from "@/lib/services/payables";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import BillsClient from "./BillsClient";

export const dynamic = "force-dynamic";

export default async function BillsPage() {
  const sb = await createSupabaseServerClient();
  const [bills, vendors, accounts, currencies, role] = await Promise.all([
    listBills(sb),
    listVendors(sb),
    listAccounts(sb),
    listCurrencies(sb),
    getUserRole(),
  ]);

  const expenseAccounts = accounts.filter(
    (a) =>
      (a.account_type === "expense" || a.account_type === "cost_of_goods_sold" || a.account_type === "other_expense") &&
      a.is_posting_account &&
      a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Bills" description="Enter bills you owe, post them to Accounts Payable, and track balances." />
      <BillsClient
        bills={bills}
        vendors={vendors}
        expenseAccounts={expenseAccounts}
        currencies={currencies}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
