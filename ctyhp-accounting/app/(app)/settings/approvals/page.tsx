import { requireSettingsAccess } from "@/lib/db/settings-access";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getApproverCount, listApprovalPolicies } from "@/lib/services/access";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, isAdmin } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ApprovalPoliciesClient from "./ApprovalPoliciesClient";

export const dynamic = "force-dynamic";

export default async function ApprovalPoliciesPage() {
  await requireSettingsAccess("/settings/approvals");
  const sb = await createSupabaseServerClient();
  const [policies, currencies, approverCount, role] = await Promise.all([
    listApprovalPolicies(sb),
    listCurrencies(sb),
    getApproverCount(sb),
    getUserRole(),
  ]);
  const base = currencies.find((c) => c.is_base);

  return (
    <div>
      <PageHeader
        title="Approval Policies"
        description="Which actions need a second person, above what amount, and whether the requester may approve their own."
      />
      <ApprovalPoliciesClient
        policies={policies}
        approverCount={approverCount}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
        canManage={isAdmin(role)}
      />
    </div>
  );
}
