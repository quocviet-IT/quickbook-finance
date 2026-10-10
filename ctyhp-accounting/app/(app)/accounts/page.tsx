import { createSupabaseServerClient } from "@/lib/db/server";
import { listAccounts } from "@/lib/services/accounts";
import { getChartBalances } from "@/lib/services/chart-balances";
import { listCurrencies, listTaxCodes } from "@/lib/services/reference";
import { companyClock } from "@/lib/services/report-context";
import { getUserRole, canWrite } from "@/lib/auth";
import AccountsClient from "./AccountsClient";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const sb = await createSupabaseServerClient();
  // The company's own day, in its time zone: at 6 p.m. in New York it is
  // already tomorrow in UTC, and the balances would run a day ahead.
  const clock = companyClock(sb);
  const [accounts, currencies, taxCodes, role, { today }, balances] = await Promise.all([
    listAccounts(sb),
    listCurrencies(sb),
    listTaxCodes(sb),
    getUserRole(),
    clock,
    // Read on its own: if it fails the list and Setup still work, and the
    // screen says the figures are unavailable rather than showing zeros.
    // Also says where the fiscal year starts, which is where profit and loss figures begin.
    clock.then(({ today }) => getChartBalances(sb, today)).then(
      (data) => data,
      (e: unknown) => {
        console.error("Chart of Accounts: balances could not be read", e);
        return null;
      },
    ),
  ]);
  const base = currencies.find((c) => c.is_base);

  return (
    <AccountsClient
      accounts={accounts}
      currencies={currencies}
      taxCodes={taxCodes}
      canWrite={canWrite(role)}
      initialAsOf={today}
      // null when the read failed. Inventory accounts then sit under Other
      // current assets, as there are no inventory account ids, until balances load.
      initialBalances={balances}
      baseCurrency={base?.code ?? "USD"}
      baseDecimals={base?.decimal_places ?? 2}
    />
  );
}
