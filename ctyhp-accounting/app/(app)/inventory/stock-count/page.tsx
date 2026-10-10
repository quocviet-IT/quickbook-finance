import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { canWrite, getUserRole } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listActors } from "@/lib/services/access";
import { reportPageContext } from "@/lib/services/report-context";
import { listStockCountSummaries } from "@/lib/services/stock-count";
import NewCountButton from "./NewCountButton";
import StockCountListClient, { type CountListRow } from "./StockCountListClient";

export const dynamic = "force-dynamic";

export default async function StockCountPage() {
  const sb = await createSupabaseServerClient();
  const [ctx, role, counts, actors] = await Promise.all([
    reportPageContext(sb),
    getUserRole(),
    listStockCountSummaries(sb),
    listActors(sb).catch(() => []),
  ]);
  const names = new Map(actors.map((a) => [a.id, a.full_name?.trim() || a.email]));
  const rows: CountListRow[] = counts.map((c) => ({
    ...c,
    postedByName: c.posted_by ? (names.get(c.posted_by) ?? null) : null,
  }));
  const writer = canWrite(role);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Stock Count"
        description="What stock is on hand and what it is carried at."
        actions={writer ? <NewCountButton today={ctx.today} /> : undefined}
      />
      <StockCountListClient
        rows={rows}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        today={ctx.today}
        canWrite={writer}
      />
    </div>
  );
}
