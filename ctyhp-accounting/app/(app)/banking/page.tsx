import { createSupabaseServerClient } from "@/lib/db/server";
import { listBankAccounts } from "@/lib/services/banking";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import BankingClient from "./BankingClient";

export const dynamic = "force-dynamic";

export default async function BankingPage() {
  const sb = await createSupabaseServerClient();
  const [bankAccounts, accounts, currencies, role] = await Promise.all([
    listBankAccounts(sb),
    listAccounts(sb),
    listCurrencies(sb),
    getUserRole(),
  ]);

  const linkedIds = new Set(bankAccounts.map((b) => b.account_id));
  const glBankAccounts = accounts.filter(
    (a) => a.account_type === "bank" && a.is_posting_account && a.status === "active" && !linkedIds.has(a.id),
  );

  return (
    <div>
      <PageHeader
        title="Banking"
        description="Import bank statements and reconcile transactions against recorded payments."
      />
      <BankingClient
        bankAccounts={bankAccounts}
        glBankAccounts={glBankAccounts}
        currencies={currencies}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
