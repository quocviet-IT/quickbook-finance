import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { fiscalYearForDate } from "@/lib/domain/fiscal";
import { reportPageContext } from "@/lib/services/report-context";
import CloseLogClient from "./CloseLogClient";
import { closeLogAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CloseLogPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Month-End Close Log"
        description="Every close and reopen of the year's months: when, by whom, and why."
      />
      <CloseLogClient
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        fiscalYear={fiscalYearForDate(ctx.today, ctx.presets.fiscalStartMonth)}
        timeZone={ctx.timeZone}
        load={closeLogAction}
      />
    </div>
  );
}
