import PageHeader from "@/components/PageHeader";
import { getSessionUser, getUserRole } from "@/lib/auth";
import { canWrite } from "@/lib/domain/roles";
import type { ActorRow } from "@/lib/db/types";
import { listActors } from "@/lib/services/access";
import InventorySurface from "@/components/inventory-surface/InventorySurface";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getInventorySurface } from "@/lib/services/inventory-surface";

export const dynamic = "force-dynamic";

export default async function InventoryOverviewPage() {
  const sb = await createSupabaseServerClient();
  const [data, role, viewer, actors] = await Promise.all([
    getInventorySurface(sb),
    getUserRole(),
    getSessionUser(),
    listActors(sb).catch(() => []),
  ]);
  return (
    <div>
      <PageHeader
        title="Inventory & assets overview"
        description="Whether stock can be sold, and whether it ties to the ledger."
      />
      <InventorySurface
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
