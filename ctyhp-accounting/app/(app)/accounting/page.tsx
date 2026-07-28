import WorkAreaOverview from "@/components/work-areas/WorkAreaOverview";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  getAccountingOverview,
  getWorkAreaOverviewContext,
} from "@/lib/services/work-area-overviews";

export const dynamic = "force-dynamic";

export default async function AccountingOverviewPage() {
  const sb = await createSupabaseServerClient();
  const context = await getWorkAreaOverviewContext(sb);
  const data = await getAccountingOverview(sb, context);
  return <WorkAreaOverview data={data} />;
}
