import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { hasPermission } from "@/lib/services/access";
import PageHeader from "@/components/PageHeader";
import ReportsHub from "@/components/reports/ReportsHub";
import { isInternalReportId } from "@/lib/domain/report-catalog";
import ReportsClient from "./ReportsClient";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedReport = Array.isArray(params.report) ? params.report[0] : params.report;

  if (!isInternalReportId(requestedReport)) {
    return (
      <div>
        <PageHeader
          title="Report Center"
          description="Find financial, customer, vendor, accounting, inventory, and tax reports."
        />
        <ReportsHub />
      </div>
    );
  }

  const sb = await createSupabaseServerClient();
  const [currencies, company, canManageBudget] = await Promise.all([
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
    hasPermission(sb, "budget.manage"),
  ]);
  const base = currencies.find((c) => c.is_base);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Run, compare, drill down, and export financial statements."
        actions={
          <Link href="/reports" className="report-center-back-link">
            Back to Report Center
          </Link>
        }
      />
      <ReportsClient
        key={requestedReport}
        initialReportType={requestedReport}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
        // A report header names the business, not the software. If settings are
        // missing, say so rather than printing the product name as the company.
        companyName={company?.legal_name ?? "Company name not set"}
        fiscalStartMonth={company?.fiscal_year_start_month ?? 1}
        canManageBudget={canManageBudget}
      />
    </div>
  );
}
