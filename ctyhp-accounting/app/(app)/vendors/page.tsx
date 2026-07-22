import { createSupabaseServerClient } from "@/lib/db/server";
import { listVendors } from "@/lib/services/payables";
import { listAccounts } from "@/lib/services/accounts";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import VendorsClient from "./VendorsClient";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const sb = await createSupabaseServerClient();
  const [vendors, accounts, role] = await Promise.all([listVendors(sb), listAccounts(sb), getUserRole()]);

  const apAccounts = accounts.filter(
    (a) => a.account_type === "accounts_payable" && a.is_posting_account && a.status === "active",
  );
  const expenseAccounts = accounts.filter(
    (a) =>
      (a.account_type === "expense" || a.account_type === "cost_of_goods_sold" || a.account_type === "other_expense") &&
      a.is_posting_account &&
      a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Vendors" description="Manage the vendors you buy from and owe money to." />
      <VendorsClient
        vendors={vendors}
        apAccounts={apAccounts}
        expenseAccounts={expenseAccounts}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
