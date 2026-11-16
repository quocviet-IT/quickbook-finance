import { Suspense } from "react";
import NeedsAttention from "@/components/dashboard-home/NeedsAttention";
import MonthEndClose from "@/components/dashboard-home/MonthEndClose";
import { holdsPermission } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { needsByTab } from "@/lib/domain/dashboard-home/needs";
import type { HomeTab } from "@/lib/domain/dashboard-home/types";
import { pageMetadata } from "@/lib/domain/page-title";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { getDashboardHome, getHomeNeeds } from "@/lib/services/dashboard-home";
import { listCurrencies } from "@/lib/services/reference";
import { createRequestMemo } from "@/lib/services/request-memo";
import CloseSection from "./CloseSection";
import DashboardHomeClient from "./DashboardHomeClient";
import NeedsSection from "./NeedsSection";

export const metadata = pageMetadata("/dashboard");

export const dynamic = "force-dynamic";

/**
 * The Dashboard (3.0.38): four figures, four tabs, and every card settling on
 * its own. The figures are read here; Needs attention and Month-end close are
 * streamed in after them, each behind its own Suspense boundary.
 */
export default async function DashboardPage() {
  const sb = await createSupabaseServerClient();
  const [company, currencies] = await Promise.all([getCurrentCompanySettings(sb), listCurrencies(sb)]);
  const timeZone = company?.time_zone ?? "America/New_York";
  const today = todayInTimeZone(timeZone);
  const base = currencies.find((c) => c.is_base);
  const baseCurrency = { code: base?.code ?? "USD", decimals: base?.decimal_places ?? 2 };
  // One memo for the page: the figures and Needs attention then read the two aging reports once between them.
  const memo = createRequestMemo();

  // Needs attention is read once, started now and not awaited: its rows are
  // streamed into their card, and its counts into the tabs. A failed read is
  // the card's to say; the tabs then show no count.
  const fiscalStartMonth = company?.fiscal_year_start_month ?? 1;
  const needs = holdsPermission("company.export").then((backups) =>
    getHomeNeeds(sb, { asOf: today, baseCurrency, fiscalStartMonth, backups, memo }),
  );
  const counts: Promise<Record<HomeTab, number> | null> = needs.then(
    (report) => needsByTab(report.needs),
    () => null,
  );

  const home = await getDashboardHome(sb, {
    asOf: today,
    fiscalStartMonth,
    baseCurrency,
    memo,
    watchlist: [],
  });

  return (
    <DashboardHomeClient
      home={home}
      currency={baseCurrency}
      accountingBasis={company?.accounting_basis ?? "accrual"}
      timeZone={timeZone}
      counts={counts}
      needs={
        // Streamed in after the rest of the page: its checks never hold up the figures.
        <Suspense fallback={<NeedsAttention loading />}>
          <NeedsSection report={needs} />
        </Suspense>
      }
      close={
        <Suspense fallback={<MonthEndClose loading />}>
          <CloseSection asOf={today} />
        </Suspense>
      }
    />
  );
}
