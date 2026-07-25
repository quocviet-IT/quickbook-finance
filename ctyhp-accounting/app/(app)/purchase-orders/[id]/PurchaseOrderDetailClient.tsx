"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Descriptions, Space, Table, Tag, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import type { AccountRow, CurrencyRow, ItemRow, PoStatus, PurchasingConfigRow, VendorRow } from "@/lib/db/types";
import type { PurchaseOrderDetail } from "@/lib/services/purchasing";
import { remainingQty } from "@/lib/domain/purchasing";
import PurchaseOrderFormModal from "../PurchaseOrderFormModal";
import ReceiveModal from "./ReceiveModal";
import BillFromPoModal from "./BillFromPoModal";
import {
  approvePurchaseOrderAction,
  cancelPurchaseOrderAction,
  closePurchaseOrderAction,
  voidGoodsReceiptAction,
} from "../actions";

const STATUS_COLOR: Record<PoStatus, string> = {
  draft: "default",
  open: "blue",
  partial: "gold",
  received: "green",
  closed: "purple",
  cancelled: "red",
};

export default function PurchaseOrderDetailClient({
  detail,
  config,
  vendors,
  expenseAccounts,
  currencies,
  items,
  canWrite,
}: {
  detail: PurchaseOrderDetail;
  config: PurchasingConfigRow;
  vendors: VendorRow[];
  expenseAccounts: AccountRow[];
  currencies: CurrencyRow[];
  items: ItemRow[];
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const { order, lines, receipts, bills, exceptions } = detail;
  const [editOpen, setEditOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const decimals = useMemo(
    () => currencies.find((c) => c.code === order.currency_code)?.decimal_places ?? 2,
    [currencies, order.currency_code],
  );

  function fmt(minor: number): string {
    return `${(minor / 10 ** decimals).toFixed(decimals)} ${order.currency_code}`;
  }

  const canReceive = order.status === "open" || order.status === "partial";
  const receivedNotBilled = lines.some((l) => Number(l.qty_received) > Number(l.qty_billed));
  const canBill = ["open", "partial", "received", "closed"].includes(order.status) && receivedNotBilled;

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      message.success(label);
      router.refresh();
    } else {
      message.error(res.error ?? "Action failed");
    }
  }

  function promptReason(title: string, content: string, onReason: (reason: string) => Promise<void>) {
    let reason = "";
    modal.confirm({
      title,
      content: (
        <div>
          <Typography.Paragraph type="secondary">{content}</Typography.Paragraph>
          <textarea
            aria-label="Reason"
            rows={3}
            style={{ width: "100%" }}
            onChange={(e) => {
              reason = e.target.value;
            }}
          />
        </div>
      ),
      okText: "Confirm",
      onOk: async () => {
        if (!reason.trim()) {
          message.error("A reason is required");
          throw new Error("A reason is required");
        }
        await onReason(reason.trim());
      },
    });
  }

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <Card
        title={
          <Space>
            <span>Order</span>
            <Tag color={STATUS_COLOR[order.status]}>{order.status}</Tag>
          </Space>
        }
        extra={
          canWrite ? (
            <Space wrap>
              {order.status === "draft" && (
                <>
                  <Button onClick={() => setEditOpen(true)}>Edit draft</Button>
                  <Button
                    type="primary"
                    loading={busy}
                    onClick={() =>
                      run("Purchase order approved", async () => {
                        const res = await approvePurchaseOrderAction(order.id);
                        return res;
                      })
                    }
                  >
                    Approve
                  </Button>
                </>
              )}
              {canReceive && (
                <Button type="primary" onClick={() => setReceiveOpen(true)}>
                  Receive
                </Button>
              )}
              {canBill && <Button onClick={() => setBillOpen(true)}>Create bill</Button>}
              {order.status !== "draft" && order.status !== "closed" && order.status !== "cancelled" && (
                <Button
                  onClick={() =>
                    promptReason(
                      "Short-close this purchase order?",
                      "The outstanding quantity will be treated as never arriving. Existing receipts and bills are kept.",
                      async (reason) => {
                        const res = await closePurchaseOrderAction(order.id, { reason });
                        if (!res.ok) {
                          message.error(res.error ?? "Failed to close");
                          throw new Error(res.error);
                        }
                        message.success("Purchase order closed");
                        router.refresh();
                      },
                    )
                  }
                >
                  Short close
                </Button>
              )}
              {(order.status === "draft" || order.status === "open") && (
                <Button
                  danger
                  onClick={() =>
                    promptReason(
                      "Cancel this purchase order?",
                      "Only an order with no receipts and no bills can be cancelled.",
                      async (reason) => {
                        const res = await cancelPurchaseOrderAction(order.id, { reason });
                        if (!res.ok) {
                          message.error(res.error ?? "Failed to cancel");
                          throw new Error(res.error);
                        }
                        message.success("Purchase order cancelled");
                        router.refresh();
                      },
                    )
                  }
                >
                  Cancel
                </Button>
              )}
            </Space>
          ) : null
        }
      >
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small">
          <Descriptions.Item label="Vendor">{order.vendor_name}</Descriptions.Item>
          <Descriptions.Item label="Order date">{order.order_date}</Descriptions.Item>
          <Descriptions.Item label="Expected date">{order.expected_date ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Currency">{order.currency_code}</Descriptions.Item>
          <Descriptions.Item label="Order total">{fmt(order.total_minor)}</Descriptions.Item>
          <Descriptions.Item label="Ship to">{order.ship_to ?? "—"}</Descriptions.Item>
          {order.memo && <Descriptions.Item label="Memo">{order.memo}</Descriptions.Item>}
          {order.close_reason && <Descriptions.Item label="Close reason">{order.close_reason}</Descriptions.Item>}
        </Descriptions>
      </Card>

      {receivedNotBilled && (
        <Alert
          type="info"
          showIcon
          message="Received but not billed"
          description="These quantities have arrived but have no vendor bill yet, so they are not in the ledger. Create the bill when the vendor invoices you."
        />
      )}

      <Card title="Lines">
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={lines}
          scroll={{ x: "max-content" }}
          columns={[
            { title: "#", dataIndex: "line_order", render: (v: number) => v + 1 },
            { title: "Description", dataIndex: "description", render: (v: string) => v || "—" },
            { title: "Ordered", dataIndex: "quantity", align: "right", render: (v: number) => Number(v) },
            { title: "Received", dataIndex: "qty_received", align: "right", render: (v: number) => Number(v) },
            { title: "Billed", dataIndex: "qty_billed", align: "right", render: (v: number) => Number(v) },
            {
              title: "Remaining",
              key: "remaining",
              align: "right",
              render: (_, r) => (r.is_closed ? <Tag>closed</Tag> : remainingQty(Number(r.quantity), Number(r.qty_received))),
            },
            {
              title: "Unit Cost",
              dataIndex: "unit_cost_minor",
              align: "right",
              render: (v: number) => fmt(v),
            },
            { title: "Line Total", dataIndex: "line_total_minor", align: "right", render: (v: number) => fmt(v) },
          ]}
        />
      </Card>

      <Card title="Receipts">
        <DataTable
          rowKey="id"
          pagination={false}
          dataSource={receipts}
          emptyTitle="Nothing received yet"
          emptyDescription="Record a goods receipt when the shipment arrives."
          columns={[
            { title: "Receipt", dataIndex: "receipt_number", render: (v: string | null) => v ?? "—" },
            { title: "Date", dataIndex: "receipt_date" },
            {
              title: "Lines",
              key: "lines",
              render: (_, r) => r.lines.map((l) => Number(l.quantity)).join(", "),
            },
            {
              title: "Status",
              dataIndex: "status",
              render: (s: string) => <Tag color={s === "void" ? "red" : "green"}>{s}</Tag>,
            },
            { title: "Void reason", dataIndex: "void_reason", render: (v: string | null) => v ?? "—" },
            {
              title: "Actions",
              key: "actions",
              render: (_, r) =>
                canWrite && r.status === "posted" ? (
                  <Button
                    type="link"
                    danger
                    size="small"
                    onClick={() =>
                      promptReason(
                        "Void this receipt?",
                        "The received quantity goes back to outstanding. A receipt that has already been billed cannot be voided — void the bill first.",
                        async (reason) => {
                          const res = await voidGoodsReceiptAction(r.id, order.id, { reason });
                          if (!res.ok) {
                            message.error(res.error ?? "Failed to void receipt");
                            throw new Error(res.error);
                          }
                          message.success("Receipt voided");
                          router.refresh();
                        },
                      )
                    }
                  >
                    Void
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>

      <Card title="Bills from this order">
        <DataTable
          rowKey="id"
          pagination={false}
          dataSource={bills}
          emptyTitle="No bills yet"
          emptyDescription="Convert what you received into a draft bill, then post it from the Bills page."
          columns={[
            {
              title: "Bill",
              dataIndex: "bill_number",
              render: (v: string | null) => <Link href="/bills">{v ?? "(draft)"}</Link>,
            },
            { title: "Date", dataIndex: "bill_date" },
            { title: "Total", dataIndex: "total_minor", align: "right", render: (v: number) => fmt(v) },
            { title: "Status", dataIndex: "status", render: (s: string) => <Tag>{s}</Tag> },
          ]}
        />
      </Card>

      {exceptions.length > 0 && (
        <Card title="Approved matching exceptions">
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={exceptions}
            scroll={{ x: "max-content" }}
            columns={[
              { title: "Kind", dataIndex: "kind", render: (v: string) => <Tag color="orange">{v}</Tag> },
              { title: "Expected", dataIndex: "expected_value", align: "right", render: (v: number) => Number(v) },
              { title: "Actual", dataIndex: "actual_value", align: "right", render: (v: number) => Number(v) },
              {
                title: "Variance",
                dataIndex: "variance_bps",
                align: "right",
                render: (v: number) => `${(v / 100).toFixed(2)}%`,
              },
              { title: "Reason", dataIndex: "reason" },
              { title: "Recorded", dataIndex: "created_at", render: (v: string) => v.slice(0, 10) },
            ]}
          />
        </Card>
      )}

      <PurchaseOrderFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          router.refresh();
        }}
        vendors={vendors}
        expenseAccounts={expenseAccounts}
        currencies={currencies}
        items={items}
        order={order}
        lines={lines}
      />

      <ReceiveModal
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        onDone={() => {
          setReceiveOpen(false);
          router.refresh();
        }}
        purchaseOrderId={order.id}
        lines={lines}
      />

      <BillFromPoModal
        open={billOpen}
        onClose={() => setBillOpen(false)}
        onDone={() => {
          setBillOpen(false);
          router.refresh();
        }}
        purchaseOrderId={order.id}
        lines={lines}
        config={config}
        currencyCode={order.currency_code}
        decimals={decimals}
      />
    </Space>
  );
}
