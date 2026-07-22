import { createSupabaseServerClient } from "@/lib/db/server";
import { listBillPayments, listVendors } from "@/lib/services/payables";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import PayBillsClient from "./PayBillsClient";

export const dynamic = "force-dynamic";

export default async function PayBillsPage() {
  const sb = await createSupabaseServerClient();
  const [payments, vendors, accounts, currencies, role] = await Promise.all([
    listBillPayments(sb),
    listVendors(sb),
    listAccounts(sb),
    listCurrencies(sb),
    getUserRole(),
  ]);

  const paymentAccounts = accounts.filter(
    (a) => (a.account_type === "bank" || a.account_type === "credit_card") && a.is_posting_account && a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Pay Bills" description="Pay one or more open bills and clear Accounts Payable." />
      <PayBillsClient
        payments={payments}
        vendors={vendors}
        paymentAccounts={paymentAccounts}
        currencies={currencies}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
