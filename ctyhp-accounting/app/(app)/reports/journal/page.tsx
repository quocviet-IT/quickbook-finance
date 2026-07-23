import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import JournalReportClient from "./JournalReportClient";

export const dynamic = "force-dynamic";

export default async function JournalReportPage() {
  const sb = await createSupabaseServerClient();
  const currencies = await listCurrencies(sb);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Journal Report"
        description="All journal entries with their lines, filterable by date, source, and status."
      />
      <JournalReportClient baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2} />
    </div>
  );
}
