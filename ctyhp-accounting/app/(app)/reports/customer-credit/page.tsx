import { createSupabaseServerClient } from "@/lib/db/server";
import { listCustomerCredit, CREDIT_SALES_WINDOW_DAYS } from "@/lib/services/credit";
import { resolveActiveCompany } from "@/lib/db/company";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import CustomerCreditClient from "./CustomerCreditClient";

export const dynamic = "force-dynamic";

export default async function CustomerCreditPage() {
  const sb = await createSupabaseServerClient();
  const entity = await resolveActiveCompany();
  const rows = await listCustomerCredit(sb);

  return (
    <div>
      <PageHeader
        meta={
          <ReportEntityBadge
            companyName={entity.active?.dbaName || entity.active?.legalName || "No company selected"}
            isSample={entity.active?.isSample ?? false}
          />
        }
        title="Customer Credit Exposure"
        description="Who is on hold, who is over their limit, what is past due, and how long invoices are taking to collect."
      />
      <CustomerCreditClient rows={rows} salesWindowDays={CREDIT_SALES_WINDOW_DAYS} />
    </div>
  );
}
