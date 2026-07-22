import { createSupabaseServerClient } from "@/lib/db/server";
import { listExpenses, listVendors } from "@/lib/services/payables";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ExpensesClient from "./ExpensesClient";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const sb = await createSupabaseServerClient();
  const [expenses, vendors, accounts, currencies, role] = await Promise.all([
    listExpenses(sb),
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
  const paymentAccounts = accounts.filter(
    (a) => (a.account_type === "bank" || a.account_type === "credit_card") && a.is_posting_account && a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Expenses" description="Record money already spent by bank or credit card." />
      <ExpensesClient
        expenses={expenses}
        vendors={vendors}
        expenseAccounts={expenseAccounts}
        paymentAccounts={paymentAccounts}
        currencies={currencies}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
