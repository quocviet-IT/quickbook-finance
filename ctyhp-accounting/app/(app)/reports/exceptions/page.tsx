import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { postedEntryDateSpan } from "@/lib/services/exceptions";
import { resolveActiveCompany } from "@/lib/db/company";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import ExceptionsClient from "./ExceptionsClient";

export const dynamic = "force-dynamic";

export default async function ExceptionsPage() {
  const sb = await createSupabaseServerClient();
  const entity = await resolveActiveCompany();
  const [currencies, company, span] = await Promise.all([
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
    // The first and last posted entry, for "All dates" and "Last 3 years".
    postedEntryDateSpan(sb),
  ]);
  const base = currencies.find((c) => c.is_base);
  const displayName = entity.active?.dbaName || entity.active?.legalName || company?.legal_name || "Company name not set";
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={displayName} isSample={entity.active?.isSample ?? false} />}
        title="Exception Report"
        description="The questions a reviewer asks of the books, answered for you. Click any line to open the entry behind it."
      />
      <ExceptionsClient
        companyName={displayName}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
        fiscalStartMonth={company?.fiscal_year_start_month ?? 1}
        today={new Date().toISOString().slice(0, 10)}
        firstEntryDate={span.first}
        lastEntryDate={span.last}
      />
    </div>
  );
}
