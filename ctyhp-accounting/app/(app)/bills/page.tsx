import { createSupabaseServerClient } from "@/lib/db/server";
import { listBills, listVendors } from "@/lib/services/payables";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { listItems } from "@/lib/services/items";
import { getUserRole, canWrite } from "@/lib/auth";
import { hasPermission } from "@/lib/services/access";
import { getReceivedNotBilled, listPurchaseOrders } from "@/lib/services/purchasing";
import { billablePurchaseOrders } from "@/lib/domain/purchasing";
import { isDocumentScannerConfigured } from "@/lib/services/document-scanner";
import PageHeader from "@/components/PageHeader";
import BillsClient from "./BillsClient";

export const dynamic = "force-dynamic";

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    queue?: string;
    through?: string;
    focus?: string;
  }>;
}) {
  const params = await searchParams;
  const initialCreateOpen = params.new === "1";
  const initialQueue =
    params.queue === "due" && /^\d{4}-\d{2}-\d{2}$/.test(params.through ?? "")
      ? { dueThrough: params.through!, focusId: params.focus ?? null }
      : null;
  const sb = await createSupabaseServerClient();
  const [
    bills,
    vendors,
    accounts,
    currencies,
    items,
    role,
    fixedAssetPermission,
    canReadDocuments,
    canManageDocuments,
    canGovernDocuments,
    canManageItems,
    receivedNotBilled,
    purchaseOrders,
  ] = await Promise.all([
    listBills(sb),
    listVendors(sb),
    listAccounts(sb),
    listCurrencies(sb),
    listItems(sb),
    getUserRole(),
    sb.rpc("acc_has_permission", { p_key: "fixed_assets.manage" }),
    hasPermission(sb, "documents.read"),
    hasPermission(sb, "documents.manage"),
    hasPermission(sb, "documents.govern"),
    hasPermission(sb, "items.manage"),
    getReceivedNotBilled(sb),
    listPurchaseOrders(sb),
  ]);

  // A bill raised against a purchase order has to go through three-way matching,
  // which this form does not do. So the form offers the order and hands over to
  // the flow that does, rather than copying its lines across unchecked.
  const billableOrders = billablePurchaseOrders(receivedNotBilled, purchaseOrders);

  const billDebitAccounts = accounts.filter(
    (a) =>
      (a.account_type === "expense" ||
        a.account_type === "cost_of_goods_sold" ||
        a.account_type === "other_expense" ||
        a.account_type === "fixed_asset") &&
      a.is_posting_account &&
      a.status === "active",
  );

  const incomeAccounts = accounts.filter(
    (a) =>
      (a.account_type === "income" || a.account_type === "other_income") &&
      a.is_posting_account &&
      a.status === "active",
  );

  const purchaseItems = items.filter((i) => i.is_purchased && i.is_active);

  return (
    <div>
      <PageHeader title="Bills" description="Enter bills you owe, post them to Accounts Payable, and track balances." />
      <BillsClient
        initialCreateOpen={initialCreateOpen}
        initialQueue={initialQueue}
        bills={bills}
        vendors={vendors}
        expenseAccounts={billDebitAccounts}
        incomeAccounts={incomeAccounts}
        currencies={currencies}
        items={purchaseItems}
        billableOrders={billableOrders}
        canManageItems={canManageItems}
        canWrite={canWrite(role)}
        canRegisterAsset={!fixedAssetPermission.error && fixedAssetPermission.data === true}
        canReadDocuments={canReadDocuments}
        canManageDocuments={canManageDocuments}
        canGovernDocuments={canGovernDocuments}
        scannerConfigured={isDocumentScannerConfigured()}
      />
    </div>
  );
}
