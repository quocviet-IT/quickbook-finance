import { createSupabaseServerClient } from "@/lib/db/server";
import { listSalesReceipts } from "@/lib/services/sales-receipts";
import { listCustomers } from "@/lib/services/invoicing";
import { listAccounts } from "@/lib/services/accounts";
import { listTaxCodes, listUsStates } from "@/lib/services/reference";
import { listItems } from "@/lib/services/items";
import { companyClock } from "@/lib/services/report-context";
import { hasPermission } from "@/lib/services/access";
import { getUserRole, canWrite } from "@/lib/auth";
import { salesRevenueAccounts } from "@/lib/domain/accounts";
import { defaultDepositAccountId, depositAccountChoices } from "@/lib/domain/sales-receipts";
import PageHeader from "@/components/PageHeader";
import SalesReceiptsClient from "./SalesReceiptsClient";
import { postingDefaultsOrNone } from "@/lib/services/posting-defaults";
import { defaultIn } from "@/lib/domain/posting-defaults";

export const dynamic = "force-dynamic";

export default async function SalesReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const initialCreateOpen = (await searchParams).new === "1";
  const sb = await createSupabaseServerClient();
  const [receipts, clock, customers, accounts, taxCodes, usStates, items, role, canManageItems, postingDefaults] =
    await Promise.all([
      listSalesReceipts(sb),
      companyClock(sb),
      listCustomers(sb),
      listAccounts(sb),
      listTaxCodes(sb),
      listUsStates(sb),
      listItems(sb),
      getUserRole(),
      hasPermission(sb, "items.manage"),
      postingDefaultsOrNone(sb),
    ]);
  const depositAccounts = depositAccountChoices(accounts);
  const incomeAccounts = salesRevenueAccounts(accounts);

  return (
    <div>
      <PageHeader
        title="Sales Receipts"
        description="A sale the customer paid for on the spot. Saving it posts the sale and the money in one step; nothing goes to Accounts Receivable."
      />
      <SalesReceiptsClient
        initialCreateOpen={initialCreateOpen}
        receipts={receipts}
        today={clock.today}
        customers={customers}
        depositAccounts={depositAccounts}
        defaultDepositAccountId={
          // The company's choice first (3.01); without one, the first bank account, as before.
          defaultIn(postingDefaults.depositAccountId, depositAccounts) ?? defaultDepositAccountId(depositAccounts)
        }
        defaultIncomeAccountId={defaultIn(postingDefaults.incomeAccountId, incomeAccounts) ?? null}
        incomeAccounts={incomeAccounts}
        taxCodes={taxCodes}
        usStates={usStates}
        items={items.filter((item) => item.is_sold && item.is_active)}
        canWrite={canWrite(role)}
        canManageItems={canManageItems}
      />
    </div>
  );
}
