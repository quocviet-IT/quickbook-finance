import { createSupabaseServerClient } from "@/lib/db/server";
import { listEstimates } from "@/lib/services/estimates";
import { listCustomers } from "@/lib/services/invoicing";
import { listAccounts } from "@/lib/services/accounts";
import { listTaxCodes, listUsStates } from "@/lib/services/reference";
import { listItems } from "@/lib/services/items";
import { companyClock } from "@/lib/services/report-context";
import { hasPermission } from "@/lib/services/access";
import { getUserRole, canWrite } from "@/lib/auth";
import { salesRevenueAccounts } from "@/lib/domain/accounts";
import { estimateStateOf } from "@/lib/domain/estimates";
import PageHeader from "@/components/PageHeader";
import EstimatesClient from "./EstimatesClient";
import type { EstimateListEntry } from "./actions";

export const dynamic = "force-dynamic";

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const initialCreateOpen = (await searchParams).new === "1";
  const sb = await createSupabaseServerClient();
  const [rows, clock, customers, accounts, taxCodes, usStates, items, role, canManageItems] =
    await Promise.all([
      listEstimates(sb),
      companyClock(sb),
      listCustomers(sb),
      listAccounts(sb),
      listTaxCodes(sb),
      listUsStates(sb),
      listItems(sb),
      getUserRole(),
      hasPermission(sb, "items.manage"),
    ]);

  // Every state is worked out for the company's today, in its own time zone,
  // once, here: the list, the pills and the form all read the same day.
  const estimates: EstimateListEntry[] = rows.map((row) => ({
    ...row,
    state: estimateStateOf(row, clock.today),
  }));

  return (
    <div>
      <PageHeader
        title="Estimates"
        description="An estimate is a price promised to a customer. It is not in the books: nothing posts until the invoice made from it is issued."
      />
      <EstimatesClient
        initialCreateOpen={initialCreateOpen}
        estimates={estimates}
        today={clock.today}
        customers={customers}
        incomeAccounts={salesRevenueAccounts(accounts)}
        taxCodes={taxCodes}
        usStates={usStates}
        items={items.filter((item) => item.is_sold && item.is_active)}
        canWrite={canWrite(role)}
        canManageItems={canManageItems}
      />
    </div>
  );
}
