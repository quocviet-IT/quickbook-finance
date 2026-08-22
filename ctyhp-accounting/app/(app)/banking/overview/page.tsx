import PageHeader from "@/components/PageHeader";
import { getSessionUser, getUserRole } from "@/lib/auth";
import { canWrite } from "@/lib/domain/roles";
import type { ActorRow } from "@/lib/db/types";
import { listActors } from "@/lib/services/access";
import BankingSurface from "@/components/banking-surface/BankingSurface";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getBankingSurface } from "@/lib/services/banking-surface";

export const dynamic = "force-dynamic";

export default async function BankingOverviewPage() {
  const sb = await createSupabaseServerClient();
  // The queue and the people who can hold it are read together: "Mine" and
  // "Assign to" are useless without both, and neither is worth a round trip of
  // its own.
  const [data, role, viewer, actors] = await Promise.all([
    getBankingSurface(sb),
    getUserRole(),
    getSessionUser(),
    listActors(sb).catch(() => []),
  ]);
  return (
    <div>
      <PageHeader
        title="Banking overview"
        description="What is unmatched, and how far each account is reconciled."
      />
      <BankingSurface
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
