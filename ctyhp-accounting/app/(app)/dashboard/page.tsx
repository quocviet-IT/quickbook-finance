import { createSupabaseServerClient } from "@/lib/db/server";
import { getDashboardAnalytics, todayInTimeZone } from "@/lib/services/dashboard";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { listCurrencies } from "@/lib/services/reference";
import { Suspense } from "react";
import NeedsAttention from "@/components/dashboard/NeedsAttention";
import DashboardClient from "./DashboardClient";
import NeedsSection from "./NeedsSection";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const sb = await createSupabaseServerClient();
  const company = await getCurrentCompanySettings(sb);
  const timeZone = company?.time_zone ?? "America/New_York";
  const today = todayInTimeZone(timeZone);
  const [currencies, analytics] = await Promise.all([
    listCurrencies(sb),
    getDashboardAnalytics(sb, today),
  ]);
  const base = currencies.find((c) => c.is_base);
  return (
    <DashboardClient
      analytics={analytics}
      baseCurrency={base?.code ?? "USD"}
      baseDecimals={base?.decimal_places ?? 2}
      accountingBasis={company?.accounting_basis ?? "accrual"}
      timeZone={timeZone}
      needs={
        // Streamed in after the rest of the page: its checks never hold up the figures.
        <Suspense fallback={<NeedsAttention loading />}>
          <NeedsSection today={today} currencyCode={base?.code ?? "USD"} decimals={base?.decimal_places ?? 2} />
        </Suspense>
      }
    />
  );
}
