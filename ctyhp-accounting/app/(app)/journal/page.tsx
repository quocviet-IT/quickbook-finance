import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listCurrencies } from "@/lib/services/reference";
import { listAccounts } from "@/lib/services/accounts";
import PageHeader from "@/components/PageHeader";
import JournalClient from "./JournalClient";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
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
      <PageHeader title="Journal Entries" description="Create balanced manual journals and correct posted entries with linked reversals." />
      <JournalClient
        canWrite={canWrite(role)}
        accounts={postingAccounts.map((a) => ({ id: a.id, account_code: a.account_code, name: a.name }))}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
