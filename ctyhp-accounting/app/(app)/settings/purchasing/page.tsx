import { createSupabaseServerClient } from "@/lib/db/server";
import { getPurchasingConfig } from "@/lib/services/purchasing";
import { getUserRole, isAdmin } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import PurchasingConfigClient from "./PurchasingConfigClient";

export const dynamic = "force-dynamic";

export default async function PurchasingSettingsPage() {
  const sb = await createSupabaseServerClient();
  const [config, role] = await Promise.all([getPurchasingConfig(sb), getUserRole()]);

  return (
    <div>
      <PageHeader
        title="Purchasing Tolerances"
        description="Configure the three-way matching tolerances applied when a purchase order becomes a bill."
      />
      <PurchasingConfigClient config={config} canEdit={isAdmin(role)} />
    </div>
  );
}
