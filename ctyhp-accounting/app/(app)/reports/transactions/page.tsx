import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { listAccounts } from "@/lib/services/accounts";
import { getTransactionList } from "@/lib/services/reports";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/format";
import { DEFAULT_TIME_ZONE } from "@/lib/domain/default-time-zone";
import { presetRange } from "@/lib/domain/report-presets";
import { resolveActiveCompany } from "@/lib/db/company";
import { reportPageContext } from "@/lib/services/report-context";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import TransactionListClient from "./TransactionListClient";

export const dynamic = "force-dynamic";

/**
 * Default range: the month being worked on, which is what people reconcile —
 * read as "This month" reads on every other report, the first of the month to
 * today. It used to run to the month's last day, so the Period picker could
 * not name it and opened on Custom.
 */
function defaultRange(today: string, fiscalStartMonth: number) {
  return presetRange("month", { today, fiscalStartMonth, firstEntryDate: null, lastEntryDate: null });
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
  const fallback = defaultRange(todayInTimeZone(settings?.time_zone || DEFAULT_TIME_ZONE), settings?.fiscal_year_start_month ?? 1);
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
