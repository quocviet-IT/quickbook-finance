import { createSupabaseServerClient } from "@/lib/db/server";
import { resolveActiveCompany } from "@/lib/db/company";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import { readBeancountSummary, type BeancountSummary } from "@/lib/services/beancount";
import BeancountClient from "./BeancountClient";

export const dynamic = "force-dynamic";

export default async function BeancountPage() {
  const sb = await createSupabaseServerClient();
  const entity = await resolveActiveCompany();

  let summary: BeancountSummary | null = null;
  let summaryError: string | null = null;
  try {
    summary = await readBeancountSummary(sb);
  } catch (e) {
    summaryError = e instanceof Error ? e.message : "The book could not be summarised.";
  }
  const permission = await sb.rpc("acc_has_permission", { p_key: "company.export" });
  const canExport = permission.error === null && permission.data === true;

  return (
    <div>
      <PageHeader
        meta={
          <ReportEntityBadge
            companyName={entity.active?.dbaName || entity.active?.legalName || "No company selected"}
            isSample={entity.active?.isSample ?? false}
          />
        }
        title="Beancount Export"
        description="The whole ledger as a Beancount v3 file, for bean-check and Fava. Nothing here changes a figure."
      />
      <BeancountClient summary={summary} summaryError={summaryError} canExport={canExport} />
    </div>
  );
}
