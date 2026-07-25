"use client";
import { useState } from "react";
import { App, DatePicker, Form, Input, InputNumber, Modal, Table, Typography } from "antd";
import dayjs from "dayjs";
import type { PurchaseOrderLineRow } from "@/lib/db/types";
import { remainingQty } from "@/lib/domain/purchasing";
import { receivePurchaseOrderAction } from "../actions";

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  purchaseOrderId: string;
  lines: PurchaseOrderLineRow[];
}

/**
 * Record a goods receipt. Quantities default to what is still outstanding; the
 * server rejects anything beyond it (the over-receipt guard), so this form caps
 * the input rather than reimplementing the rule.
 *
 * The body mounts only while the dialog is open, so its state initializes from
 * the current lines without an effect.
 */
export default function ReceiveModal(props: Props) {
  if (!props.open) return null;
  return <ReceiveModalBody {...props} />;
}

function ReceiveModalBody({ onClose, onDone, purchaseOrderId, lines }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const receivable = lines.filter(
    (l) => !l.is_closed && remainingQty(Number(l.quantity), Number(l.qty_received)) > 0,
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      receivable.map((l) => [l.id, remainingQty(Number(l.quantity), Number(l.qty_received))]),
    ),
  );

  async function submit() {
    const values = await form.validateFields();
    const payload = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ purchase_order_line_id: id, quantity: qty }));
    if (payload.length === 0) {
      message.error("Enter a quantity on at least one line");
      return;
    }
    setSaving(true);
    const res = await receivePurchaseOrderAction(purchaseOrderId, {
      receipt_date: values.receipt_date.format("YYYY-MM-DD"),
      memo: values.memo ?? null,
      lines: payload,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Receipt recorded");
      onDone();
    } else {
      message.error(res.error ?? "Failed to record receipt");
    }
  }

  return (
    <Modal
      title="Receive against this purchase order"
      open
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Record receipt"
      width={720}
    >
      <Form form={form} layout="vertical" initialValues={{ receipt_date: dayjs() }}>
        <Form.Item name="receipt_date" label="Receipt date" rules={[{ required: true, message: "Receipt date" }]}>
          <DatePicker />
        </Form.Item>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={receivable}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "Nothing outstanding to receive" }}
          columns={[
            { title: "#", dataIndex: "line_order", render: (v: number) => v + 1 },
            { title: "Description", dataIndex: "description", render: (v: string) => v || "—" },
            { title: "Ordered", dataIndex: "quantity", align: "right", render: (v: number) => Number(v) },
            {
              title: "Outstanding",
              key: "outstanding",
              align: "right",
              render: (_, r) => remainingQty(Number(r.quantity), Number(r.qty_received)),
            },
            {
              title: "Receive now",
              key: "receive",
              align: "right",
              render: (_, r) => (
                <InputNumber
                  min={0}
                  max={remainingQty(Number(r.quantity), Number(r.qty_received))}
                  value={quantities[r.id] ?? 0}
                  aria-label={`Quantity to receive for line ${r.line_order + 1}`}
                  onChange={(v) => setQuantities((q) => ({ ...q, [r.id]: Number(v ?? 0) }))}
                />
              ),
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          Receiving more than the outstanding quantity is rejected — that guard is what prevents a
          duplicated receipt.
        </Typography.Paragraph>
        <Form.Item name="memo" label="Memo">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
