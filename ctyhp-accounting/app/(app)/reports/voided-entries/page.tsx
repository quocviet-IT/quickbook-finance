import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { hasPermission } from "@/lib/services/access";
import { reportPageContext } from "@/lib/services/report-context";
import VoidedEntriesClient from "./VoidedEntriesClient";
import { voidedEntriesAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function VoidedEntriesPage() {
  const sb = await createSupabaseServerClient();
  const [ctx, canReadAudit] = await Promise.all([reportPageContext(sb), hasPermission(sb, "audit.read")]);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Voided and Reversed Entries"
        description="Every entry voided or reversed in a period. OneBook never deletes a posted entry, so nothing is lost."
      />
      <VoidedEntriesClient
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        presets={ctx.presets}
        timeZone={ctx.timeZone}
        canReadAudit={canReadAudit}
        load={voidedEntriesAction}
      />
    </div>
  );
}
