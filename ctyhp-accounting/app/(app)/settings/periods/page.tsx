import { requireSettingsAccess } from "@/lib/db/settings-access";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole, holdsPermission, isAdmin } from "@/lib/auth";
import { getCurrentCompanySettings } from "@/lib/services/company";
import PageHeader from "@/components/PageHeader";
import PeriodsClient from "./PeriodsClient";

export const dynamic = "force-dynamic";

export default async function PeriodsPage() {
  await requireSettingsAccess("/settings/periods");
  const sb = await createSupabaseServerClient();
  const [role, current, holdsSettings, holdsClose, holdsReopen] = await Promise.all([
    getUserRole(),
    getCurrentCompanySettings(sb),
    holdsPermission("settings.manage"),
    holdsPermission("period.close"),
    holdsPermission("period.reopen"),
  ]);
  return (
    <div>
      <PageHeader
        title="Accounting Periods"
        description="Generate monthly periods and close them to lock the ledger. Closed periods reject new postings and voids."
      />
      <PeriodsClient
        canGenerate={holdsSettings}
        canClose={canWrite(role) && holdsClose}
        canReopen={isAdmin(role) && holdsReopen}
        fiscalStartMonth={current?.fiscal_year_start_month ?? 1}
      />
    </div>
  );
}
