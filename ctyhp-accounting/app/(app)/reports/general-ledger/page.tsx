import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import GeneralLedgerClient from "./GeneralLedgerClient";

export const dynamic = "force-dynamic";

export default async function GeneralLedgerPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, accountsRes] = await Promise.all([
    listCurrencies(sb),
    sb
      .from("acc_account")
      .select("id,account_code,name,is_posting_account,status")
      .eq("is_posting_account", true)
      .order("account_code"),
  ]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="General Ledger"
        description="Account activity with opening, per-line running balance, and closing balance."
      />
      <GeneralLedgerClient
        accounts={(accountsRes.data ?? []) as { id: string; account_code: string; name: string }[]}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
