"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Form, InputNumber, Space } from "antd";
import FormActions from "@/components/ui/FormActions";
import { useUnsavedGuard } from "@/lib/client/use-unsaved-guard";
import { validateOrFocus } from "@/lib/client/validate-or-focus";
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
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  // Edited and not saved (3.0.30): said beside Save, and leaving the page asks first.
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useUnsavedGuard(dirty, modal, "the matching tolerances");

  async function submit() {
    if (saving) return;
    const values = await validateOrFocus(form);
    if (!values) return;
    setSaving(true);
    setSaveError(null);
    const res = await setPurchasingConfigAction({
      price_tolerance_bps: Math.round(values.price_tolerance_pct * 100),
      qty_tolerance_bps: Math.round(values.qty_tolerance_pct * 100),
    });
    setSaving(false);
    if (res.ok) {
      setDirty(false);
      message.success("Tolerances saved");
      router.refresh();
    } else {
      // Beside Save, where it stays until the next attempt.
      setSaveError(res.error ?? "The tolerances could not be saved.");
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <Alert
        type="info"
        showIcon
        message="How three-way matching uses these"
        description="A bill made from a purchase order is checked against what was received and the ordered cost. A line outside tolerance needs a reason, which is recorded on the bill."
      />
      <Card title="Matching tolerances">
        <Form
          form={form}
          layout="vertical"
          disabled={!canEdit}
          onValuesChange={() => setDirty(true)}
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
            <FormActions dirty={dirty} error={saveError}>
              <Button type="primary" loading={saving} onClick={() => void submit()}>
                Save tolerances
              </Button>
            </FormActions>
          ) : (
            <FormActions note="Only an admin can change these tolerances." />
          )}
        </Form>
      </Card>
    </Space>
  );
}
