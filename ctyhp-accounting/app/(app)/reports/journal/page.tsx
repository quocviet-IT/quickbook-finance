import { createSupabaseServerClient } from "@/lib/db/server";
import { reportPageContext } from "@/lib/services/report-context";
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
  const filters = await searchParams;
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Journal Report"
        description="All journal entries with their lines, filterable by date, source, and status."
      />
      <JournalReportClient
        companyName={ctx.companyName}
        presets={ctx.presets}
        baseCurrency={ctx.currencyCode}
        baseDecimals={ctx.decimals}
        initialEntryId={filters.entry}
      />
    </div>
  );
}
