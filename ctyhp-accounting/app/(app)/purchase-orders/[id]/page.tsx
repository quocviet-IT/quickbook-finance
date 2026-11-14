import { createSupabaseServerClient } from "@/lib/db/server";
import { formatDate } from "@/lib/format";
import { getPurchaseOrder, getPurchasingConfig } from "@/lib/services/purchasing";
import { listVendors } from "@/lib/services/payables";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { listItems } from "@/lib/services/items";
import { getUserRole, canWrite, holdsPermission } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import PurchaseOrderDetailClient from "./PurchaseOrderDetailClient";
import { recordMetadata } from "@/lib/domain/page-title";
import type { Metadata } from "next";
import { purchaseOrderTitle } from "@/lib/services/page-titles";

/** The tab names the record (3.0.32); see lib/services/page-titles.ts. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return recordMetadata(null, "/purchase-orders");
  const title = await purchaseOrderTitle(await createSupabaseServerClient(), id);
  return recordMetadata(title, "/purchase-orders");
}

export const dynamic = "force-dynamic";

export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `?bill=1` arrives from the New bill form, which sends people here to be matched. */
  searchParams: Promise<{ bill?: string }>;
}) {
  const { id } = await params;
  const initialBillOpen = (await searchParams).bill === "1";
  const sb = await createSupabaseServerClient();
  const [detail, config, vendors, accounts, currencies, items, role, holdsApprove, holdsVariance] =
    await Promise.all([
      getPurchaseOrder(sb, id),
      getPurchasingConfig(sb),
      listVendors(sb),
      listAccounts(sb),
      listCurrencies(sb),
      listItems(sb),
      getUserRole(),
      holdsPermission("po.approve"),
      holdsPermission("po.variance_approve"),
    ]);

  const expenseAccounts = accounts.filter(
    (a) =>
      (a.account_type === "expense" ||
        a.account_type === "cost_of_goods_sold" ||
        a.account_type === "other_expense" ||
        a.account_type === "current_asset" ||
        a.account_type === "fixed_asset") &&
      a.is_posting_account &&
      a.status === "active",
  );

  return (
    <div>
      <PageHeader
        title={`Purchase Order ${detail.order.po_number ?? "(draft)"}`}
        description={`${detail.order.vendor_name} — ordered ${formatDate(detail.order.order_date)}`}
        breadcrumbItems={[
          { title: "Purchase Orders", href: "/purchase-orders" },
          { title: detail.order.po_number ?? "Draft" },
        ]}
      />
      <PurchaseOrderDetailClient
        initialBillOpen={initialBillOpen}
        detail={detail}
        config={config}
        vendors={vendors}
        expenseAccounts={expenseAccounts}
        currencies={currencies}
        items={items.filter((i) => i.is_purchased && i.is_active)}
        canWrite={canWrite(role)}
        canApprove={canWrite(role) && holdsApprove}
        canApproveVariance={canWrite(role) && holdsVariance}
      />
    </div>
  );
}
