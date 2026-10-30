import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listBankAccounts } from "@/lib/services/banking";
import { balanceSideOf, bankAccountLabel } from "@/lib/domain/card-account";
import { chosenBankId } from "@/lib/domain/reconcile-alerts-screen";
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import { listCurrencies } from "@/lib/services/reference";
import { isServerActionRender } from "@/lib/services/request-kind";
import PageHeader from "@/components/PageHeader";
import ReconcileListClient from "./ReconcileListClient";
import { readReconcileAccount } from "./account-view";

export const dynamic = "force-dynamic";

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const params = await searchParams;
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  // A save renders the page again in its answer; the screen keeps what it has.
  const afterSave = await isServerActionRender();
  const banksRead = listBankAccounts(sb);
  const contextRead = getBankingContext(sb);
  const [banks, currencies, { asOf }, opening] = await Promise.all([
    banksRead,
    listCurrencies(sb),
    contextRead,
    // The account the screen opens on, read here rather than by the screen
    // once it has loaded (2.91), so its reconciliations are in the first HTML.
    afterSave
      ? null
      : Promise.all([banksRead, contextRead]).then(([list, context]) => {
          const id = chosenBankId(list, params.account);
          return id ? readReconcileAccount(sb, id, context.asOf) : null;
        }),
  ]);
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
        opening={opening}
      />
    </div>
  );
}
