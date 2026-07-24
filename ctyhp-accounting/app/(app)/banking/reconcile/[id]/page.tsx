import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ReconcileWorkspaceClient from "./ReconcileWorkspaceClient";

export const dynamic = "force-dynamic";

export default async function ReconcileWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const [accounts, currencies] = await Promise.all([listAccounts(sb), listCurrencies(sb)]);
  const base = currencies.find((c) => c.is_base);
  const offsets = accounts.filter(
    (a) =>
      ["income", "other_income", "expense", "cost_of_goods_sold", "other_expense"].includes(a.account_type) &&
      a.is_posting_account &&
      a.status === "active",
  );
  return (
    <div>
      <PageHeader title="Reconciliation" description="Clear items until the difference is zero, then complete." />
      <ReconcileWorkspaceClient
        reconciliationId={id}
        canWrite={canWrite(role)}
        canReopen={isAdmin(role)}
        offsetAccounts={offsets.map((a) => ({ id: a.id, label: `${a.account_code} ${a.name}` }))}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
