import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { resolveActiveCompany } from "@/lib/db/company";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import Report1099Client from "./Report1099Client";

export const dynamic = "force-dynamic";

export default async function Report1099Page() {
  const sb = await createSupabaseServerClient();
  const entity = await resolveActiveCompany();
  const base = (await listCurrencies(sb)).find((c) => c.is_base);
  // Default to the year most likely being prepared: the one just ended.
  const now = new Date();
  const defaultYear = now.getUTCMonth() < 3 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();

  return (
    <div>
      <PageHeader
        meta={
          <ReportEntityBadge
            companyName={entity.active?.dbaName || entity.active?.legalName || "No company selected"}
            isSample={entity.active?.isSample ?? false}
          />
        }
        title="1099 Review"
        description="What each vendor was paid in a tax year, whether it is reportable, and what is missing before anything can be filed."
      />
      <Report1099Client
        defaultYear={defaultYear}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
