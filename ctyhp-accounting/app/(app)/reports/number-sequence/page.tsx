import { createSupabaseServerClient } from "@/lib/db/server";
import { hasPermission } from "@/lib/services/access";
import { listSequenceCatalog } from "@/lib/services/sequence";
import { resolveActiveCompany } from "@/lib/db/company";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import NumberSequenceClient from "./NumberSequenceClient";

export const dynamic = "force-dynamic";

export default async function NumberSequencePage() {
  const sb = await createSupabaseServerClient();
  const entity = await resolveActiveCompany();
  const [catalog, canDocumentGaps] = await Promise.all([
    listSequenceCatalog(sb),
    hasPermission(sb, "settings.manage"),
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
        title="Document Number Sequence"
        description="Every number the system has issued, in order, with any that no document holds flagged as a break."
      />
      <NumberSequenceClient catalog={catalog} canDocumentGaps={canDocumentGaps} companyName={entity.active?.dbaName || entity.active?.legalName || "No company selected"} />
    </div>
  );
}
