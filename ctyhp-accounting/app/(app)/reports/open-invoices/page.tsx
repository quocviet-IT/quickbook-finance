import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import OpenDocumentsReport from "@/components/reports/OpenDocumentsReport";
import { openInvoicesAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function OpenInvoicesPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Open Invoices"
        description="Every invoice still open, by customer and due date, with how long it is past due."
      />
      <OpenDocumentsReport kind="invoice" companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} today={ctx.today} load={openInvoicesAction} />
    </div>
  );
}
