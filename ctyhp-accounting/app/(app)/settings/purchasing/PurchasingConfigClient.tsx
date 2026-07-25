"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Form, InputNumber, Space, Typography } from "antd";
import type { PurchasingConfigRow } from "@/lib/db/types";
import { setPurchasingConfigAction } from "./actions";

/** Tolerances are stored in basis points; the form works in percent. */
export default function PurchasingConfigClient({
  config,
  canEdit,
}: {
  config: PurchasingConfigRow;
  canEdit: boolean;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await setPurchasingConfigAction({
      price_tolerance_bps: Math.round(values.price_tolerance_pct * 100),
      qty_tolerance_bps: Math.round(values.qty_tolerance_pct * 100),
    });
    setSaving(false);
    if (res.ok) {
      message.success("Tolerances saved");
      router.refresh();
    } else {
      message.error(res.error ?? "Failed to save tolerances");
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <Alert
        type="info"
        showIcon
        message="How three-way matching uses these"
        description="When a purchase order is converted to a bill, the billed quantity is checked against what was received and the billed unit cost against the ordered cost. A line outside its tolerance is rejected unless an approval reason is given, and that reason is recorded against the bill."
      />
      <Card title="Matching tolerances">
        <Form
          form={form}
          layout="vertical"
          disabled={!canEdit}
          initialValues={{
            price_tolerance_pct: config.price_tolerance_bps / 100,
            qty_tolerance_pct: config.qty_tolerance_bps / 100,
          }}
        >
          <Form.Item
            name="price_tolerance_pct"
            label="Price tolerance (%)"
            extra="How far the billed unit cost may differ from the ordered cost before an approval is required."
            rules={[{ required: true, message: "Enter a price tolerance" }]}
          >
            <InputNumber min={0} max={100} step={0.25} precision={2} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item
            name="qty_tolerance_pct"
            label="Quantity tolerance (%)"
            extra="How much more than the received quantity may be billed before an approval is required. 0% means you may never bill more than arrived."
            rules={[{ required: true, message: "Enter a quantity tolerance" }]}
          >
            <InputNumber min={0} max={100} step={0.25} precision={2} style={{ width: 200 }} />
          </Form.Item>
          {canEdit ? (
            <Button type="primary" loading={saving} onClick={submit}>
              Save tolerances
            </Button>
          ) : (
            <Typography.Text type="secondary">Only an admin can change these tolerances.</Typography.Text>
          )}
        </Form>
      </Card>
    </Space>
  );
}
