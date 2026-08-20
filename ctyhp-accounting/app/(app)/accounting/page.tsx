import PageHeader from "@/components/PageHeader";
import AccountingDashboard from "@/components/accounting-dashboard/AccountingDashboard";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getAccountingDashboard } from "@/lib/services/accounting-dashboard";

export const dynamic = "force-dynamic";

export default async function AccountingOverviewPage() {
  const sb = await createSupabaseServerClient();
  const data = await getAccountingDashboard(sb);
  return (
    <div>
      <PageHeader
        title="Accounting operations"
        description="What needs doing, and whether the books are safe to close."
      />
      <AccountingDashboard data={data} />
    </div>
  );
}
