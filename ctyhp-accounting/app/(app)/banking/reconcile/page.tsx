import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listBankAccounts } from "@/lib/services/banking";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ReconcileListClient from "./ReconcileListClient";

export const dynamic = "force-dynamic";

export default async function ReconcilePage() {
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const [banks, currencies] = await Promise.all([listBankAccounts(sb), listCurrencies(sb)]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader title="Bank Reconciliation" description="Reconcile a bank account to its statement ending balance." />
      <ReconcileListClient
        canWrite={canWrite(role)}
        banks={banks.map((b) => ({ id: b.id, label: `${b.bank_name} · ${b.account_number_masked ?? ""}`.trim() }))}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
