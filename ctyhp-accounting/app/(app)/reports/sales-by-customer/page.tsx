import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import PartyActivityReport from "@/components/reports/PartyActivityReport";
import { salesByCustomerAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SalesByCustomerPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Sales by Customer Summary"
        description="The period's income by customer, largest first, adding up to Income on the Profit and Loss."
      />
      <PartyActivityReport kind="sales" companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} presets={ctx.presets} load={salesByCustomerAction} />
    </div>
  );
}
