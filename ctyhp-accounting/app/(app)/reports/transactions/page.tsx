import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { listAccounts } from "@/lib/services/accounts";
import { getTransactionList } from "@/lib/services/reports";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/format";
import { DEFAULT_TIME_ZONE } from "@/lib/domain/default-time-zone";
import { resolveActiveCompany } from "@/lib/db/company";
import { reportPageContext } from "@/lib/services/report-context";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import TransactionListClient from "./TransactionListClient";

export const dynamic = "force-dynamic";

/** Default range: the month being worked on, which is what people reconcile. */
function defaultRange(today: string): { from: string; to: string } {
  const [year, month] = today.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function TransactionListPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const sb = await createSupabaseServerClient();
  const settings = await getCurrentCompanySettings(sb);
  const fallback = defaultRange(todayInTimeZone(settings?.time_zone || DEFAULT_TIME_ZONE));
  const from = ISO_DATE.test(params.from ?? "") ? params.from! : fallback.from;
  const to = ISO_DATE.test(params.to ?? "") ? params.to! : fallback.to;

  const entity = await resolveActiveCompany();
  const [rows, currencies, accounts, context] = await Promise.all([
    getTransactionList(sb, from, to),
    listCurrencies(sb),
    // Only to label the account filter. The rows decide which accounts are
    // offered; the chart decides what each one is called.
    listAccounts(sb),
    reportPageContext(sb),
  ]);
  const base = currencies.find((c) => c.is_base);

  return (
    <div>
      <PageHeader
        meta={
          <ReportEntityBadge
            companyName={entity.active?.dbaName || entity.active?.legalName || "No company selected"}
            isSample={entity.active?.isSample ?? false}
          />
        }
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
        presets={context.presets}
        accountNames={Object.fromEntries(
          accounts.map((account) => [
            account.id,
            `${account.account_code} — ${account.name}`,
          ]),
        )}
      />
    </div>
  );
}
