import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin } from "@/lib/auth";
import { getCurrentCompanySettings } from "@/lib/services/company";
import PageHeader from "@/components/PageHeader";
import PeriodsClient from "./PeriodsClient";

export const dynamic = "force-dynamic";

export default async function PeriodsPage() {
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const current = await getCurrentCompanySettings(sb);
  return (
    <div>
      <PageHeader
        title="Accounting Periods"
        description="Generate monthly periods and close them to lock the ledger. Closed periods reject new postings and voids."
      />
      <PeriodsClient canEdit={isAdmin(role)} fiscalStartMonth={current?.fiscal_year_start_month ?? 1} />
    </div>
  );
}
