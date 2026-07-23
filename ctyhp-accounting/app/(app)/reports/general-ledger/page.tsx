import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { listAccounts } from "@/lib/services/accounts";
import PageHeader from "@/components/PageHeader";
import GeneralLedgerClient from "./GeneralLedgerClient";

export const dynamic = "force-dynamic";

export default async function GeneralLedgerPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, accounts] = await Promise.all([listCurrencies(sb), listAccounts(sb)]);
  const base = currencies.find((c) => c.is_base);
  const postingAccounts = accounts.filter((a) => a.is_posting_account && a.status === "active");
  return (
    <div>
      <PageHeader
        title="General Ledger"
        description="Account activity with opening, per-line running balance, and closing balance."
      />
      <GeneralLedgerClient
        accounts={postingAccounts.map((a) => ({ id: a.id, account_code: a.account_code, name: a.name }))}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
