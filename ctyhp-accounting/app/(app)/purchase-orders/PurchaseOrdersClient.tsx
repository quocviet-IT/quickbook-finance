"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Select, Space, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import type { AccountRow, CurrencyRow, ItemRow, PoStatus, VendorRow } from "@/lib/db/types";
import type { PurchaseOrderWithVendor } from "@/lib/services/purchasing";
import PurchaseOrderFormModal from "./PurchaseOrderFormModal";

const STATUS_COLOR: Record<PoStatus, string> = {
  draft: "default",
  open: "blue",
  partial: "gold",
  received: "green",
  closed: "purple",
  cancelled: "red",
};

const STATUS_OPTIONS: { value: PoStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "partial", label: "Partially received" },
  { value: "received", label: "Fully received" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
];

export default function PurchaseOrdersClient({
  initialCreateOpen,
  orders,
  vendors,
  expenseAccounts,
  currencies,
  items,
  canWrite,
}: {
  /** Seeded by the top-bar New menu via `?new=1`. */
  initialCreateOpen: boolean;
  orders: PurchaseOrderWithVendor[];
  vendors: VendorRow[];
  expenseAccounts: AccountRow[];
  currencies: CurrencyRow[];
  items: ItemRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<PoStatus | "all">("all");
  const [formOpen, setFormOpen] = useState(initialCreateOpen);

  const rows = useMemo(
    () => (status === "all" ? orders : orders.filter((o) => o.status === status)),
    [orders, status],
  );

  function fmt(minor: number, code: string): string {
    const d = currencies.find((c) => c.code === code)?.decimal_places ?? 2;
    return `${(minor / 10 ** d).toFixed(d)} ${code}`;
  }

  return (
    <>
      <FilterBar
        resultCount={rows.length}
        actions={
          canWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setFormOpen(true)}>
              New purchase order
            </Button>
          ) : null
        }
      >
        <Select
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
          style={{ width: 200 }}
          aria-label="Filter by status"
        />
      </FilterBar>

      <DataTable<PurchaseOrderWithVendor>
        rowKey="id"
        dataSource={rows}
        emptyTitle="No purchase orders yet"
        emptyDescription="Raise a purchase order to commit to a vendor before the goods and the bill arrive."
        columns={[
          {
            title: "PO Number",
            dataIndex: "po_number",
            render: (v: string | null, r) => <Link href={`/purchase-orders/${r.id}`}>{v ?? "(draft)"}</Link>,
          },
          { title: "Vendor", dataIndex: "vendor_name" },
          { title: "Order Date", dataIndex: "order_date" },
          { title: "Expected", dataIndex: "expected_date", render: (v: string | null) => v ?? "—" },
          {
            title: "Total",
            dataIndex: "total_minor",
            align: "right",
            render: (v: number, r) => fmt(v, r.currency_code),
          },
          {
            title: "Status",
            dataIndex: "status",
            render: (s: PoStatus) => <Tag color={STATUS_COLOR[s]}>{s}</Tag>,
          },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) => (
              <Space>
                <Link href={`/purchase-orders/${r.id}`}>Open</Link>
              </Space>
            ),
          },
        ]}
      />

      <PurchaseOrderFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={(id) => {
          setFormOpen(false);
          router.push(`/purchase-orders/${id}`);
        }}
        vendors={vendors}
        expenseAccounts={expenseAccounts}
        currencies={currencies}
        items={items}
      />
    </>
  );
}
