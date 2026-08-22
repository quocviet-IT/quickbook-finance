import PageHeader from "@/components/PageHeader";
import { getSessionUser, getUserRole } from "@/lib/auth";
import { canWrite } from "@/lib/domain/roles";
import type { ActorRow } from "@/lib/db/types";
import { listActors } from "@/lib/services/access";
import SalesSurface from "@/components/sales-surface/SalesSurface";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSalesSurface } from "@/lib/services/sales-surface";

export const dynamic = "force-dynamic";

export default async function SalesOverviewPage() {
  const sb = await createSupabaseServerClient();
  const [data, role, viewer, actors] = await Promise.all([
    getSalesSurface(sb),
    getUserRole(),
    getSessionUser(),
    listActors(sb).catch(() => []),
  ]);
  return (
    <div>
      <PageHeader
        title="Sales overview"
        description="Who owes money, and what is being done about it."
      />
      <SalesSurface
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
