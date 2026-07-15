import { createSupabaseServerClient } from "@/lib/db/server";
import { listPayments, listCustomers } from "@/lib/services/invoicing";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import PaymentsClient from "./PaymentsClient";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const sb = await createSupabaseServerClient();
  const [payments, customers, accounts, currencies, role] = await Promise.all([
    listPayments(sb),
    listCustomers(sb),
    listAccounts(sb),
    listCurrencies(sb),
    getUserRole(),
  ]);

  const depositAccounts = accounts.filter(
    (a) => (a.account_type === "bank" || a.account_code === "1210") && a.is_posting_account && a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Payments" description="Record customer payments and apply them to open invoices." />
      <PaymentsClient
        payments={payments}
        customers={customers}
        depositAccounts={depositAccounts}
        currencies={currencies}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
