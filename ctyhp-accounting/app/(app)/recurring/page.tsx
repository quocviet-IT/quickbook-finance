import PageHeader from "@/components/PageHeader";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listAccounts } from "@/lib/services/accounts";
import { listCustomers } from "@/lib/services/invoicing";
import { listVendors } from "@/lib/services/payables";
import { listTaxCodes } from "@/lib/services/reference";
import { listRecurringRuns, listRecurringTemplates } from "@/lib/services/recurring";
import RecurringClient from "./RecurringClient";

export const dynamic = "force-dynamic";

export default async function RecurringTransactionsPage() {
  const sb = await createSupabaseServerClient();
  const [templates, runs, customers, vendors, accounts, taxCodes, permission] =
    await Promise.all([
      listRecurringTemplates(sb),
      listRecurringRuns(sb),
      listCustomers(sb),
      listVendors(sb),
      listAccounts(sb),
      listTaxCodes(sb),
      sb.rpc("acc_has_permission", { p_key: "recurring.manage" }),
    ]);

  const activePostingAccounts = accounts.filter(
    (account) => account.status === "active" && account.is_posting_account,
  );

  return (
    <div>
      <PageHeader
        title="Recurring Transactions"
        description="Schedule repeat work, generate draft documents, and review anything that posts to the General Ledger."
      />
      <RecurringClient
        templates={templates}
        runs={runs}
        customers={customers.filter((customer) => customer.is_active)}
        vendors={vendors.filter((vendor) => vendor.is_active)}
        incomeAccounts={activePostingAccounts.filter(
          (account) =>
            account.account_type === "income" || account.account_type === "other_income",
        )}
        expenseAccounts={activePostingAccounts.filter(
          (account) =>
            account.account_type === "expense" ||
            account.account_type === "cost_of_goods_sold" ||
            account.account_type === "other_expense",
        )}
        paymentAccounts={activePostingAccounts.filter(
          (account) =>
            account.account_type === "bank" || account.account_type === "credit_card",
        )}
        journalAccounts={activePostingAccounts}
        taxCodes={taxCodes.filter((taxCode) => taxCode.is_active)}
        canManage={!permission.error && permission.data === true}
      />
    </div>
  );
}
