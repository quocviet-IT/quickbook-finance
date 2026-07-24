import { createSupabaseServerClient } from "@/lib/db/server";
import { listInvoices, listCustomers } from "@/lib/services/invoicing";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies, listTaxCodes } from "@/lib/services/reference";
import { listItems } from "@/lib/services/items";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import InvoicesClient from "./InvoicesClient";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const sb = await createSupabaseServerClient();
  const [invoices, customers, accounts, currencies, taxCodes, items, role] = await Promise.all([
    listInvoices(sb),
    listCustomers(sb),
    listAccounts(sb),
    listCurrencies(sb),
    listTaxCodes(sb),
    listItems(sb),
    getUserRole(),
  ]);

  const incomeAccounts = accounts.filter(
    (a) =>
      (a.account_type === "income" || a.account_type === "other_income") &&
      a.is_posting_account &&
      a.status === "active",
  );

  const expenseAccounts = accounts.filter(
    (a) =>
      (a.account_type === "expense" || a.account_type === "cost_of_goods_sold" || a.account_type === "other_expense") &&
      a.is_posting_account &&
      a.status === "active",
  );

  const salesItems = items.filter((i) => i.is_sold && i.is_active);

  return (
    <div>
      <PageHeader title="Invoices" description="Create invoices, issue them to the ledger, and track balances due." />
      <InvoicesClient
        invoices={invoices}
        customers={customers}
        incomeAccounts={incomeAccounts}
        expenseAccounts={expenseAccounts}
        taxCodes={taxCodes}
        currencies={currencies}
        items={salesItems}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
