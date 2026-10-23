import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listBankAccounts } from "@/lib/services/banking";
import { balanceSideOf, bankAccountLabel } from "@/lib/domain/card-account";
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ReconcileListClient from "./ReconcileListClient";

export const dynamic = "force-dynamic";

export default async function ReconcilePage() {
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const [banks, currencies, { asOf }] = await Promise.all([listBankAccounts(sb), listCurrencies(sb), getBankingContext(sb)]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Bank Reconciliation"
        description="Reconcile a bank account or a credit card to its statement ending balance."
      />
      <ReconcileListClient
        canWrite={canWrite(role)}
        today={asOf}
        banks={banks.map((b) => {
          const side = balanceSideOf(b.account_type);
          return {
            id: b.id,
            label: bankAccountLabel(`${b.bank_name} · ${b.account_number_masked ?? ""}`.trim(), side),
            name: b.account_name || b.bank_name,
            side,
          };
        })}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
