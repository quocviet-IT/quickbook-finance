import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listCurrencies } from "@/lib/services/reference";
import { listAccounts } from "@/lib/services/accounts";
import PageHeader from "@/components/PageHeader";
import OpeningBalancesClient from "./OpeningBalancesClient";

export const dynamic = "force-dynamic";

export default async function OpeningBalancesPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, accounts, role] = await Promise.all([
    listCurrencies(sb),
    listAccounts(sb),
    getUserRole(),
  ]);
  const base = currencies.find((c) => c.is_base);
  const postingAccounts = accounts.filter((a) => a.is_posting_account && a.status === "active");
  return (
    <div>
      <PageHeader
        title="Opening Balances"
        description="Seed account balances as of a cutover date; the difference books to Opening Balance Equity. The batch must balance before it posts."
      />
      <OpeningBalancesClient
        canWrite={canWrite(role)}
        accounts={postingAccounts.map((a) => ({ id: a.id, account_code: a.account_code, name: a.name }))}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
