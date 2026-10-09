import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import PartyBalancesReport from "@/components/reports/PartyBalancesReport";
import { customerBalancesAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CustomerBalancesPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Customer Balance Summary"
        description="What each customer owes, with their credits netted, and whether the total agrees with receivables."
      />
      <PartyBalancesReport kind="customer" companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} today={ctx.today} load={customerBalancesAction} />
    </div>
  );
}
