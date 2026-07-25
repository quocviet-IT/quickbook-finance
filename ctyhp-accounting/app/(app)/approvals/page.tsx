import { createSupabaseServerClient } from "@/lib/db/server";
import { listApprovalPolicies, listApprovalRequests } from "@/lib/services/access";
import { listCurrencies } from "@/lib/services/reference";
import { getSessionUser, getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ApprovalsClient from "./ApprovalsClient";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const sb = await createSupabaseServerClient();
  const [requests, policies, currencies, role, user] = await Promise.all([
    listApprovalRequests(sb),
    listApprovalPolicies(sb),
    listCurrencies(sb),
    getUserRole(),
    getSessionUser(),
  ]);
  const base = currencies.find((c) => c.is_base);

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Controlled actions waiting for a second pair of eyes. Approving performs the action."
      />
      <ApprovalsClient
        pending={requests.filter((r) => r.status === "pending")}
        history={requests.filter((r) => r.status !== "pending")}
        policies={policies}
        currentUserId={user?.id ?? ""}
        canDecideRequests={canWrite(role)}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
