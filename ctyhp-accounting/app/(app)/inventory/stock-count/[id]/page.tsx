import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { canWrite, getUserRole } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listActors } from "@/lib/services/access";
import { reportPageContext } from "@/lib/services/report-context";
import { getBookValue, getEntryNumber, getPostingContext, getStockCount } from "@/lib/services/stock-count";
import StockCountDetailClient from "../StockCountDetailClient";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StockCountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sb = await createSupabaseServerClient();
  const found = await getStockCount(sb, id);
  if (!found) notFound();
  const { count, lines } = found;
  const [ctx, role, posting, liveBookMinor, actors, entryNumber] = await Promise.all([
    reportPageContext(sb),
    getUserRole(),
    getPostingContext(sb),
    getBookValue(sb, count.as_of),
    listActors(sb).catch(() => []),
    count.journal_entry_id ? getEntryNumber(sb, count.journal_entry_id) : Promise.resolve(null),
  ]);
  const postedBy = count.posted_by ? actors.find((a) => a.id === count.posted_by) : undefined;

  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title={`Stock Count ${count.count_number}`}
        description="What stock is on hand and what it is carried at."
        breadcrumbItems={[{ title: "Stock Count", href: "/inventory/stock-count" }, { title: count.count_number }]}
      />
      <StockCountDetailClient
        count={{
          id: count.id,
          countNumber: count.count_number,
          asOf: count.as_of,
          status: count.status,
          memo: count.memo,
          journalEntryId: count.journal_entry_id,
          journalEntryNumber: entryNumber,
          approvalRequestId: count.approval_request_id,
          postedByName: postedBy ? postedBy.full_name?.trim() || postedBy.email : null,
          postedAt: count.posted_at,
          countedMinor: count.counted_minor,
          bookMinor: count.book_minor,
        }}
        lines={lines.map((l) => ({
          name: l.name,
          sku: l.sku,
          quantity: l.quantity,
          unitCostMinor: l.unit_cost_minor,
          sellsForMinor: l.sells_for_minor,
        }))}
        liveBookMinor={liveBookMinor}
        posting={posting}
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        canWrite={canWrite(role)}
        timeZone={ctx.timeZone}
      />
    </div>
  );
}
