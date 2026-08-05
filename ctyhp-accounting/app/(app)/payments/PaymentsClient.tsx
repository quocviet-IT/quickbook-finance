"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Space, Table, Tag, Tooltip, type TableColumnsType } from "antd";
import { PaperClipOutlined, PlusOutlined } from "@ant-design/icons";
import AttachmentDrawer, {
  type AttachmentTarget,
} from "@/components/documents/AttachmentDrawer";
import IconActionButton from "@/components/ui/IconActionButton";
import type {
  AccountRow,
  ActorRow,
  CurrencyRow,
  CustomerRow,
  PaymentRow,
  PaymentStatus,
} from "@/lib/db/types";
import { formatMoney } from "@/lib/format";
import ReceivePaymentModal from "./ReceivePaymentModal";
import VoidPaymentModal from "./VoidPaymentModal";
import RefundModal from "../settlements/RefundModal";

type PaymentListRow = PaymentRow & { customer_name: string };

const STATUS: Record<PaymentStatus, { text: string; color: string }> = {
  unapplied: { text: "Unapplied", color: "orange" },
  partial: { text: "Partially applied", color: "gold" },
  applied: { text: "Applied", color: "green" },
  void: { text: "Void", color: "red" },
};

export default function PaymentsClient({
  initialCreateOpen,
  payments,
  customers,
  depositAccounts,
  currencies,
  actors,
  canWrite,
  canReadDocuments,
  canManageDocuments,
  canGovernDocuments,
  scannerConfigured,
}: {
  /** Seeded by the top-bar New menu via `?new=1`. */
  initialCreateOpen: boolean;
  payments: PaymentListRow[];
  customers: CustomerRow[];
  depositAccounts: AccountRow[];
  currencies: CurrencyRow[];
  actors: ActorRow[];
  canWrite: boolean;
  canReadDocuments: boolean;
  canManageDocuments: boolean;
  canGovernDocuments: boolean;
  scannerConfigured: boolean;
}) {
  const router = useRouter();
  const [receiveOpen, setReceiveOpen] = useState(initialCreateOpen);
  // Bumped on every open, so the form is a fresh mount rather than a reset:
  // yesterday's allocations must never survive into the next receipt.
  const [receiveSession, setReceiveSession] = useState(0);
  const [replacementFor, setReplacementFor] = useState<PaymentListRow | null>(null);
  const [voidFor, setVoidFor] = useState<PaymentListRow | null>(null);
  const [refundFor, setRefundFor] = useState<PaymentListRow | null>(null);
  const [attachmentTarget, setAttachmentTarget] = useState<AttachmentTarget | null>(null);

  const decimalsOf = (code: string) => currencies.find((c) => c.code === code)?.decimal_places ?? 2;

  // A void is only accountable if the person behind it has a name on screen.
  const directory = useMemo(
    () => new Map(actors.map((a) => [a.id, a.email || a.full_name])),
    [actors],
  );

  function describeVoid(row: PaymentListRow): string | null {
    if (row.status !== "void") return null;
    const who = row.voided_by ? (directory.get(row.voided_by) ?? "another user") : "the system";
    const when = row.voided_at ? new Date(row.voided_at).toLocaleString() : "an earlier date";
    return `Voided by ${who} on ${when}.${row.void_reason ? ` ${row.void_reason}` : ""}`;
  }

  function openReceive() {
    setReplacementFor(null);
    setReceiveSession((n) => n + 1);
    setReceiveOpen(true);
  }

  function openReplacement(row: PaymentListRow) {
    setReplacementFor(row);
    setReceiveSession((n) => n + 1);
    setReceiveOpen(true);
  }

  const columns: TableColumnsType<PaymentListRow> = [
    { title: "Number", dataIndex: "payment_number", width: 120, render: (n) => n ?? "—" },
    { title: "Customer", dataIndex: "customer_name" },
    { title: "Date", dataIndex: "payment_date", width: 120 },
    { title: "Method", dataIndex: "method", width: 130, render: (m) => m ?? "—" },
    { title: "Reference", dataIndex: "reference", width: 140, render: (r) => r ?? "—" },
    {
      title: "Amount",
      dataIndex: "amount_minor",
      width: 130,
      align: "right",
      render: (v: number, r) => formatMoney(v, r.currency_code, decimalsOf(r.currency_code)),
    },
    {
      title: "Unapplied",
      dataIndex: "unapplied_minor",
      width: 130,
      align: "right",
      render: (v: number, r) => formatMoney(v, r.currency_code, decimalsOf(r.currency_code)),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 150,
      render: (s: PaymentStatus, r) => {
        const tag = <Tag color={STATUS[s].color}>{STATUS[s].text}</Tag>;
        const detail = describeVoid(r);
        return detail ? <Tooltip title={detail}>{tag}</Tooltip> : tag;
      },
    },
    {
      title: "Actions",
      key: "actions",
      width: 260,
      render: (_: unknown, r) => (
        <Space size={4}>
          {canReadDocuments ? (
            <IconActionButton
              label="View payment attachments"
              icon={<PaperClipOutlined />}
              onClick={() =>
                setAttachmentTarget({
                  entityType: "payment",
                  entityId: r.id,
                  label: `${r.payment_number ?? "Payment"} · ${r.customer_name}`,
                })
              }
            />
          ) : null}
          {canWrite && r.status !== "void" && r.unapplied_minor > 0 ? (
            <Button size="small" onClick={() => setRefundFor(r)}>
              Refund
            </Button>
          ) : null}
          {canWrite && r.status !== "void" ? (
            <Button size="small" danger onClick={() => setVoidFor(r)}>
              Void payment
            </Button>
          ) : null}
          {canWrite && r.status === "void" ? (
            <Button size="small" onClick={() => openReplacement(r)}>
              Create replacement
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {canWrite && (
        <Space style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openReceive}>
            Receive payment
          </Button>
        </Space>
      )}

      <Table
        rowKey="id"
        columns={columns}
        dataSource={payments}
        size="small"
        pagination={{ pageSize: 20 }}
        scroll={{ x: "max-content" }}
        sticky
      />

      <AttachmentDrawer
        target={attachmentTarget}
        canManage={canManageDocuments}
        canGovern={canGovernDocuments}
        scannerConfigured={scannerConfigured}
        onClose={() => setAttachmentTarget(null)}
      />

      {receiveOpen && (
        <ReceivePaymentModal
          key={`receive-${receiveSession}`}
          open={receiveOpen}
          replacement={replacementFor}
          customers={customers}
          depositAccounts={depositAccounts}
          currencies={currencies}
          onClose={() => {
            setReceiveOpen(false);
            setReplacementFor(null);
          }}
          onDone={() => router.refresh()}
        />
      )}

      <VoidPaymentModal
        payment={voidFor}
        decimalsOf={decimalsOf}
        onClose={() => setVoidFor(null)}
        onDone={() => router.refresh()}
      />

      {refundFor && (
        <RefundModal
          open={!!refundFor}
          onClose={() => setRefundFor(null)}
          onDone={() => router.refresh()}
          customerId={refundFor.customer_id}
          currency={refundFor.currency_code}
          baseDecimals={decimalsOf(refundFor.currency_code)}
          bankAccounts={depositAccounts}
          sources={[
            {
              kind: "payment",
              id: refundFor.id,
              label: refundFor.payment_number ?? "(unnumbered payment)",
              remainingMinor: refundFor.unapplied_minor,
            },
          ]}
        />
      )}
    </div>
  );
}
