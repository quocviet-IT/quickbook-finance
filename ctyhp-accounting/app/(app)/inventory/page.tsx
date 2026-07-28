import WorkAreaOverview from "@/components/work-areas/WorkAreaOverview";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  getInventoryOverview,
  getWorkAreaOverviewContext,
} from "@/lib/services/work-area-overviews";

export const dynamic = "force-dynamic";

export default async function InventoryOverviewPage() {
  const sb = await createSupabaseServerClient();
  const context = await getWorkAreaOverviewContext(sb);
  const data = await getInventoryOverview(sb, context);
  return <WorkAreaOverview data={data} />;
}
