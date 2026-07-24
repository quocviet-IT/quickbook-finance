import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listCurrencies, listTaxCodes } from "@/lib/services/reference";
import { listAccounts } from "@/lib/services/accounts";
import { listCustomers } from "@/lib/services/invoicing";
import PageHeader from "@/components/PageHeader";
import CreditMemosClient from "./CreditMemosClient";

export const dynamic = "force-dynamic";

export default async function CreditMemosPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, accounts, customers, taxCodes, role] = await Promise.all([
    listCurrencies(sb),
    listAccounts(sb),
    listCustomers(sb),
    listTaxCodes(sb),
    getUserRole(),
  ]);
  const base = currencies.find((c) => c.is_base);
  const incomeAccounts = accounts.filter(
    (a) => a.account_type === "income" && a.is_posting_account && a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Credit Memos" description="Issue customer credit memos and apply them to open invoices." />
      <CreditMemosClient
        canWrite={canWrite(role)}
        customers={customers}
        incomeAccounts={incomeAccounts}
        taxCodes={taxCodes}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
