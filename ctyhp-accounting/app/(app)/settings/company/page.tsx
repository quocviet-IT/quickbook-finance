import { requireSettingsAccess } from "@/lib/db/settings-access";
import { createSupabaseServerClient } from "@/lib/db/server";
import { holdsPermission } from "@/lib/auth";
import { getCurrentCompanySettings } from "@/lib/services/company";
import PageHeader from "@/components/PageHeader";
import CompanySettingsClient from "./CompanySettingsClient";

export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  await requireSettingsAccess("/settings/company");
  const sb = await createSupabaseServerClient();
  const [canEdit, current] = await Promise.all([
    holdsPermission("settings.manage"),
    getCurrentCompanySettings(sb),
  ]);
  return (
    <div>
      <PageHeader
        title="Company Settings"
        description="Legal profile, fiscal year, and accounting basis. Changes are versioned. This workspace holds one company's books — a second company needs its own workspace, so its statements can never mix with these."
      />
      <CompanySettingsClient canEdit={canEdit} current={current} />
    </div>
  );
}
