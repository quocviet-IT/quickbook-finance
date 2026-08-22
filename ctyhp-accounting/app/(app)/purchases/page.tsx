import PageHeader from "@/components/PageHeader";
import { getSessionUser, getUserRole } from "@/lib/auth";
import { canWrite } from "@/lib/domain/roles";
import type { ActorRow } from "@/lib/db/types";
import { listActors } from "@/lib/services/access";
import PurchasesSurface from "@/components/purchases-surface/PurchasesSurface";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getPurchasesSurface } from "@/lib/services/purchases-surface";

export const dynamic = "force-dynamic";

export default async function PurchasesOverviewPage() {
  const sb = await createSupabaseServerClient();
  const [data, role, viewer, actors] = await Promise.all([
    getPurchasesSurface(sb),
    getUserRole(),
    getSessionUser(),
    listActors(sb).catch(() => []),
  ]);
  return (
    <div>
      <PageHeader
        title="Purchases overview"
        description="What must be paid, what has arrived, and what does not add up."
      />
      <PurchasesSurface
        data={data}
        viewerId={viewer?.id ?? null}
        canManage={canWrite(role)}
        assignees={actors.map((actor: ActorRow) => ({
          id: actor.id,
          name: actor.full_name?.trim() || actor.email,
        }))}
      />
    </div>
  );
}
