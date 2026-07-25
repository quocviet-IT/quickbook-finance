import { createSupabaseServerClient } from "@/lib/db/server";
import { getDashboardAnalytics, todayInTimeZone } from "@/lib/services/dashboard";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { listCurrencies } from "@/lib/services/reference";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, company] = await Promise.all([
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
  ]);
  const timeZone = company?.time_zone ?? "America/New_York";
  const analytics = await getDashboardAnalytics(sb, todayInTimeZone(timeZone));
  const base = currencies.find((c) => c.is_base);
  return (
    <DashboardClient
      analytics={analytics}
      baseCurrency={base?.code ?? "USD"}
      baseDecimals={base?.decimal_places ?? 2}
      accountingBasis={company?.accounting_basis ?? "accrual"}
      timeZone={timeZone}
    />
  );
}
