import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin } from "@/lib/auth";
import { getCurrentCompanySettings } from "@/lib/services/company";
import PageHeader from "@/components/PageHeader";
import CompanySettingsClient from "./CompanySettingsClient";

export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const current = await getCurrentCompanySettings(sb);
  return (
    <div>
      <PageHeader title="Company Settings" description="Legal profile, fiscal year, and accounting basis. Changes are versioned." />
      <CompanySettingsClient canEdit={isAdmin(role)} current={current} />
    </div>
  );
}
