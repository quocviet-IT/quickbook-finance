import PageHeader from "@/components/PageHeader";
import { getUserRole, isAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { requireSettingsAccess } from "@/lib/db/settings-access";
import { getWorkPolicy } from "@/lib/services/accounting-dashboard/policy";
import { listCurrencies } from "@/lib/services/reference";
import WorkPolicyClient from "./WorkPolicyClient";

export const dynamic = "force-dynamic";

export default async function WorkPolicyPage() {
  await requireSettingsAccess("/settings/work-policy");
  const sb = await createSupabaseServerClient();
  const [policy, currencies, role] = await Promise.all([
    getWorkPolicy(sb),
    listCurrencies(sb),
    getUserRole(),
  ]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Work policy"
        description="What this company means by urgent, and by late. The accounting dashboard reads these; where one is unset, the rule that needs it says nothing."
      />
      <WorkPolicyClient
        policy={policy}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
        canManage={isAdmin(role)}
      />
    </div>
  );
}
