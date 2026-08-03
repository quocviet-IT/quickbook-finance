import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { getTransactionList } from "@/lib/services/reports";
import { getCurrentCompanySettings } from "@/lib/services/company";
import PageHeader from "@/components/PageHeader";
import TransactionListClient from "./TransactionListClient";

export const dynamic = "force-dynamic";

/** Default range: the month being worked on, which is what people reconcile. */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function TransactionListPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const fallback = defaultRange();
  const from = ISO_DATE.test(params.from ?? "") ? params.from! : fallback.from;
  const to = ISO_DATE.test(params.to ?? "") ? params.to! : fallback.to;

  const sb = await createSupabaseServerClient();
  const [rows, currencies, settings] = await Promise.all([
    getTransactionList(sb, from, to),
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
  ]);
  const base = currencies.find((c) => c.is_base);

  return (
    <div>
      <PageHeader
        title="Transaction List by Date"
        description="Every posted transaction in a date range, one row each, with who it was with, what it was for, and whether it has been reconciled."
        breadcrumbItems={[{ title: "Reports", href: "/reports" }, { title: "Transaction List by Date" }]}
      />
      <TransactionListClient
        rows={rows}
        from={from}
        to={to}
        companyName={settings?.legal_name ?? "This company"}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
