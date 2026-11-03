import { createSupabaseServerClient } from "@/lib/db/server";
import { listBillPayments, listVendors } from "@/lib/services/payables";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import { getPayRun } from "@/lib/services/pay-run";
import { companyClock } from "@/lib/services/report-context";
import { firstPaintRead } from "@/lib/services/request-kind";
import PageHeader from "@/components/PageHeader";
import PayBillsClient from "./PayBillsClient";
import { postingDefaultsOrNone } from "@/lib/services/posting-defaults";
import { defaultIn } from "@/lib/domain/posting-defaults";

export const dynamic = "force-dynamic";

export default async function PayBillsPage() {
  const sb = await createSupabaseServerClient();
  const [payments, vendors, accounts, currencies, role, payRun, postingDefaults] = await Promise.all([
    listBillPayments(sb),
    listVendors(sb),
    listAccounts(sb),
    listCurrencies(sb),
    getUserRole(),
    // What to pay next, worked out here for the first paint (2.92) rather
    // than by the panel once the page has loaded.
    firstPaintRead(async () => getPayRun(sb, (await companyClock(sb)).today)),
    postingDefaultsOrNone(sb),
  ]);

  const paymentAccounts = accounts.filter(
    (a) => (a.account_type === "bank" || a.account_type === "credit_card") && a.is_posting_account && a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Pay Bills" description="Pay one or more open bills and clear Accounts Payable." />
      <PayBillsClient
        payments={payments}
        initialPayRun={payRun}
        vendors={vendors}
        paymentAccounts={paymentAccounts}
        defaultPayFromAccountId={defaultIn(postingDefaults.payFromAccountId, paymentAccounts) ?? null}
        currencies={currencies}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
