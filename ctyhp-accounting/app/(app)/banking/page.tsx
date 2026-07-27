import { createSupabaseServerClient } from "@/lib/db/server";
import { listBankAccounts, listBankConnections } from "@/lib/services/banking";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import { bankFeedEncryptionConfigured } from "@/lib/services/bank-token-crypto";
import { plaidConfiguration } from "@/lib/services/plaid";
import PageHeader from "@/components/PageHeader";
import BankingClient from "./BankingClient";

export const dynamic = "force-dynamic";

export default async function BankingPage() {
  const sb = await createSupabaseServerClient();
  const [bankAccounts, bankConnections, accounts, currencies, role] = await Promise.all([
    listBankAccounts(sb),
    listBankConnections(sb),
    listAccounts(sb),
    listCurrencies(sb),
    getUserRole(),
  ]);

  const linkedIds = new Set(bankAccounts.map((b) => b.account_id));
  const glBankAccounts = accounts.filter(
    (a) => a.account_type === "bank" && a.is_posting_account && a.status === "active" && !linkedIds.has(a.id),
  );
  const plaid = plaidConfiguration();

  return (
    <div>
      <PageHeader
        title="Banking"
        description="Connect bank feeds, review imported activity, and match it to the General Ledger."
      />
      <BankingClient
        bankAccounts={bankAccounts}
        bankConnections={bankConnections}
        glBankAccounts={glBankAccounts}
        currencies={currencies}
        canWrite={canWrite(role)}
        plaidConfigured={plaid.configured && bankFeedEncryptionConfigured()}
        plaidEnvironment={plaid.environment}
      />
    </div>
  );
}
