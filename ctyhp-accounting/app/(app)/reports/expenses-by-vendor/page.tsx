import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import PartyActivityReport from "@/components/reports/PartyActivityReport";
import { expensesByVendorAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ExpensesByVendorPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Expenses by Vendor Summary"
        description="The period's spending by vendor, largest first, adding up to cost of sales, expenses and other expenses on the Profit and Loss."
      />
      <PartyActivityReport kind="expenses" companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} presets={ctx.presets} load={expensesByVendorAction} />
    </div>
  );
}
