import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { isRealIsoDate } from "@/lib/domain/balance-comparison";
import { loadBalanceComparison, type BalanceComparisonData } from "@/lib/services/balance-comparison";
import { reportPageContext } from "@/lib/services/report-context";
import BalanceComparisonClient from "./BalanceComparisonClient";

export const dynamic = "force-dynamic";

export default async function BalanceComparisonPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const params = await searchParams;
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  const asOf = params.asOf && isRealIsoDate(params.asOf) ? params.asOf : ctx.today;
  const role = await getUserRole();

  let data: BalanceComparisonData | null = null;
  let loadError: string | null = null;
  try {
    data = await loadBalanceComparison(sb, asOf);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "The balances could not be read.";
  }

  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Balance Comparison"
        description="OneBook’s balance for every account beside the figures from another system, kept by date."
      />
      <BalanceComparisonClient
        key={asOf}
        asOf={asOf}
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        canSave={canWrite(role)}
        data={data}
        loadError={loadError}
      />
    </div>
  );
}
