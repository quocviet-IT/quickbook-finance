import WorkAreaOverview from "@/components/work-areas/WorkAreaOverview";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  getBankingOverview,
  getWorkAreaOverviewContext,
} from "@/lib/services/work-area-overviews";

export const dynamic = "force-dynamic";

export default async function BankingOverviewPage() {
  const sb = await createSupabaseServerClient();
  const context = await getWorkAreaOverviewContext(sb);
  const data = await getBankingOverview(sb, context);
  return <WorkAreaOverview data={data} />;
}
