"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, DatePicker, Form, Input, InputNumber, Modal, Select, Typography } from "antd";
import dayjs from "dayjs";
import type { AccountRow, ItemRow } from "@/lib/db/types";
import { adjustInventoryAction } from "./inventory-actions";

interface Props {
  open: boolean;
  item: ItemRow | null;
  offsetAccounts: AccountRow[];
  onHandQty: number;
  onClose: () => void;
}

/**
 * Shrinkage, found stock, or a revaluation. Costing is decided server-side: an
 * increase uses the unit cost given here, a decrease uses weighted average cost.
 * The body mounts only while the dialog is open, so no effect is needed.
 */
export default function AdjustInventoryModal(props: Props) {
  if (!props.open || !props.item) return null;
  return <AdjustInventoryModalBody {...props} item={props.item} />;
}

function AdjustInventoryModalBody({
  item,
  offsetAccounts,
  onHandQty,
  onClose,
}: Props & { item: ItemRow }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const qtyDelta = Form.useWatch("qty_delta", form) as number | undefined;

  async function submit() {
    const v = await form.validateFields();
    setSaving(true);
    const res = await adjustInventoryAction({
      item_id: item.id,
      adjust_date: v.adjust_date.format("YYYY-MM-DD"),
      qty_delta: v.qty_delta ?? 0,
      unit_cost_minor: Math.round((v.unit_cost ?? 0) * 100),
      value_delta_minor: Math.round((v.value_delta ?? 0) * 100),
      offset_account_id: v.offset_account_id,
      reason: v.reason,
    });
    setSaving(false);
    if (res.ok) {
      message.success(
        res.data?.submittedForApproval
          ? "Inventory adjustment submitted for approval"
          : "Inventory adjusted",
      );
      onClose();
      if (!res.data?.submittedForApproval) router.refresh();
    } else {
      message.error(res.error ?? "Failed to adjust inventory");
    }
  }

  return (
    <Modal
      title={`Adjust inventory — ${item.name}`}
      open
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Post adjustment"
      width={640}
    >
      <Typography.Paragraph type="secondary">
        On hand: <strong>{onHandQty}</strong>. A positive quantity is costed at the unit cost you
        enter; a negative quantity is costed at weighted average. Leave the quantity at zero and set a
        value change to revalue the stock without moving units.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ adjust_date: dayjs(), qty_delta: 0 }}>
        <Form.Item name="adjust_date" label="Date" rules={[{ required: true, message: "Date" }]}>
          <DatePicker />
        </Form.Item>
        <Form.Item name="qty_delta" label="Quantity change (negative to write off)">
          <InputNumber style={{ width: 200 }} />
        </Form.Item>
        {(qtyDelta ?? 0) > 0 && (
          <Form.Item
            name="unit_cost"
            label="Unit cost"
            rules={[{ required: true, message: "A unit cost is required when adding quantity" }]}
          >
            <InputNumber min={0} precision={2} prefix="$" style={{ width: 200 }} />
          </Form.Item>
        )}
        {(qtyDelta ?? 0) === 0 && (
          <Form.Item
            name="value_delta"
            label="Value change (revaluation)"
            rules={[{ required: true, message: "Enter a value change" }]}
          >
            <InputNumber precision={2} prefix="$" style={{ width: 200 }} />
          </Form.Item>
        )}
        <Form.Item
          name="offset_account_id"
          label="Offset account"
          rules={[{ required: true, message: "Select an offset account" }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            options={offsetAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
          />
        </Form.Item>
        <Form.Item name="reason" label="Reason" rules={[{ required: true, message: "A reason is required" }]}>
          <Input.TextArea rows={2} placeholder="Stock count difference, damage, found stock…" />
        </Form.Item>
      </Form>
      {(qtyDelta ?? 0) < 0 && (
        <Alert
          type="info"
          showIcon
          message="Costed at weighted average"
          description="Writing quantity off relieves its share of the current inventory value; if it empties the stock, the whole remaining value is relieved."
        />
      )}
    </Modal>
  );
}
