import { createSupabaseServerClient } from "@/lib/db/server";
import { listAccounts } from "@/lib/services/accounts";
import { getChartBalances } from "@/lib/services/chart-balances";
import { listCurrencies, listTaxCodes } from "@/lib/services/reference";
import { companyClock } from "@/lib/services/report-context";
import { getUserRole, canWrite } from "@/lib/auth";
import { chartViewOf } from "@/lib/domain/chart-list";
import AccountsClient from "./AccountsClient";

export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [params, sb] = await Promise.all([searchParams, createSupabaseServerClient()]);
  // The company's own day, in its time zone: at 6 p.m. in New York it is
  // already tomorrow in UTC, and the balances would run a day ahead.
  const clock = companyClock(sb);
  const [accounts, currencies, taxCodes, role, balances] = await Promise.all([
    listAccounts(sb),
    listCurrencies(sb),
    listTaxCodes(sb),
    getUserRole(),
    // Also says where the fiscal year starts, which is where profit and loss figures begin.
    clock.then(({ today }) => getChartBalances(sb, today)),
  ]);
  const base = currencies.find((c) => c.is_base);

  return (
    <AccountsClient
      accounts={accounts}
      currencies={currencies}
      taxCodes={taxCodes}
      canWrite={canWrite(role)}
      initialView={chartViewOf(params.view)}
      initialBalances={balances}
      baseCurrency={base?.code ?? "USD"}
      baseDecimals={base?.decimal_places ?? 2}
    />
  );
}
