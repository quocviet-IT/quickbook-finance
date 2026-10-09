import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import PurchasesInventoryClient from "./PurchasesInventoryClient";
import { purchasesInventoryAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PurchasesInventoryPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Purchases and Inventory"
        description="What was bought over the period and what is still in stock."
      />
      <PurchasesInventoryClient
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        presets={ctx.presets}
        load={purchasesInventoryAction}
      />
    </div>
  );
}
