"use client";
import { useState } from "react";
import { App, DatePicker, Form, Input, InputNumber, Modal, Typography } from "antd";
import dayjs from "dayjs";
import { useCompanyClock } from "@/components/CompanyClock";
import type { PurchaseOrderLineRow } from "@/lib/db/types";
import { remainingQty } from "@/lib/domain/purchasing";
import { receivePurchaseOrderAction } from "../actions";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";

/** The dialog's width; its body, where the lines sit, is 48px less. */
export const RECEIVE_MODAL_WIDTH = 720;

/**
 * #, Ordered, Outstanding and Receive now. Description takes what is left, at
 * least COLUMN.TEXT_MIN. The quantity box is the width of an amount.
 */
export const RECEIVE_LINES_FIXED_WIDTHS = [COLUMN.ACTION, COLUMN.QTY, COLUMN.QTY, COLUMN.MONEY] as const;

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
  const { today } = useCompanyClock();
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
      width={RECEIVE_MODAL_WIDTH}
    >
      <Form form={form} layout="vertical" initialValues={{ receipt_date: dayjs(today) }}>
        <Form.Item name="receipt_date" label="Receipt date" rules={[{ required: true, message: "Receipt date" }]}>
          <DatePicker />
        </Form.Item>
        {/* Every row stays visible: the quantities are edited here. */}
        <DataTable<PurchaseOrderLineRow>
          rowKey="id"
          pagination={false}
          rows={receivable}
          emptyTitle="Nothing outstanding to receive"
          columns={[
            { title: "#", dataIndex: "line_order", width: RECEIVE_LINES_FIXED_WIDTHS[0], render: (v: number) => v + 1 },
            flexColumn<PurchaseOrderLineRow>({ title: "Description", dataIndex: "description" }),
            { title: "Ordered", dataIndex: "quantity", width: RECEIVE_LINES_FIXED_WIDTHS[1], align: "right", render: (v: number) => Number(v) },
            {
              title: "Outstanding",
              key: "outstanding",
              width: RECEIVE_LINES_FIXED_WIDTHS[2],
              align: "right",
              render: (_, r) => remainingQty(Number(r.quantity), Number(r.qty_received)),
            },
            {
              title: "Receive now",
              key: "receive",
              width: RECEIVE_LINES_FIXED_WIDTHS[3],
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
