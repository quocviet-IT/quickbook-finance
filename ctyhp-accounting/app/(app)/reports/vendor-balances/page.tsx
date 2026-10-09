import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import PartyBalancesReport from "@/components/reports/PartyBalancesReport";
import { vendorBalancesAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function VendorBalancesPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Vendor Balance Summary"
        description="What is owed to each vendor, with their credits netted, and whether the total agrees with payables."
      />
      <PartyBalancesReport kind="vendor" companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} today={ctx.today} load={vendorBalancesAction} />
    </div>
  );
}
