import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { resolveActiveCompany } from "@/lib/db/company";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import JournalReportClient from "./JournalReportClient";

export const dynamic = "force-dynamic";

export default async function JournalReportPage({
  searchParams,
}: {
  searchParams: Promise<{ entry?: string }>;
}) {
  const sb = await createSupabaseServerClient();
  const entity = await resolveActiveCompany();
  const filters = await searchParams;
  const currencies = await listCurrencies(sb);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        meta={
          <ReportEntityBadge
            companyName={entity.active?.dbaName || entity.active?.legalName || "No company selected"}
            isSample={entity.active?.isSample ?? false}
          />
        }
        title="Journal Report"
        description="All journal entries with their lines, filterable by date, source, and status."
      />
      <JournalReportClient
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
        initialEntryId={filters.entry}
      />
    </div>
  );
}
