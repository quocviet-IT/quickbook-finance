import { createSupabaseServerClient } from "@/lib/db/server";
import { getDashboardMetrics } from "@/lib/services/dashboard";
import { listCurrencies } from "@/lib/services/reference";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const sb = await createSupabaseServerClient();
  const [metrics, currencies] = await Promise.all([getDashboardMetrics(sb), listCurrencies(sb)]);
  const base = currencies.find((c) => c.is_base);
  return <DashboardClient metrics={metrics} baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2} />;
}
