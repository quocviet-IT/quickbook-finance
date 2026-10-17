import { createSupabaseServerClient } from "@/lib/db/server";
import { resolveActiveCompany } from "@/lib/db/company";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import { beancountFileName } from "@/lib/domain/beancount";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { readBeancountSummary, type BeancountSummary } from "@/lib/services/beancount";
import BeancountClient from "./BeancountClient";

export const dynamic = "force-dynamic";

export default async function BeancountPage() {
  const sb = await createSupabaseServerClient();
  const [entity, company] = await Promise.all([resolveActiveCompany(), getCurrentCompanySettings(sb)]);

  let summary: BeancountSummary | null = null;
  let summaryError: string | null = null;
  try {
    summary = await readBeancountSummary(sb);
  } catch (e) {
    summaryError = e instanceof Error ? e.message : "The book could not be summarized.";
  }
  const permission = await sb.rpc("acc_has_permission", { p_key: "company.export" });
  const canExport = permission.error === null && permission.data === true;

  const displayName = entity.active?.dbaName || entity.active?.legalName || company?.legal_name || "Company name not set";
  // Named as the file itself will be: after the legal name in company settings.
  const fileName = beancountFileName(company?.legal_name ?? displayName);

  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={displayName} isSample={entity.active?.isSample ?? false} />}
        title="Beancount Export"
        description="Your books as a Beancount file: a plain-text ledger an outside accountant or auditor can open and check line by line."
      />
      <BeancountClient
        companyName={displayName}
        fileName={fileName}
        summary={summary}
        summaryError={summaryError}
        canExport={canExport}
      />
    </div>
  );
}
