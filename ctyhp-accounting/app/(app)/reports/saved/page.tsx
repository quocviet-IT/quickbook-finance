import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { getUserRole } from "@/lib/auth";
import { resolveActiveCompany } from "@/lib/db/company";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite } from "@/lib/domain/roles";
import { listSavedReports } from "@/lib/services/saved-reports";
import SavedReportsClient from "./SavedReportsClient";

export const dynamic = "force-dynamic";

export default async function SavedReportsPage() {
  const sb = await createSupabaseServerClient();
  const [entity, role, reports] = await Promise.all([
    resolveActiveCompany(),
    getUserRole(),
    listSavedReports(sb, true),
  ]);
  return (
    <div>
      <PageHeader
        meta={
          <ReportEntityBadge
            companyName={entity.active?.dbaName || entity.active?.legalName || "No company selected"}
            isSample={entity.active?.isSample ?? false}
          />
        }
        title="Saved Reports"
        description="Reports produced outside One Book, kept as they arrived. Nothing on this page affects a balance."
      />
      <SavedReportsClient reports={reports} canManage={canWrite(role)} />
    </div>
  );
}
