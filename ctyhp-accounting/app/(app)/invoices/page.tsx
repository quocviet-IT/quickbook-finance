import { createSupabaseServerClient } from "@/lib/db/server";
import { listInvoices, listCustomers } from "@/lib/services/invoicing";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies, listTaxCodes } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import InvoicesClient from "./InvoicesClient";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const sb = await createSupabaseServerClient();
  const [invoices, customers, accounts, currencies, taxCodes, role] = await Promise.all([
    listInvoices(sb),
    listCustomers(sb),
    listAccounts(sb),
    listCurrencies(sb),
    listTaxCodes(sb),
    getUserRole(),
  ]);

  const incomeAccounts = accounts.filter(
    (a) =>
      (a.account_type === "income" || a.account_type === "other_income") &&
      a.is_posting_account &&
      a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Invoices" description="Create invoices, issue them to the ledger, and track balances due." />
      <InvoicesClient
        invoices={invoices}
        customers={customers}
        incomeAccounts={incomeAccounts}
        taxCodes={taxCodes}
        currencies={currencies}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
