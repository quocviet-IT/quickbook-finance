import Link from "next/link";
import { getUserRole, canWrite } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import { listCurrencies } from "@/lib/services/reference";
import { RECONCILE_HISTORY } from "@/lib/domain/reconcile-history";
import PageHeader from "@/components/PageHeader";
import ReconcileHistoryClient from "./ReconcileHistoryClient";

export const dynamic = "force-dynamic";

/**
 * Reconcile history (2.03): a thin server shell. It reads who is looking, the
 * base currency and the company's today; the table and the form are the
 * client's, which reads the history through its own actions.
 */
export default async function ReconcileHistoryPage() {
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const [currencies, { asOf }] = await Promise.all([listCurrencies(sb), getBankingContext(sb)]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title={RECONCILE_HISTORY}
        description="Every bank account, with the posted lines no completed reconciliation holds. An account never reconciled can bring its history forward when the books hold exactly the statement’s balance on a date."
      />
      <p>
        <Link href="/banking/reconcile">← Bank Reconciliation</Link>
      </p>
      <ReconcileHistoryClient
        canWrite={canWrite(role)}
        today={asOf}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
