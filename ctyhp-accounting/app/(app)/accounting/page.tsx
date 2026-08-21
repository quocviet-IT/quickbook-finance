import PageHeader from "@/components/PageHeader";
import { getSessionUser, getUserRole } from "@/lib/auth";
import { canWrite } from "@/lib/domain/roles";
import type { ActorRow } from "@/lib/db/types";
import { listActors } from "@/lib/services/access";
import AccountingDashboard from "@/components/accounting-dashboard/AccountingDashboard";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getAccountingDashboard } from "@/lib/services/accounting-dashboard";

export const dynamic = "force-dynamic";

/**
 * The mode lives in the URL so it can be linked, bookmarked and shared — "the
 * close is stuck on this" is a link somebody can send. Anything other than
 * `close` is daily, which is the right default for an unrecognised value.
 */
export default async function AccountingOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const mode = (await searchParams).mode === "close" ? "close" : "daily";
  const sb = await createSupabaseServerClient();
  // The queue and the people who can hold it are read together: "Mine" and
  // "Assign to" are useless without both, and neither is worth a round trip
  // of its own.
  const [data, role, viewer, actors] = await Promise.all([
    getAccountingDashboard(sb, mode),
    getUserRole(),
    getSessionUser(),
    listActors(sb).catch(() => []),
  ]);
  return (
    <div>
      <PageHeader
        title="Accounting operations"
        description="What needs doing, and whether the books are safe to close."
      />
      <AccountingDashboard
        data={data}
        viewerId={viewer?.id ?? null}
        canManage={canWrite(role)}
        canClose={role === "admin"}
        assignees={actors.map((actor: ActorRow) => ({
          id: actor.id,
          name: actor.full_name?.trim() || actor.email,
        }))}
      />
    </div>
  );
}
