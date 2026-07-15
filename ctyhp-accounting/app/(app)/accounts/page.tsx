import { createSupabaseServerClient } from "@/lib/db/server";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies, listTaxCodes } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import AccountsClient from "./AccountsClient";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const sb = await createSupabaseServerClient();
  const [accounts, currencies, taxCodes, role] = await Promise.all([
    listAccounts(sb),
    listCurrencies(sb),
    listTaxCodes(sb),
    getUserRole(),
  ]);

  return (
    <div>
      <PageHeader
        title="Chart of Accounts"
        description="The ledger accounts used to classify transactions and produce financial statements."
      />
      <AccountsClient
        accounts={accounts}
        currencies={currencies}
        taxCodes={taxCodes}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
