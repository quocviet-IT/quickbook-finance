import { createSupabaseServerClient } from "@/lib/db/server";
import { listCustomers } from "@/lib/services/invoicing";
import { reportPageContext } from "@/lib/services/report-context";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import CustomerStatementClient from "./CustomerStatementClient";

export const dynamic = "force-dynamic";

export default async function CustomerStatementPage() {
  const sb = await createSupabaseServerClient();
  const [ctx, customers] = await Promise.all([reportPageContext(sb), listCustomers(sb)]);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Customer Statement"
        description="Opening balance, activity, and closing balance for a customer over a date range."
      />
      <CustomerStatementClient
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        companyName={ctx.companyName}
        baseCurrency={ctx.currencyCode}
        baseDecimals={ctx.decimals}
        presets={ctx.presets}
        payNote={ctx.payNote}
      />
    </div>
  );
}