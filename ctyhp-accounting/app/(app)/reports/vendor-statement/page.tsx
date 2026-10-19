import { createSupabaseServerClient } from "@/lib/db/server";
import { listVendors } from "@/lib/services/payables";
import { reportPageContext } from "@/lib/services/report-context";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import VendorStatementClient from "./VendorStatementClient";

export const dynamic = "force-dynamic";

export default async function VendorStatementPage() {
  const sb = await createSupabaseServerClient();
  const [ctx, vendors] = await Promise.all([reportPageContext(sb), listVendors(sb)]);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Vendor Statement"
        description="Opening balance, activity, and closing balance for a vendor over a date range."
      />
      <VendorStatementClient
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        companyName={ctx.companyName}
        baseCurrency={ctx.currencyCode}
        baseDecimals={ctx.decimals}
        presets={ctx.presets}
      />
    </div>
  );
}