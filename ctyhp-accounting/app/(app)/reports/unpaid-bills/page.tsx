import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import OpenDocumentsReport from "@/components/reports/OpenDocumentsReport";
import { unpaidBillsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function UnpaidBillsPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Unpaid Bills"
        description="Every bill still unpaid, by vendor and due date, with how long it is past due."
      />
      <OpenDocumentsReport kind="bill" companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} today={ctx.today} load={unpaidBillsAction} />
    </div>
  );
}
